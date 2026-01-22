/**
 * Error Classifier
 *
 * Classifies errors and determines retry strategy:
 * - Retryable errors: Network, timeouts, 429, 503, 502, 504
 * - Non-retryable: 400, 401, 403, 404, 422, etc.
 */

const logger = require('../utils/logger');

// Error classification constants
const ERROR_TYPES = {
    RATE_LIMITED: 'RATE_LIMITED', // 429
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', // 503, 502, 504
    TIMEOUT: 'TIMEOUT', // Connection/request timeout
    NETWORK_ERROR: 'NETWORK_ERROR', // Network issues
    AUTH_ERROR: 'AUTH_ERROR', // 401, 403
    VALIDATION_ERROR: 'VALIDATION_ERROR', // 400, 422
    NOT_FOUND: 'NOT_FOUND', // 404
    CLIENT_ERROR: 'CLIENT_ERROR', // Other 4xx
    SERVER_ERROR: 'SERVER_ERROR', // Other 5xx
    UNKNOWN_ERROR: 'UNKNOWN_ERROR', // Unknown
};

// Retry strategy for each error type
const RETRY_STRATEGY = {
    [ERROR_TYPES.RATE_LIMITED]: {
        shouldRetry: true,
        maxRetries: 10,
        initialBackoffMs: 1000,
        maxBackoffMs: 120000, // 2 minutes
        backoffMultiplier: 2,
        description: 'Rate limited - exponential backoff with extended waiting',
    },
    [ERROR_TYPES.SERVICE_UNAVAILABLE]: {
        shouldRetry: true,
        maxRetries: 5,
        initialBackoffMs: 2000,
        maxBackoffMs: 30000,
        backoffMultiplier: 2,
        description: 'Service unavailable - will retry',
    },
    [ERROR_TYPES.TIMEOUT]: {
        shouldRetry: true,
        maxRetries: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 10000,
        backoffMultiplier: 2,
        description: 'Timeout - will retry',
    },
    [ERROR_TYPES.NETWORK_ERROR]: {
        shouldRetry: true,
        maxRetries: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 10000,
        backoffMultiplier: 2,
        description: 'Network error - will retry',
    },
    [ERROR_TYPES.AUTH_ERROR]: {
        shouldRetry: true,
        maxRetries: 1,
        initialBackoffMs: 1000,
        maxBackoffMs: 5000,
        backoffMultiplier: 1,
        description: 'Auth error - will refresh token and retry once',
    },
    [ERROR_TYPES.VALIDATION_ERROR]: {
        shouldRetry: false,
        maxRetries: 0,
        description: 'Validation error - bad request, no retry',
    },
    [ERROR_TYPES.NOT_FOUND]: {
        shouldRetry: false,
        maxRetries: 0,
        description: 'Not found - no retry',
    },
    [ERROR_TYPES.CLIENT_ERROR]: {
        shouldRetry: false,
        maxRetries: 0,
        description: 'Client error - no retry',
    },
    [ERROR_TYPES.SERVER_ERROR]: {
        shouldRetry: true,
        maxRetries: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 15000,
        backoffMultiplier: 2,
        description: 'Server error - will retry',
    },
    [ERROR_TYPES.UNKNOWN_ERROR]: {
        shouldRetry: true,
        maxRetries: 2,
        initialBackoffMs: 1000,
        maxBackoffMs: 10000,
        backoffMultiplier: 2,
        description: 'Unknown error - will retry cautiously',
    },
};

/**
 * Classify an error
 * @param {Error|Object} error - Error object or axios error
 * @returns {Object} - Classification result
 */
