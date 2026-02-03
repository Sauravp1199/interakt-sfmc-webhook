/**
 * ENHANCED DEBUG LOGGING for SFMC Data Insertion
 *
 * Add this code to src/services/sfmcRest.ts after line 72 to debug
 * why data is not being inserted to Data Extension
 */

// ============================================
// ADD THIS CODE TO sfmcRest.ts (after response logging)
// ============================================

// Location: After logger.info('========================================');
// (Around line 73, after response is logged)

/**
 * Enhanced Response Analysis - Shows which fields SFMC accepted
 */
function analyzeResponse(response: any, requestData: any): void {
  logger.info('========== RESPONSE FIELD ANALYSIS ==========');
  logger.info(`Response Status: ${response.status}`);
  logger.info(`Response Headers Content-Type: ${response.headers['content-type']}`);

  // Check if response is array (rowset API returns array)
  if (!Array.isArray(response.data)) {
    logger.error('⚠️ UNEXPECTED RESPONSE FORMAT: Response is not an array');
    logger.error(`Response type: ${typeof response.data}`);
    logger.error(`Response structure: ${JSON.stringify(response.data).substring(0, 200)}`);
    return;
  }

  const rowset = requestData.rowset || [];
  const responseArray = response.data;

  logger.info(`Records in Request: ${rowset.length}`);
  logger.info(`Records in Response: ${responseArray.length}`);
  logger.info('');

  // Analyze each record
  responseArray.forEach((record: any, index: number) => {
    logger.info(`--- Record ${index + 1} ---`);

    const sentRecord = rowset[index];
    const returnedFields = Object.keys(record.values || {});
    const sentFields = Object.keys(sentRecord || {});

    logger.info(`Sent Fields: ${sentFields.length}`);
    logger.info(`Returned Fields: ${returnedFields.length}`);
    logger.info('');

    // Check which sent fields are NOT in response (= field name mismatch)
    const missingFields = sentFields.filter((field: string) =>
      !returnedFields.includes(field) && field !== 'keys'
    );

    if (missingFields.length > 0) {
      logger.warn('');
      logger.warn('⚠️  CRITICAL: FIELDS NOT RETURNED BY SFMC ⚠️');
      logger.warn('These field names may NOT EXIST in your Data Extension!');
      logger.warn('');

      missingFields.forEach((field: string) => {
        logger.warn(`  ❌ ${field} - NOT found in Data Extension`);
      });

      logger.warn('');
      logger.warn('ACTION REQUIRED:');
      logger.warn('1. Go to SFMC Data Management → Data Extensions');
      logger.warn('2. Open Data Extension with key: E991E42A-69A0-41BF-9542-FADB50F48AB5');
      logger.warn('3. Check if these fields exist with EXACT SAME names (case-sensitive)');
      logger.warn('4. If fields missing, create them in Data Extension');
      logger.warn('5. If field names wrong, update field names in webhook mapper');
      logger.warn('');
    } else {
      logger.info('✅ All sent fields were returned by SFMC');
    }

    // Show which fields WERE accepted
    const fieldsAccepted = sentFields.filter((field: string) =>
      returnedFields.includes(field) && field !== 'keys'
    );

    if (fieldsAccepted.length > 0) {
      logger.info('');
      logger.info(`✅ ACCEPTED FIELDS (${fieldsAccepted.length}):`);
      fieldsAccepted.slice(0, 10).forEach((field: string) => {
        const value = sentRecord[field];
        const displayValue = typeof value === 'string' && value.length > 50
          ? value.substring(0, 50) + '...'
          : value;
        logger.info(`  ✅ ${field} = ${displayValue}`);
      });
      if (fieldsAccepted.length > 10) {
        logger.info(`  ... and ${fieldsAccepted.length - 10} more fields`);
      }
    }

    // Check primary keys
    logger.info('');
    logger.info('Primary Keys Sent:');
    if (sentRecord.keys) {
      Object.entries(sentRecord.keys || {}).forEach(([key, value]: [string, any]) => {
        logger.info(`  ${key} = ${value}`);
      });
    } else {
      logger.warn('  ⚠️ No keys specified - auto-using first available field');
    }

    logger.info('');
  });

  logger.info('============================================');
  logger.info('');
  logger.info('TROUBLESHOOTING STEPS:');
  logger.info('1. If "FIELDS NOT RETURNED" section appears above:');
  logger.info('   → Check Data Extension schema for field name matches');
  logger.info('2. If all fields returned but data not in DE:');
  logger.info('   → Check if primary key field is correct');
  logger.info('   → Verify Data Extension is set to "Upsert" mode');
  logger.info('3. If this message doesn\'t appear:');
  logger.info('   → Response format may be unexpected - check SFMC API response');
  logger.info('');
}

