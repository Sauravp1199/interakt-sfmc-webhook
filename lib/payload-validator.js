/**
 * Payload Validator
 *
 * Validates request payloads against SFMC API limits before sending:
 * - Payload size limits
 * - Batch size limits
 * - Record count limits
 * - Field validation
 */

const logger = require('../utils/logger');

// API Limits
const LIMITS = {
    PAYLOAD_SIZE_BYTES: 5.9 * 1024 * 1024, // 5.9 MB for Data API
    BATCH_SIZE_ASYNC: 32000, // Async batch limit
    BATCH_SIZE_SYNC: 50, // Sync batch limit (we use async)
    RECORDS_PER_RESPONSE: 2500,
};

/**
 * Calculate payload size in bytes
 * @param {Array|Object} data - Data to measure
 * @returns {number} - Size in bytes
 */
function calculatePayloadSize(data) {
    const jsonString = JSON.stringify(data);
    // UTF-8 encoding: each character is typically 1-4 bytes
    return Buffer.byteLength(jsonString, 'utf8');
}

/**
 * Format bytes to human-readable
 * @param {number} bytes - Number of bytes
 * @returns {string} - Formatted string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validate single record payload
 * @param {Object} record - Single record to validate
 * @returns {Object} - Validation result
 */
function validateSingleRecord(record) {
    if (!record || typeof record !== 'object') {
        return {
            valid: false,
            error: 'Record must be an object',
        };
    }

    const recordSize = calculatePayloadSize(record);

    // Single record should not exceed 1MB
    if (recordSize > 1024 * 1024) {
        return {
            valid: false,
            error: `Record too large: ${formatBytes(recordSize)} (max 1 MB)`,
            size: recordSize,
        };
    }

    return {
        valid: true,
        size: recordSize,
    };
}

/**
 * Validate batch of records
 * @param {Array} records - Array of records
 * @param {Object} options - Validation options
 * @returns {Object} - Validation result
 */
function validateBatch(records, options = {}) {
    const isAsync = options.isAsync !== false; // Default to async
    const maxBatchSize = isAsync ? LIMITS.BATCH_SIZE_ASYNC : LIMITS.BATCH_SIZE_SYNC;

    // Check record count
    if (!Array.isArray(records)) {
        return {
            valid: false,
            error: 'Records must be an array',
        };
    }

    if (records.length === 0) {
        return {
            valid: false,
            error: 'Batch cannot be empty',
        };
    }

    if (records.length > maxBatchSize) {
        return {
            valid: false,
            error: `Batch too large: ${records.length} records (max ${maxBatchSize})`,
            recordCount: records.length,
            maxBatchSize,
        };
    }

    // Calculate total payload size
    const payloadSize = calculatePayloadSize(records);

    if (payloadSize > LIMITS.PAYLOAD_SIZE_BYTES) {
        const percentOfLimit = ((payloadSize / LIMITS.PAYLOAD_SIZE_BYTES) * 100).toFixed(1);
        return {
            valid: false,
            error: `Payload too large: ${formatBytes(payloadSize)} (${percentOfLimit}% of limit)`,
            size: payloadSize,
            maxSize: LIMITS.PAYLOAD_SIZE_BYTES,
        };
    }

    // Validate each record
    for (let i = 0; i < records.length; i++) {
        const recordValidation = validateSingleRecord(records[i]);
        if (!recordValidation.valid) {
            return {
                valid: false,
                error: `Record ${i} invalid: ${recordValidation.error}`,
                recordIndex: i,
            };
        }
    }

    const utilizationPercent = ((payloadSize / LIMITS.PAYLOAD_SIZE_BYTES) * 100).toFixed(1);

    return {
        valid: true,
        recordCount: records.length,
        payloadSize,
        payloadSizeFormatted: formatBytes(payloadSize),
        utilizationPercent: utilizationPercent + '%',
        warnings: [],
    };
}

/**
 * Split large batch into smaller chunks
 * @param {Array} records - Records to split
 * @param {Object} options - Split options
 * @returns {Array} - Array of batches
 */
function splitIntoBatches(records, options = {}) {
    const targetBatchSize = options.batchSize || 1000;
    const maxPayloadSize = options.maxPayloadSize || LIMITS.PAYLOAD_SIZE_BYTES * 0.9; // Use 90% limit

    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const record of records) {
        const recordSize = calculatePayloadSize(record);

        // Check if adding this record would exceed limits
        if (
            currentBatch.length >= targetBatchSize ||
            currentSize + recordSize > maxPayloadSize
        ) {
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
            }
            currentBatch = [];
            currentSize = 0;
        }

        currentBatch.push(record);
        currentSize += recordSize;
    }

    // Add final batch
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}

/**
 * Validate payload and return split batches if needed
 * @param {Array} records - Records to validate
 * @param {Object} options - Options
 * @returns {Object} - Result with batches or error
 */
function validateAndSplit(records, options = {}) {
    const validation = validateBatch(records, options);

    if (validation.valid) {
        return {
            valid: true,
            batches: [records],
            stats: {
                totalRecords: records.length,
                totalBatches: 1,
                payloadSize: validation.payloadSize,
                payloadSizeFormatted: validation.payloadSizeFormatted,
            },
        };
    }

    // Try splitting
    logger.warn('Batch validation failed, attempting to split', {
        reason: validation.error,
    });

    const batches = splitIntoBatches(records, options);

    if (batches.length === 1 && batches[0].length === records.length) {
        // Couldn't split effectively
        return {
            valid: false,
            error: validation.error,
            batches: [],
        };
    }

    // Validate all split batches
    const splitValidation = batches.map((batch) => validateBatch(batch, options));
    const allValid = splitValidation.every((v) => v.valid);

    if (!allValid) {
        const failedBatch = splitValidation.find((v) => !v.valid);
        return {
            valid: false,
            error: `Split validation failed: ${failedBatch.error}`,
            batches: [],
        };
    }

    const totalSize = splitValidation.reduce((sum, v) => sum + v.payloadSize, 0);

    return {
        valid: true,
        batches,
        stats: {
            totalRecords: records.length,
            totalBatches: batches.length,
            avgBatchSize: Math.ceil(records.length / batches.length),
            payloadSize: totalSize,
            payloadSizeFormatted: formatBytes(totalSize),
        },
    };
}

/**
 * Log validation warning if approaching limits
 * @param {Object} validation - Validation result
 */
function warnIfApproachingLimits(validation) {
    if (!validation.valid || !validation.payloadSize) return;

    const utilizationPercent = (validation.payloadSize / LIMITS.PAYLOAD_SIZE_BYTES) * 100;

    if (utilizationPercent > 80) {
        logger.warn('Approaching payload size limit', {
            payloadSizeFormatted: validation.payloadSizeFormatted,
            utilizationPercent: utilizationPercent.toFixed(1) + '%',
            recordCount: validation.recordCount,
        });
    }
}

module.exports = {
    LIMITS,
    calculatePayloadSize,
    formatBytes,
    validateSingleRecord,
    validateBatch,
    splitIntoBatches,
    validateAndSplit,
    warnIfApproachingLimits,
};