function classifyError(error) {
    let errorType = ERROR_TYPES.UNKNOWN_ERROR;
    let statusCode = null;
    let message = error.message || 'Unknown error';
    let isRetryable = true;

    // Handle axios errors
    if (error.response) {
        statusCode = error.response.status;

        if (statusCode === 429) {
            errorType = ERROR_TYPES.RATE_LIMITED;
        } else if (statusCode === 503 || statusCode === 502 || statusCode === 504) {
            errorType = ERROR_TYPES.SERVICE_UNAVAILABLE;
        } else if (statusCode === 401 || statusCode === 403) {
            errorType = ERROR_TYPES.AUTH_ERROR;
        } else if (statusCode === 400 || statusCode === 422) {
            errorType = ERROR_TYPES.VALIDATION_ERROR;
        } else if (statusCode === 404) {
            errorType = ERROR_TYPES.NOT_FOUND;
        } else if (statusCode >= 400 && statusCode < 500) {
            errorType = ERROR_TYPES.CLIENT_ERROR;
        } else if (statusCode >= 500) {
            errorType = ERROR_TYPES.SERVER_ERROR;
        }

        message = error.response.data?.message || error.response.statusText || message;
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        errorType = ERROR_TYPES.TIMEOUT;
    } else if (
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'EHOSTUNREACH'
    ) {
        errorType = ERROR_TYPES.NETWORK_ERROR;
    } else if (error.request && !error.response) {
        errorType = ERROR_TYPES.NETWORK_ERROR;
    }

    const strategy = RETRY_STRATEGY[errorType];
    isRetryable = strategy.shouldRetry;

    return {
        errorType,
        statusCode,
        message,
        isRetryable,
        strategy,
    };
}

/**
 * Calculate backoff delay using exponential backoff
 * @param {number} retryCount - Current retry attempt (0-based)
 * @param {number} initialBackoffMs - Initial backoff in milliseconds
 * @param {number} maxBackoffMs - Maximum backoff in milliseconds
 * @param {number} multiplier - Exponential multiplier
 * @returns {number} - Delay in milliseconds
 */
function calculateBackoffDelay(retryCount, initialBackoffMs, maxBackoffMs, multiplier) {
    // Formula: initialBackoff * (multiplier ^ retryCount) + random jitter
    const exponentialDelay = initialBackoffMs * Math.pow(multiplier, retryCount);
    const cappedDelay = Math.min(exponentialDelay, maxBackoffMs);

    // Add random jitter (±10%)
    const jitter = cappedDelay * (0.9 + Math.random() * 0.2);

    return Math.ceil(jitter);
}

/**
 * Get retry info for an error
 * @param {Error|Object} error - Error to analyze
 * @param {number} retryCount - Current retry attempt
 * @returns {Object} - Retry information
 */
function getRetryInfo(error, retryCount = 0) {
    const classification = classifyError(error);
    const { strategy } = classification;

    if (!strategy.shouldRetry) {
        return {
            shouldRetry: false,
            reason: strategy.description,
            nextRetryMs: 0,
        };
    }

    if (retryCount >= strategy.maxRetries) {
        return {
            shouldRetry: false,
            reason: `Max retries (${strategy.maxRetries}) exceeded`,
            nextRetryMs: 0,
            maxRetriesReached: true,
        };
    }

    const nextRetryMs = calculateBackoffDelay(
        retryCount,
        strategy.initialBackoffMs,
        strategy.maxBackoffMs,
        strategy.backoffMultiplier
    );

    return {
        shouldRetry: true,
        reason: strategy.description,
        nextRetryMs,
        retryCount: retryCount + 1,
        maxRetries: strategy.maxRetries,
    };
}

/**
 * Log error classification
 * @param {Error} error - Error to log
 * @param {number} retryCount - Current retry count
 */
function logErrorClassification(error, retryCount = 0) {
    const classification = classifyError(error);
    const retryInfo = getRetryInfo(error, retryCount);

    logger.warn('Error classified for retry decision', {
        errorType: classification.errorType,
        statusCode: classification.statusCode,
        message: classification.message,
        isRetryable: classification.isRetryable,
        retryStrategy: classification.strategy.description,
        currentAttempt: retryCount + 1,
        maxRetries: classification.strategy.maxRetries,
        willRetry: retryInfo.shouldRetry,
        nextRetryMs: retryInfo.nextRetryMs,
    });
}

/**
 * Check if error is rate-limit related
 * @param {Error} error - Error to check
 * @returns {boolean}
 */
function isRateLimitError(error) {
    const classification = classifyError(error);
    return classification.errorType === ERROR_TYPES.RATE_LIMITED;
}

/**
 * Check if error is auth-related
 * @param {Error} error - Error to check
 * @returns {boolean}
 */
function isAuthError(error) {
    const classification = classifyError(error);
    return classification.errorType === ERROR_TYPES.AUTH_ERROR;
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    ERROR_TYPES,
    classifyError,
    calculateBackoffDelay,
    getRetryInfo,
    logErrorClassification,
    isRateLimitError,
    isAuthError,
    sleep,
};