// ============================================
// INTEGRATION INSTRUCTIONS
// ============================================

/**
 * Where to add this code in sfmcRest.ts:
 *
 * File: src/services/sfmcRest.ts
 * Function: executeRestRequest (around line 60-75)
 *
 * BEFORE:
 * ```
 *   const response = await axios.post(normalizedUrl, data, {
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${accessToken}`,
 *     },
 *     timeout: 30000,
 *   });
 *
 *   // Log response details
 *   logger.info('========== SFMC REST RESPONSE ==========');
 *   logger.info(`Status: ${response.status} ${response.statusText}`);
 *   logger.info('Response Body (JSON):');
 *   console.log(JSON.stringify(response.data, null, 2));
 *   logger.info('========================================');
 *
 *   const responseData = response.data as Record<string, unknown>;
 * ```
 *
 * AFTER (ADD THIS):
 * ```
 *   const response = await axios.post(normalizedUrl, data, {
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${accessToken}`,
 *     },
 *     timeout: 30000,
 *   });
 *
 *   // Log response details
 *   logger.info('========== SFMC REST RESPONSE ==========');
 *   logger.info(`Status: ${response.status} ${response.statusText}`);
 *   logger.info('Response Body (JSON):');
 *   console.log(JSON.stringify(response.data, null, 2));
 *   logger.info('========================================');
 *
 *   // ADD THIS LINE:
 *   analyzeResponse(response, data);  // ← ADD THIS
 *
 *   const responseData = response.data as Record<string, unknown>;
 * ```
 *
 * Then add the analyzeResponse function above executeRestRequest
 */

// ============================================
// COMPLETE CODE SNIPPET (Ready to Copy)
// ============================================

export const enhancedDebugging = `
// Add this function to sfmcRest.ts (before executeRestRequest function)

function analyzeResponse(response: any, requestData: any): void {
  logger.info('========== RESPONSE FIELD ANALYSIS ==========');
  logger.info(\`Response Status: \${response.status}\`);
  logger.info(\`Response Headers Content-Type: \${response.headers['content-type']}\`);

  if (!Array.isArray(response.data)) {
    logger.error('⚠️ UNEXPECTED RESPONSE FORMAT: Response is not an array');
    logger.error(\`Response type: \${typeof response.data}\`);
    return;
  }

  const rowset = requestData.rowset || [];
  const responseArray = response.data;

  logger.info(\`Records in Request: \${rowset.length}\`);
  logger.info(\`Records in Response: \${responseArray.length}\`);
  logger.info('');

  responseArray.forEach((record: any, index: number) => {
    logger.info(\`--- Record \${index + 1} ---\`);

    const sentRecord = rowset[index];
    const returnedFields = Object.keys(record.values || {});
    const sentFields = Object.keys(sentRecord || {});

    logger.info(\`Sent Fields: \${sentFields.length}\`);
    logger.info(\`Returned Fields: \${returnedFields.length}\`);
    logger.info('');

    const missingFields = sentFields.filter((field: string) =>
      !returnedFields.includes(field) && field !== 'keys'
    );

    if (missingFields.length > 0) {
      logger.warn('');
      logger.warn('⚠️  CRITICAL: FIELDS NOT RETURNED BY SFMC ⚠️');
      logger.warn('These field names may NOT EXIST in your Data Extension!');
      logger.warn('');

      missingFields.forEach((field: string) => {
        logger.warn(\`  ❌ \${field} - NOT found in Data Extension\`);
      });

      logger.warn('');
      logger.warn('ACTION: Check Data Extension schema for field name matches');
      logger.warn('');
    } else {
      logger.info('✅ All sent fields were returned by SFMC');
    }

    const fieldsAccepted = sentFields.filter((field: string) =>
      returnedFields.includes(field) && field !== 'keys'
    );

    if (fieldsAccepted.length > 0) {
      logger.info('');
      logger.info(\`✅ ACCEPTED FIELDS (\${fieldsAccepted.length}):\`);
      fieldsAccepted.slice(0, 10).forEach((field: string) => {
        const value = sentRecord[field];
        const displayValue = typeof value === 'string' && value.length > 50
          ? value.substring(0, 50) + '...'
          : value;
        logger.info(\`  ✅ \${field}\`);
      });
    }

    logger.info('');
    logger.info('Primary Keys Sent:');
    if (sentRecord.keys) {
      Object.entries(sentRecord.keys || {}).forEach(([key, value]: [string, any]) => {
        logger.info(\`  \${key} = \${value}\`);
      });
    }

    logger.info('');
  });

  logger.info('============================================');
}

// Then in executeRestRequest function, after line 72, add:
analyzeResponse(response, data);
`;

console.log('Enhanced debugging code ready to copy!');
