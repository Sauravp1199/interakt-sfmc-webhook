/**
 * SFMC REST API Client
 *
 * Implements:
 * - OAuth token generation with caching
 * - REST API Data Extension rowset endpoint
 * - Comprehensive logging for all API calls
 * - Connection pooling with keep-alive
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const logger = require('../utils/logger');

// Token cache
let accessToken = null;
let tokenExpiry = null;
let restInstanceUrl = null;

// HTTP agents with keep-alive for connection reuse
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Axios instance with keep-alive
const axiosInstance = axios.create({
    httpAgent,
    httpsAgent,
    timeout: 30000 // 30 second timeout
});

// Pre-cached URLs
let cachedRestUrl = null;
let cachedAuthUrl = null;

/**
 * Normalize URL - remove trailing slashes and fix double slashes
 */
function normalizeUrl(url) {
    if (!url) return '';
    let normalized = url.replace(/\/+$/, '');
    normalized = normalized.replace(/([^:])\/\/+/g, '$1/');
    return normalized;
}

/**
 * Get REST API base URL from environment
 */
function getRestBaseUrl() {
    if (!cachedRestUrl) {
        if (!process.env.SFMC_REST_BASE_URL) {
            logger.error('SFMC_REST_BASE_URL environment variable is not set');
            throw new Error('SFMC_REST_BASE_URL environment variable is required');
        }
        cachedRestUrl = normalizeUrl(process.env.SFMC_REST_BASE_URL);
        logger.info('REST Base URL configured: ' + cachedRestUrl);
    }
    return cachedRestUrl;
}

/**
 * Get Auth URL
 */
function getAuthUrl() {
    if (!cachedAuthUrl) {
        if (!process.env.SFMC_AUTH_BASE_URL) {
            logger.error('SFMC_AUTH_BASE_URL environment variable is not set');
            throw new Error('SFMC_AUTH_BASE_URL environment variable is required');
        }
        cachedAuthUrl = `${normalizeUrl(process.env.SFMC_AUTH_BASE_URL)}/v2/token`;
        logger.info('Auth URL configured: ' + cachedAuthUrl);
    }
    return cachedAuthUrl;
}

/**
 * Mask sensitive data for logging
 */
function maskToken(token) {
    if (!token) return '[NO TOKEN]';
    if (token.length <= 20) return '[TOKEN]';
    return token.substring(0, 10) + '...' + token.substring(token.length - 5);
}

/**
 * Get OAuth access token from SFMC
 * Caches token and auto-refreshes before expiry
 */
