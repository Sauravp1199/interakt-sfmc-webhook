/**
 * Enhanced Logger Utility - WITH FILE LOGGING
 * Logs to console AND file for debugging
 * In production, set LOG_LEVEL=WARN or ERROR for best performance
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

// Cache the log level check for performance
const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL || 'DEBUG';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ENABLE_FILE_LOGGING = process.env.ENABLE_FILE_LOGGING === 'true';

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (ENABLE_FILE_LOGGING && !fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Log file paths
const errorLogPath = path.join(logsDir, 'error.log');
const combinedLogPath = path.join(logsDir, 'combined.log');
const debugLogPath = path.join(logsDir, 'debug.log');
const debugRequestsLogPath = path.join(logsDir, 'debug-requests.log');

// Log rotation helpers
function rotateLogFile(filePath, maxSizeBytes = 10 * 1024 * 1024) { // 10MB default
    try {
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > maxSizeBytes) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = `${filePath}.${timestamp}.bak`;
                fs.renameSync(filePath, backupPath);
            }
        }
    } catch (err) {
        console.error('Log rotation error:', err.message);
    }
}

function writeToFile(filePath, message) {
    if (!ENABLE_FILE_LOGGING) return;

    try {
        rotateLogFile(filePath);
        fs.appendFileSync(filePath, message + '\n', { encoding: 'utf8' });
    } catch (err) {
        console.error(`Failed to write to log file ${filePath}:`, err.message);
    }
}

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
        ? ` | ${JSON.stringify(meta, null, 2)}`
        : '';

    return `[${timestamp}] [${level}] ${message}${metaString}`;
}

function error(message, meta = {}) {
    if (LOG_ERROR) {
        const formatted = formatMessage(LOG_LEVELS.ERROR, message, meta);
        console.error(formatted);
        writeToFile(errorLogPath, formatted);
        writeToFile(combinedLogPath, formatted);
    }
}

function warn(message, meta = {}) {
    if (LOG_WARN) {
        const formatted = formatMessage(LOG_LEVELS.WARN, message, meta);
        console.warn(formatted);
        writeToFile(combinedLogPath, formatted);
    }
}

function info(message, meta = {}) {
    if (LOG_INFO) {
        const formatted = formatMessage(LOG_LEVELS.INFO, message, meta);
        console.log(formatted);
        writeToFile(combinedLogPath, formatted);
    }
}

function debug(message, meta = {}) {
    if (LOG_DEBUG) {
        const formatted = formatMessage(LOG_LEVELS.DEBUG, message, meta);
        console.log(formatted);
        writeToFile(debugLogPath, formatted);
        writeToFile(combinedLogPath, formatted);
    }
}

/**
 * Log detailed request/response bodies to separate debug-requests.log file
 * Useful for debugging API interactions without cluttering other logs
 */
function debugRequest(requestInfo) {
    if (!ENABLE_FILE_LOGGING) return;

    const timestamp = new Date().toISOString();
    const separator = '═'.repeat(100);

    let logMessage = `\n${separator}\n[${timestamp}] REQUEST/RESPONSE DEBUG\n${separator}\n`;

    if (requestInfo.type) {
        logMessage += `\n📌 Type: ${requestInfo.type}\n`;
    }

    if (requestInfo.url) {
        logMessage += `\n🌐 URL: ${requestInfo.url}\n`;
    }

    if (requestInfo.method) {
        logMessage += `📤 Method: ${requestInfo.method}\n`;
    }

    if (requestInfo.requestHeaders) {
        logMessage += `\n📋 Request Headers:\n${JSON.stringify(requestInfo.requestHeaders, null, 2)}\n`;
    }

    if (requestInfo.requestBody) {
        logMessage += `\n📨 Request Body:\n${typeof requestInfo.requestBody === 'string'
            ? requestInfo.requestBody
            : JSON.stringify(requestInfo.requestBody, null, 2)}\n`;
    }

    if (requestInfo.statusCode) {
        logMessage += `\n✅ Response Status: ${requestInfo.statusCode}\n`;
    }

    if (requestInfo.responseHeaders) {
        logMessage += `\n📋 Response Headers:\n${JSON.stringify(requestInfo.responseHeaders, null, 2)}\n`;
    }

    if (requestInfo.responseBody) {
        logMessage += `\n📥 Response Body:\n${typeof requestInfo.responseBody === 'string'
            ? requestInfo.responseBody
            : JSON.stringify(requestInfo.responseBody, null, 2)}\n`;
    }

    if (requestInfo.error) {
        logMessage += `\n❌ Error: ${requestInfo.error}\n`;
    }

    if (requestInfo.errorStack) {
        logMessage += `\n🔗 Error Stack:\n${requestInfo.errorStack}\n`;
    }

    logMessage += `\n${separator}\n`;

    try {
        rotateLogFile(debugRequestsLogPath);
        fs.appendFileSync(debugRequestsLogPath, logMessage, { encoding: 'utf8' });
    } catch (err) {
        console.error(`Failed to write to debug-requests.log:`, err.message);
    }
}

function getLogs(type = 'combined') {
    const logFile = type === 'error' ? errorLogPath :
        type === 'debug' ? debugLogPath :
            type === 'debug-requests' ? debugRequestsLogPath :
                combinedLogPath;
    try {
        return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : 'No logs yet';
    } catch (err) {
        return `Error reading log file: ${err.message}`;
    }
}

function clearLogs() {
    try {
        if (fs.existsSync(errorLogPath)) fs.unlinkSync(errorLogPath);
        if (fs.existsSync(combinedLogPath)) fs.unlinkSync(combinedLogPath);
        if (fs.existsSync(debugLogPath)) fs.unlinkSync(debugLogPath);
        if (fs.existsSync(debugRequestsLogPath)) fs.unlinkSync(debugRequestsLogPath);
        console.log('✓ Log files cleared');
    } catch (err) {
        console.error('Error clearing logs:', err.message);
    }
}

module.exports = {
    error,
    warn,
    info,
    debug,
    debugRequest,
    getLogs,
    clearLogs,
    ENABLE_FILE_LOGGING,
    logsDir
};