/**
 * Queue System for SFMC Data Extension Inserts
 *
 * Implements batching and rate limiting to handle:
 * - Timeouts for large bulk inserts
 * - REST throttling (soft limit: ~2,500 requests/min)
 * - Payload size (practical limit ~4MB per request)
 *
 * Strategy:
 * - Batch size: 200-500 rows/request (configurable)
 * - Request size: max 4MB
 * - Rate limiting: stay under SFMC limits
 */

const logger = require('../utils/logger');

// Queue configuration from environment
const BATCH_SIZE = parseInt(process.env.QUEUE_BATCH_SIZE) || 2;
const MAX_REQUEST_SIZE = parseInt(process.env.QUEUE_MAX_REQUEST_SIZE) || 4000000; // 4MB
const FLUSH_INTERVAL = parseInt(process.env.QUEUE_FLUSH_INTERVAL) || 5000; // 5 seconds
const RATE_LIMIT = parseInt(process.env.QUEUE_RATE_LIMIT) || 2000; // requests per minute

// Queue state
let queue = [];
let queueSize = 0; // Track approximate size in bytes
let flushTimer = null;
let processingPromise = null;
let sfmcClient = null;

// Rate limiting state
let requestCount = 0;
let rateLimitResetTime = Date.now() + 60000;

// Statistics
const stats = {
    totalQueued: 0,
    totalProcessed: 0,
    totalBatches: 0,
    totalErrors: 0,
    lastFlushTime: null,
    averageBatchSize: 0
};

/**
 * Initialize queue with SFMC client
 * @param {Object} client - SFMC client instance
 */
function initQueue(client) {
    sfmcClient = client;
    startFlushTimer();
    logger.info('========== QUEUE INITIALIZED ==========');
    logger.info('Queue Configuration:', {
        batchSize: BATCH_SIZE,
        maxRequestSize: `${(MAX_REQUEST_SIZE / 1024 / 1024).toFixed(2)}MB`,
        flushInterval: `${FLUSH_INTERVAL}ms`,
        rateLimit: `${RATE_LIMIT}/min`
    });
    logger.info('========================================');
}

/**
 * Start the periodic flush timer
 */
function startFlushTimer() {
    if (flushTimer) {
        clearInterval(flushTimer);
    }
    flushTimer = setInterval(() => {
        if (queue.length > 0) {
            logger.debug('Periodic flush triggered', { queueLength: queue.length });
            flush();
        }
    }, FLUSH_INTERVAL);
}

/**
 * Stop the flush timer (for graceful shutdown)
 */
function stopFlushTimer() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
}

/**
 * Check and reset rate limit counter
 */
function checkRateLimit() {
    const now = Date.now();
    if (now >= rateLimitResetTime) {
        requestCount = 0;
        rateLimitResetTime = now + 60000;
    }
    return requestCount < RATE_LIMIT;
}

/**
 * Calculate approximate size of data object in bytes
 * @param {Object} data - Data object
 * @returns {number} - Approximate size in bytes
 */
function calculateSize(data) {
    return JSON.stringify(data).length * 2; // UTF-16 approximation
}

/**
 * Add item to queue
 * @param {string} dataExtensionKey - DE key
 * @param {Object} data - Row data to insert
 * @param {string} primaryKeyField - Primary key field name
 * @returns {Promise<void>}
 */
async function enqueue(dataExtensionKey, data, primaryKeyField = 'data_customer_id') {
    const item = {
        dataExtensionKey,
        data,
        primaryKeyField,
        timestamp: Date.now()
    };

    const itemSize = calculateSize(item);

    logger.debug('Enqueueing item', {
        dataExtensionKey,
        eventId: data.event_id,
        type: data.type,
        itemSize: `${(itemSize / 1024).toFixed(2)}KB`
    });

    queue.push(item);
    queueSize += itemSize;
    stats.totalQueued++;

    // Flush if batch size reached or size limit approaching
    if (queue.length >= BATCH_SIZE || queueSize >= MAX_REQUEST_SIZE * 0.9) {
        logger.info('Queue threshold reached, triggering flush', {
            queueLength: queue.length,
            queueSize: `${(queueSize / 1024 / 1024).toFixed(2)}MB`,
            trigger: queue.length >= BATCH_SIZE ? 'BATCH_SIZE' : 'SIZE_LIMIT'
        });
        await flush();
    }
}

/**
 * Flush queue - process all pending items
 * @returns {Promise<Object>} - Flush result
 */
async function flush() {
    // Prevent concurrent flushes
    if (processingPromise) {
        logger.debug('Flush already in progress, waiting...');
        return processingPromise;
    }

    if (queue.length === 0) {
        logger.debug('Queue empty, nothing to flush');
        return { success: true, processed: 0 };
    }

    processingPromise = processQueue();
    const result = await processingPromise;
    processingPromise = null;
    return result;
}

/**
 * Process queue items in batches
 * @returns {Promise<Object>} - Processing result
 */
