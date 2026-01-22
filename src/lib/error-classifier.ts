/**
 * Error Classification Utilities
 * Determines if errors are retryable and categorizes them
 */

import { QueueErrorType } from './queue-types';
import axios from 'axios';

export interface ErrorClassificationResult {
    type: QueueErrorType;
    message: string;
    isRetryable: boolean;
    statusCode?: number;
}

/**
 * Classify an error and determine if it should be retried
 */
export function classifyError(error: unknown): ErrorClassificationResult {
    // Handle validation errors (non-retryable)
    if (error instanceof Error && error.name === 'ValidationError') {
        return {
            type: QueueErrorType.VALIDATION_ERROR,
            message: error.message,
            isRetryable: false,
        };
    }

    // Handle Axios errors
    if (axios.isAxiosError(error)) {
        return classifyAxiosError(error);
    }

    // Handle timeout errors (retryable)
    if (error instanceof Error && error.message.includes('timeout')) {
        return {
            type: QueueErrorType.TIMEOUT,
            message: error.message,
            isRetryable: true,
        };
    }

    // Handle network errors (retryable)
    if (
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ENETUNREACH') ||
            error.message.includes('EHOSTUNREACH'))
    ) {
        return {
            type: QueueErrorType.TEMPORARY_NETWORK_ERROR,
            message: error.message,
            isRetryable: true,
        };
    }

    // Default to unknown non-retryable error
    return {
        type: QueueErrorType.UNKNOWN_ERROR,
        message: error instanceof Error ? error.message : String(error),
        isRetryable: false,
    };
}

/**
 * Classify an Axios error specifically
 */
function classifyAxiosError(error: any): ErrorClassificationResult {
    const status = error.response?.status;
    const message = error.message || 'Unknown Axios error';

    // Handle timeout
    if (error.code === 'ECONNABORTED' || message.includes('timeout')) {
        return {
            type: QueueErrorType.TIMEOUT,
            message,
            isRetryable: true,
            statusCode: status,
        };
    }

    // Handle rate limiting (429) - retryable
    if (status === 429) {
        return {
            type: QueueErrorType.RATE_LIMIT,
            message: 'Rate limit exceeded (429)',
            isRetryable: true,
            statusCode: 429,
        };
    }

    // Handle server errors (5xx) - retryable
    if (status && status >= 500 && status < 600) {
        return {
            type: QueueErrorType.SERVER_ERROR,
            message: `Server error (${status})`,
            isRetryable: true,
            statusCode: status,
        };
    }

    // Handle 503 Service Unavailable - retryable
    if (status === 503) {
        return {
            type: QueueErrorType.TRANSIENT_ERROR,
            message: 'Service temporarily unavailable (503)',
            isRetryable: true,
            statusCode: 503,
        };
    }

    // Handle authentication errors (401, 403) - non-retryable
    if (status === 401 || status === 403) {
        return {
            type: QueueErrorType.AUTHENTICATION_ERROR,
            message: `Authentication error (${status})`,
            isRetryable: false,
            statusCode: status,
        };
    }

    // Handle not found errors (404) - non-retryable
    if (status === 404) {
        return {
            type: QueueErrorType.NOT_FOUND,
            message: 'Resource not found (404)',
            isRetryable: false,
            statusCode: status,
        };
    }

    // Handle other 4xx errors (bad request, etc.) - non-retryable
    if (status && status >= 400 && status < 500) {
        return {
            type: QueueErrorType.INVALID_PAYLOAD,
            message: `Client error (${status}): ${error.response?.data?.error || message}`,
            isRetryable: false,
            statusCode: status,
        };
    }

    // Handle network errors (no response) - retryable
    if (!error.response) {
        return {
            type: QueueErrorType.TEMPORARY_NETWORK_ERROR,
            message: `Network error: ${message}`,
            isRetryable: true,
        };
    }

    // Default
    return {
        type: QueueErrorType.UNKNOWN_ERROR,
        message,
        isRetryable: false,
        statusCode: status,
    };
}

/**
 * Get human-readable error description
 */
export function getErrorDescription(errorType: QueueErrorType): string {
    const descriptions: Record<QueueErrorType, string> = {
        [QueueErrorType.TIMEOUT]: 'Request timeout - temporary network issue',
        [QueueErrorType.RATE_LIMIT]: 'Rate limit exceeded (429) - too many requests',
        [QueueErrorType.TEMPORARY_NETWORK_ERROR]: 'Temporary network connectivity issue',
        [QueueErrorType.SERVER_ERROR]: 'Remote server error (5xx)',
        [QueueErrorType.TRANSIENT_ERROR]: 'Transient service error',
        [QueueErrorType.VALIDATION_ERROR]: 'Payload validation failed',
        [QueueErrorType.AUTHENTICATION_ERROR]: 'Authentication or authorization failed',
        [QueueErrorType.NOT_FOUND]: 'Resource not found',
        [QueueErrorType.INVALID_PAYLOAD]: 'Invalid payload or bad request',
        [QueueErrorType.UNKNOWN_ERROR]: 'Unknown error',
    };

    return descriptions[errorType] || 'Unknown error type';
}
