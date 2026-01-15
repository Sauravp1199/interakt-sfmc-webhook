/**
 * Simple logger utility - OPTIMIZED FOR PERFORMANCE
 * In production, set LOG_LEVEL=WARN or ERROR for best performance
 */

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

// Cache the log level check for performance
const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const LOG_LEVEL_PRIORITY = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// Pre-compute which levels to log
const LOG_ERROR = LOG_LEVEL_PRIORITY.ERROR <= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];
const LOG_WARN = LOG_LEVEL_PRIORITY.WARN <= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];
const LOG_INFO = LOG_LEVEL_PRIORITY.INFO <= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];
const LOG_DEBUG = LOG_LEVEL_PRIORITY.DEBUG <= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];

function shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];
}

function formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    // Skip meta serialization in production for INFO level (performance)
    if (IS_PRODUCTION && level === 'INFO' && Object.keys(meta).length > 3) {
        // Only include essential keys in production
        const essentialMeta = {};
        if (meta.requestId) essentialMeta.requestId = meta.requestId;
        if (meta.type) essentialMeta.type = meta.type;
        if (meta.error) essentialMeta.error = meta.error;
        const metaString = Object.keys(essentialMeta).length > 0
            ? ` | ${JSON.stringify(essentialMeta)}`
            : '';
        return `[${timestamp}] [${level}] ${message}${metaString}`;
    }
    const metaString = Object.keys(meta).length > 0
        ? ` | ${JSON.stringify(meta)}`
        : '';

    return `[${timestamp}] [${level}] ${message}${metaString}`;
}

function error(message, meta = {}) {
    if (LOG_ERROR) {
        console.error(formatMessage(LOG_LEVELS.ERROR, message, meta));
    }
}

function warn(message, meta = {}) {
    if (LOG_WARN) {
        console.warn(formatMessage(LOG_LEVELS.WARN, message, meta));
    }
}

function info(message, meta = {}) {
    if (LOG_INFO) {
        console.log(formatMessage(LOG_LEVELS.INFO, message, meta));
    }
}

function debug(message, meta = {}) {
    if (LOG_DEBUG) {
        console.log(formatMessage(LOG_LEVELS.DEBUG, message, meta));
    }
}

module.exports = {
    error,
    warn,
    info,
    debug
};