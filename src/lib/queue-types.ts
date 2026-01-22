/**
 * Redis Queue Types and Interfaces
 * Defines structures for main queue, retry DLQ, and bad payload DLQ
 */

export enum QueueErrorType {
    // Retryable errors
    TIMEOUT = 'TIMEOUT',
    RATE_LIMIT = 'RATE_LIMIT', // 429
    TEMPORARY_NETWORK_ERROR = 'TEMPORARY_NETWORK_ERROR',
    SERVER_ERROR = 'SERVER_ERROR', // 5xx
    TRANSIENT_ERROR = 'TRANSIENT_ERROR',

    // Non-retryable errors
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR', // 401, 403
    NOT_FOUND = 'NOT_FOUND', // 404
    INVALID_PAYLOAD = 'INVALID_PAYLOAD',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface QueueMessage {
    // Message identifier
    id: string;

    // Original webhook payload
    payload: Record<string, unknown>;

    // Raw payload for signature verification if needed
    rawPayload: string;

    // Original webhook metadata
    webhookType: string;
    timestamp: number;

    // Request tracking
    requestId: string;

    // Processing metadata
    createdAt: number;
    attemptCount: number;
    lastAttemptAt?: number;

    // Error tracking
    lastError?: {
        type: QueueErrorType;
        message: string;
        timestamp: number;
    };

    // Batch information
    batchId?: string;
    batchSize?: number;
}

export interface BatchQueueMessage {
    // Batch identifier
    id: string;

    // Array of messages to be batched
    messages: QueueMessage[];

    // Batch metadata
    createdAt: number;
    dataExtensionKey: string;

    // Processing info
    attemptCount: number;
    lastAttemptAt?: number;

    // Error tracking
    lastError?: {
        type: QueueErrorType;
        message: string;
        timestamp: number;
    };
}

export interface RetryQueueMessage extends QueueMessage {
    // Retry specific metadata
    retryCount: number;
    maxRetries: number;
    nextRetryAt: number;
    backoffDelayMs: number;

    // History of retry attempts
    retryHistory: Array<{
        attemptNumber: number;
        error: {
            type: QueueErrorType;
            message: string;
        };
        timestamp: number;
    }>;
}

export interface BadPayloadMessage extends QueueMessage {
    // Why it failed validation
    validationErrors: Array<{
        field?: string;
        message: string;
        code?: string;
    }>;

    // Original error that triggered this
    originalError: string;

    // Classification
    errorClassification: 'SCHEMA_VALIDATION' | 'MALFORMED_JSON' | 'MISSING_REQUIRED_FIELD' | 'TYPE_ERROR' | 'OTHER';
}

export interface QueueStats {
    mainQueue: {
        size: number;
        oldestMessageAge: number; // in seconds
    };
    retryDLQ: {
        size: number;
        oldestMessageAge: number;
    };
    badPayloadDLQ: {
        size: number;
        oldestMessageAge: number;
    };
    totalProcessed: number;
    totalFailed: number;
    totalDiscarded: number;
}

export interface RetryConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

export interface BatchConfig {
    maxBatchSize: number; // Maximum number of messages per batch
    maxBatchBytes: number; // Maximum total size in bytes
    batchTimeoutMs: number; // Time to wait before sending partial batch
}

export interface WorkerConfig {
    enabled: boolean;
    interval: number; // Polling interval in ms
    idleThreshold: number; // Consider idle if queue size < threshold for duration
    idleDurationMs: number; // Duration to be idle before processing retries
}
