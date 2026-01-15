const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// In-memory cache with 24 hour TTL
const cache = new NodeCache({
    stdTTL: 86400, // 24 hours in seconds
    checkperiod: 3600, // Check for expired keys every hour
    useClones: false // Better performance
});

// Statistics tracking
let stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    startTime: new Date().toISOString()
};

/**
 * Check if a webhook has already been processed
 * @param {string} id - Unique identifier (message ID, workflow ID, etc.)
 * @returns {Promise<boolean>}
 */
async function isProcessed(id) {
    const exists = cache.has(id);

    if (exists) {
        stats.hits++;
        logger.debug('Duplicate webhook detected (cache hit)', { id });
    } else {
        stats.misses++;
    }

    return exists;
}

/**
 * Mark a webhook as processed
 * @param {string} id - Unique identifier
 * @param {string} webhookType - Type of webhook (optional)
 * @returns {Promise<void>}
 */
async function markProcessed(id, webhookType = null) {
    const data = {
        webhookType,
        processedAt: new Date().toISOString()
    };

    cache.set(id, data);
    stats.sets++;

    logger.debug('Marked as processed', {
        id,
        webhookType
    });
}

/**
 * Get cache statistics
 * @returns {object}
 */
function getStats() {
    const keys = cache.keys();
    const hitRate = stats.hits + stats.misses > 0
        ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2)
        : 0;

    return {
        cacheSize: keys.length,
        totalKeys: keys.length,
        hits: stats.hits,
        misses: stats.misses,
        sets: stats.sets,
        hitRate: `${hitRate}%`,
        startTime: stats.startTime,
        uptime: Math.floor((Date.now() - new Date(stats.startTime).getTime()) / 1000)
    };
}

/**
 * Clear all cached data
 * @returns {void}
 */
function clearCache() {
    const keyCount = cache.keys().length;
    cache.flushAll();

    logger.info('Cache cleared', { keysRemoved: keyCount });

    // Reset stats
    stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        startTime: new Date().toISOString()
    };
}

/**
 * Get specific cached item (for debugging)
 * @param {string} id
 * @returns {object|null}
 */
function getCached(id) {
    return cache.get(id);
}

module.exports = {
    isProcessed,
    markProcessed,
    getStats,
    clearCache,
    getCached
};