async function getAccessToken() {
    // Return cached token if still valid (with 5 minute buffer)
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
        const remainingSeconds = Math.floor((tokenExpiry - Date.now()) / 1000);
        logger.debug('Using cached SFMC token', {
            expiresAt: new Date(tokenExpiry).toISOString(),
            remainingSeconds
        });
        return { accessToken, restInstanceUrl };
    }

    const tokenUrl = getAuthUrl();

    // Log request (with credentials redacted)
    logger.info('========== SFMC TOKEN API REQUEST ==========');
    logger.info('Token API URL: ' + tokenUrl);
    logger.info('Request Method: POST');
    logger.info('Request Headers: Content-Type: application/json');
    logger.info('Request Body:', JSON.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.SFMC_CLIENT_ID ? maskToken(process.env.SFMC_CLIENT_ID) : '[NOT SET]',
        client_secret: '[REDACTED]',
        account_id: process.env.SFMC_ACCOUNT_ID || '[NOT SET]'
    }, null, 2));
    logger.info('=============================================');

    try {
        const response = await axiosInstance.post(
            tokenUrl,
            {
                grant_type: 'client_credentials',
                client_id: process.env.SFMC_CLIENT_ID,
                client_secret: process.env.SFMC_CLIENT_SECRET,
                account_id: process.env.SFMC_ACCOUNT_ID
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        // Log response
        logger.info('========== SFMC TOKEN API RESPONSE ==========');
        logger.info('Response Status: ' + response.status + ' ' + response.statusText);
        logger.info('Response Body:', JSON.stringify({
            access_token: maskToken(response.data.access_token),
            token_type: response.data.token_type,
            expires_in: response.data.expires_in,
            scope: response.data.scope ? '[SCOPES_RECEIVED]' : '[NO SCOPES]',
            rest_instance_url: response.data.rest_instance_url
        }, null, 2));
        logger.info('==============================================');

        // Cache token (refresh 5 minutes before expiry)
        accessToken = response.data.access_token;
        restInstanceUrl = response.data.rest_instance_url;
        const expiresIn = response.data.expires_in || 1080; // Default 18 minutes
        tokenExpiry = Date.now() + (expiresIn - 300) * 1000; // Refresh 5 min early

        logger.info('SFMC token cached successfully', {
            expiresIn,
            cacheUntil: new Date(tokenExpiry).toISOString(),
            restInstanceUrl
        });

        return { accessToken, restInstanceUrl };

    } catch (error) {
        logger.error('========== SFMC TOKEN API ERROR ==========');
        logger.error('Token API URL: ' + tokenUrl);
        logger.error('Error Type: ' + error.name);
        logger.error('Error Message: ' + error.message);
        if (error.response) {
            logger.error('Response Status: ' + error.response.status);
            logger.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        if (error.code) {
            logger.error('Error Code: ' + error.code);
        }
        logger.error('Error Stack: ' + error.stack);
        logger.error('==========================================');
        throw new Error('Failed to authenticate with SFMC: ' + error.message);
    }
}

/**
 * Check if a value is blank, null, or undefined
 */
function isBlankOrNull(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
}

/**
 * Build REST API payload for Data Extension upsert
 * Format: [{ keys: {...}, values: {...} }]
 */
function buildRestPayload(data, primaryKeyField = 'data_customer_id') {
    const keys = {};
    const values = {};

    Object.keys(data).forEach(key => {
        if (!isBlankOrNull(data[key])) {
            const stringValue = String(data[key]);
            if (key === primaryKeyField) {
                keys[key] = stringValue;
            }
            values[key] = stringValue;
        }
    });

    return [{ keys, values }];
}

/**
 * Insert/Upsert single record to SFMC Data Extension
 * Uses: POST /hub/v1/dataevents/key:{DE_KEY}/rowset
 */
async function insertToSFMC(dataExtensionKey, data) {
    const { accessToken: token } = await getAccessToken();

    // Build URL - use environment REST base URL
    const restBaseUrl = getRestBaseUrl();
    const restUrl = `${restBaseUrl}/hub/v1/dataevents/key:${dataExtensionKey}/rowset`;

    // Build payload
    const payload = buildRestPayload(data);

    // Log request
    logger.info('========== SFMC REST API REQUEST (UPSERT) ==========');
    logger.info('REST API URL: ' + restUrl);
    logger.info('Request Method: POST');
    logger.info('Request Headers:', JSON.stringify({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + maskToken(token)
    }, null, 2));
    logger.info('Data Extension Key: ' + dataExtensionKey);
    logger.info('Total Fields Being Sent: ' + Object.keys(payload[0].values).length);
    logger.info('Primary Key (keys):', JSON.stringify(payload[0].keys, null, 2));
    logger.info('All Values (values):', JSON.stringify(payload[0].values, null, 2));
    logger.info('Full JSON Request Body:');
    logger.info(JSON.stringify(payload, null, 2));
    logger.info('====================================================');

    try {
        const response = await axiosInstance.post(
            restUrl,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        // Log response
        logger.info('========== SFMC REST API RESPONSE (UPSERT) ==========');
        logger.info('Response Status Code: ' + response.status);
        logger.info('Response Status Text: ' + response.statusText);
        logger.info('Response Body:', JSON.stringify(response.data, null, 2));
        logger.info('=====================================================');

        if (response.status === 200 || response.status === 201 || response.status === 202) {
            logger.info('========== SFMC UPSERT SUCCESS ==========');
            logger.info('Data Extension: ' + dataExtensionKey);
            logger.info('Record ID: ' + (data.data_customer_id || data.event_id || 'N/A'));
            logger.info('HTTP Status: ' + response.status);
            logger.info('=========================================');
            return { success: true, response: response.data };
        } else {
            logger.error('Unexpected response status: ' + response.status);
            throw new Error(`SFMC Error: Unexpected response status ${response.status}`);
        }

    } catch (error) {
        logger.error('========== SFMC REST API ERROR (UPSERT) ==========');
        logger.error('REST API URL: ' + restUrl);
        logger.error('Data Extension: ' + dataExtensionKey);
        logger.error('Error Type: ' + error.name);
        logger.error('Error Message: ' + error.message);
        if (error.response) {
            logger.error('Response Status: ' + error.response.status);
            logger.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
            logger.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        if (error.request && !error.response) {
            logger.error('No response received - Request timed out or network error');
        }
        logger.error('Error Stack: ' + error.stack);
        logger.error('=================================================');
        throw error;
    }
}

/**
 * Batch upsert multiple records in a single API call
 * More efficient for processing multiple records
 */
async function batchUpsertToSFMC(dataExtensionKey, dataArray, primaryKeyField = 'data_customer_id') {
    if (!dataArray || dataArray.length === 0) {
        logger.warn('batchUpsertToSFMC called with empty array');
        return { success: true, response: 'No records to process', recordCount: 0 };
    }

    const { accessToken: token } = await getAccessToken();

    // Build URL
    const restBaseUrl = getRestBaseUrl();
    const restUrl = `${restBaseUrl}/hub/v1/dataevents/key:${dataExtensionKey}/rowset`;

    // Build batch payload
    const payload = dataArray.map(data => {
        const keys = {};
        const values = {};

        Object.keys(data).forEach(key => {
            if (!isBlankOrNull(data[key])) {
                const stringValue = String(data[key]);
                if (key === primaryKeyField) {
                    keys[key] = stringValue;
                }
                values[key] = stringValue;
            }
        });

        return { keys, values };
    });

    // Log request
    logger.info('========== SFMC REST API REQUEST (BATCH UPSERT) ==========');
    logger.info('REST API URL: ' + restUrl);
    logger.info('Request Method: POST');
    logger.info('Request Headers:', JSON.stringify({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + maskToken(token)
    }, null, 2));
    logger.info('Data Extension Key: ' + dataExtensionKey);
    logger.info('Total Records in Batch: ' + payload.length);
    logger.info('First Record Keys:', JSON.stringify(payload[0]?.keys, null, 2));
    logger.info('Payload Size: ' + (JSON.stringify(payload).length / 1024).toFixed(2) + 'KB');

    // Log first few records for debugging
    const previewRecords = payload.slice(0, 3);
    logger.info('First 3 Records Preview:', JSON.stringify(previewRecords, null, 2));

    if (payload.length > 3) {
        logger.info('... and ' + (payload.length - 3) + ' more records');
    }
    logger.info('==========================================================');

    try {
        const response = await axiosInstance.post(
            restUrl,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        // Log response
        logger.info('========== SFMC REST API RESPONSE (BATCH UPSERT) ==========');
        logger.info('Response Status Code: ' + response.status);
        logger.info('Response Status Text: ' + response.statusText);
        logger.info('Records Processed: ' + payload.length);
        logger.info('Response Body:', JSON.stringify(response.data, null, 2));
        logger.info('===========================================================');

        if (response.status === 200 || response.status === 201 || response.status === 202) {
            logger.info('========== SFMC BATCH UPSERT SUCCESS ==========');
            logger.info('Data Extension: ' + dataExtensionKey);
            logger.info('Records Upserted: ' + payload.length);
            logger.info('HTTP Status: ' + response.status);
            logger.info('===============================================');
            return { success: true, response: response.data, recordCount: payload.length };
        } else {
            throw new Error(`SFMC Batch Error: Unexpected response status ${response.status}`);
        }

    } catch (error) {
        logger.error('========== SFMC REST API ERROR (BATCH UPSERT) ==========');
        logger.error('REST API URL: ' + restUrl);
        logger.error('Data Extension: ' + dataExtensionKey);
        logger.error('Records Attempted: ' + payload.length);
        logger.error('Error Type: ' + error.name);
        logger.error('Error Message: ' + error.message);
        if (error.response) {
            logger.error('Response Status: ' + error.response.status);
            logger.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        logger.error('Error Stack: ' + error.stack);
        logger.error('=========================================================');
        throw error;
    }
}

/**
 * Upsert - Insert or Update (alias for insertToSFMC)
 */
async function upsertToSFMC(dataExtensionKey, data) {
    return insertToSFMC(dataExtensionKey, data);
}

/**
 * Clear token cache (for admin purposes)
 */
function clearTokenCache() {
    logger.info('Clearing SFMC token cache');
    accessToken = null;
    tokenExpiry = null;
    restInstanceUrl = null;
    cachedRestUrl = null;
    cachedAuthUrl = null;
}

/**
 * Get token status (for health checks)
 */
function getTokenStatus() {
    return {
        hasToken: !!accessToken,
        tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : null,
        isValid: accessToken && tokenExpiry && Date.now() < tokenExpiry,
        remainingSeconds: tokenExpiry ? Math.max(0, Math.floor((tokenExpiry - Date.now()) / 1000)) : 0,
        restInstanceUrl
    };
}

module.exports = {
    insertToSFMC,
    upsertToSFMC,
    batchUpsertToSFMC,
    getAccessToken,
    clearTokenCache,
    getTokenStatus
};