async function processQueue() {
    const startTime = Date.now();
    const itemsToProcess = [...queue];
    queue = [];
    queueSize = 0;

    logger.info('========== QUEUE FLUSH STARTED ==========');
    logger.info('Items to process: ' + itemsToProcess.length);

    if (!sfmcClient) {
        logger.error('SFMC client not initialized');
        // Re-queue items
        queue = itemsToProcess;
        queueSize = itemsToProcess.reduce((sum, item) => sum + calculateSize(item), 0);
        return { success: false, error: 'SFMC client not initialized' };
    }

    // Group by data extension key
    const grouped = {};
    itemsToProcess.forEach(item => {
        if (!grouped[item.dataExtensionKey]) {
            grouped[item.dataExtensionKey] = [];
        }
        grouped[item.dataExtensionKey].push(item);
    });

    logger.info('Grouped by Data Extension:', Object.keys(grouped).map(key => ({
        deKey: key,
        count: grouped[key].length
    })));

    let totalProcessed = 0;
    let totalErrors = 0;

    // Process each DE group
    for (const [deKey, items] of Object.entries(grouped)) {
        // Split into batches respecting size limits
        const batches = createBatches(items);

        logger.info(`Processing DE: ${deKey}`, {
            totalItems: items.length,
            batches: batches.length
        });

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];

            // Check rate limit
            if (!checkRateLimit()) {
                const waitTime = rateLimitResetTime - Date.now();
                logger.warn('Rate limit approaching, waiting...', { waitTime: `${waitTime}ms` });
                await sleep(waitTime);
            }

            try {
                logger.info(`--- Batch ${i + 1}/${batches.length} ---`);
                logger.info('Batch size: ' + batch.length + ' records');

                const dataArray = batch.map(item => item.data);
                const result = await sfmcClient.batchUpsertToSFMC(
                    deKey,
                    dataArray,
                    batch[0].primaryKeyField
                );

                requestCount++;
                totalProcessed += batch.length;
                stats.totalProcessed += batch.length;
                stats.totalBatches++;

                logger.info('Batch processed successfully', {
                    batchNumber: i + 1,
                    recordsProcessed: batch.length,
                    response: result.success ? 'SUCCESS' : 'FAILED'
                });

            } catch (error) {
                totalErrors += batch.length;
                stats.totalErrors += batch.length;

                logger.error('========== BATCH PROCESSING ERROR ==========');
                logger.error('Data Extension: ' + deKey);
                logger.error('Batch Number: ' + (i + 1));
                logger.error('Batch Size: ' + batch.length);
                logger.error('Error Type: ' + error.name);
                logger.error('Error Message: ' + error.message);
                logger.error('Error Stack: ' + error.stack);
                logger.error('============================================');

                // Re-queue failed items for retry
                batch.forEach(item => {
                    queue.push(item);
                    queueSize += calculateSize(item);
                });
            }
        }
    }

    const processingTime = Date.now() - startTime;
    stats.lastFlushTime = new Date().toISOString();
    stats.averageBatchSize = stats.totalBatches > 0
        ? Math.round(stats.totalProcessed / stats.totalBatches)
        : 0;

    logger.info('========== QUEUE FLUSH COMPLETED ==========');
    logger.info('Processing Time: ' + processingTime + 'ms');
    logger.info('Total Processed: ' + totalProcessed);
    logger.info('Total Errors: ' + totalErrors);
    logger.info('Items Re-queued: ' + queue.length);
    logger.info('============================================');

    return {
        success: totalErrors === 0,
        processed: totalProcessed,
        errors: totalErrors,
        requeued: queue.length,
        processingTime
    };
}

/**
 * Create batches from items respecting size limits
 * @param {Array} items - Items to batch
 * @returns {Array} - Array of batches
 */
function createBatches(items) {
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const item of items) {
        const itemSize = calculateSize(item);

        // Check if adding this item would exceed limits
        if (currentBatch.length >= BATCH_SIZE ||
            (currentSize + itemSize) >= MAX_REQUEST_SIZE * 0.9) {
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
            }
            currentBatch = [];
            currentSize = 0;
        }

        currentBatch.push(item);
        currentSize += itemSize;
    }

    // Don't forget the last batch
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get queue statistics
 * @returns {Object} - Queue stats
 */
function getQueueStats() {
    return {
        ...stats,
        currentQueueLength: queue.length,
        currentQueueSize: `${(queueSize / 1024).toFixed(2)}KB`,
        requestsThisMinute: requestCount,
        rateLimit: RATE_LIMIT,
        batchSize: BATCH_SIZE
    };
}

/**
 * Force flush and shutdown
 * @returns {Promise<Object>}
 */
async function shutdown() {
    logger.info('Queue shutdown initiated...');
    stopFlushTimer();

    if (queue.length > 0) {
        logger.info('Flushing remaining ' + queue.length + ' items before shutdown');
        return await flush();
    }

    return { success: true, processed: 0 };
}

module.exports = {
    initQueue,
    enqueue,
    flush,
    getQueueStats,
    shutdown,
    stopFlushTimer
};
