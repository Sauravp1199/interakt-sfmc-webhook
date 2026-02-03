const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// In-memory cache with 30 minute TTL
const cache = new NodeCache({
    stdTTL: 1800, // 30 minutes in seconds (30 * 60)
    checkperiod: 300, // Check for expired keys every 5 minutes
    useClones: false // Better performance
});

// Statistics tracking
let stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    startTime: new Date().toISOString()
};

// Auto-clear timer
const AUTO_CLEAR_INTERVAL = parseInt(process.env.AUTO_CLEAR_INTERVAL) || 600000; // 10 minutes default
let autoClearTimer = null;

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
 * Start automatic cache clearing every 30 minutes (or configurable interval)
 * @returns {void}
 */
function startAutoClearTimer() {
    if (autoClearTimer) {
        clearInterval(autoClearTimer);
    }

    autoClearTimer = setInterval(() => {
        const keyCount = cache.keys().length;
        logger.info('Auto-clear timer triggered', {
            interval: `${(AUTO_CLEAR_INTERVAL / 1000 / 60).toFixed(0)} minutes`,
            keysToRemove: keyCount
        });
        clearCache();
    }, AUTO_CLEAR_INTERVAL);

    logger.info('Auto-clear timer started', {
        interval: `${(AUTO_CLEAR_INTERVAL / 1000 / 60).toFixed(0)} minutes`
    });
}

/**
 * Stop automatic cache clearing
 * @returns {void}
 */
function stopAutoClearTimer() {
    if (autoClearTimer) {
        clearInterval(autoClearTimer);
        autoClearTimer = null;
        logger.info('Auto-clear timer stopped');
    }
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
    getCached,
    startAutoClearTimer,
    stopAutoClearTimer
};