/**
 * Redis Queue Service
 * Manages main queue, retry DLQ, and bad payload DLQ with batching support
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
    QueueMessage,
    RetryQueueMessage,
    BadPayloadMessage,
    BatchQueueMessage,
    QueueErrorType,
    QueueStats,
    RetryConfig,
    BatchConfig,
} from './queue-types';

export class RedisQueueService {
    private redis: Redis;
    private readonly MAIN_QUEUE_KEY = 'webhook:queue:main';
    private readonly RETRY_DLQ_KEY = 'webhook:dlq:retry';
    private readonly BAD_PAYLOAD_DLQ_KEY = 'webhook:dlq:bad-payload';

    private retryConfig: RetryConfig;
    private batchConfig: BatchConfig;

    constructor(redisUrl?: string) {
        this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379');

        // Initialize configurations
        this.retryConfig = {
            maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '5', 10),
            initialDelayMs: parseInt(process.env.QUEUE_RETRY_INITIAL_DELAY || '5000', 10),
            maxDelayMs: parseInt(process.env.QUEUE_RETRY_MAX_DELAY || '300000', 10), // 5 minutes
            backoffMultiplier: parseFloat(process.env.QUEUE_RETRY_BACKOFF || '2.0'),
        };

        this.batchConfig = {
            maxBatchSize: parseInt(process.env.QUEUE_BATCH_SIZE || '30', 10),
            maxBatchBytes: parseInt(process.env.QUEUE_BATCH_BYTES || '1048576', 10), // 1MB
            batchTimeoutMs: parseInt(process.env.QUEUE_BATCH_TIMEOUT || '5000', 10), // 5 seconds
        };

        this.setupRedisEventHandlers();
    }

    /**
     * Setup Redis connection event handlers
     */
    private setupRedisEventHandlers(): void {
        this.redis.on('connect', () => {
            logger.info('Redis queue service connected');
        });

        this.redis.on('error', (error: Error) => {
            logger.error('Redis queue service error', { error: error.message });
        });

        this.redis.on('close', () => {
            logger.warn('Redis queue service connection closed');
        });
    }

    /**
     * Add message to main queue
     * Returns the queue position for tracking
     */
    async enqueueMain(
        payload: Record<string, unknown>,
        rawPayload: string,
        webhookType: string,
        requestId: string
    ): Promise<number> {
        const message: QueueMessage = {
            id: `msg_${uuidv4()}`,
            payload,
            rawPayload,
            webhookType,
            timestamp: Date.now(),
            requestId,
            createdAt: Date.now(),
            attemptCount: 0,
        };

        const serialized = JSON.stringify(message);
        const position = await this.redis.rpush(this.MAIN_QUEUE_KEY, serialized);

        logger.debug('Message enqueued to main queue', {
            messageId: message.id,
            position,
            queueSize: position,
        });

        return position;
    }

    /**
     * Dequeue a single message from main queue
     */
    async dequeueMain(): Promise<QueueMessage | null> {
        const serialized = await this.redis.lpop(this.MAIN_QUEUE_KEY);
        if (!serialized) return null;

        const message: QueueMessage = JSON.parse(serialized);
        message.attemptCount++;
        message.lastAttemptAt = Date.now();

        return message;
    }

    /**
     * Dequeue multiple messages for batching
     */
    async dequeueBatch(maxCount: number = this.batchConfig.maxBatchSize): Promise<QueueMessage[]> {
        const messages: QueueMessage[] = [];
        let totalBytes = 0;

        for (let i = 0; i < maxCount; i++) {
            const serialized = await this.redis.lpop(this.MAIN_QUEUE_KEY);
            if (!serialized) break;

            const message: QueueMessage = JSON.parse(serialized);
            const messageBytes = Buffer.byteLength(JSON.stringify(message), 'utf-8');

            if (totalBytes + messageBytes > this.batchConfig.maxBatchBytes && messages.length > 0) {
                // Push message back if batch is full
                await this.redis.lpush(this.MAIN_QUEUE_KEY, serialized);
                break;
            }

            message.attemptCount++;
            message.lastAttemptAt = Date.now();
            messages.push(message);
            totalBytes += messageBytes;
        }

        return messages;
    }

    /**
     * Create a batch from messages
     */
    createBatch(messages: QueueMessage[], dataExtensionKey: string): BatchQueueMessage {
        const batch: BatchQueueMessage = {
            id: `batch_${uuidv4()}`,
            messages,
            createdAt: Date.now(),
            dataExtensionKey,
            attemptCount: 0,
        };

        // Mark messages with batch info
        messages.forEach((msg) => {
            msg.batchId = batch.id;
            msg.batchSize = messages.length;
        });

        return batch;
    }

    /**
     * Add message to retry DLQ
     */
    async enqueueRetry(
        message: QueueMessage,
        error: { type: QueueErrorType; message: string }
    ): Promise<string> {
        const retryMessage: RetryQueueMessage = {
            ...message,
            retryCount: message.attemptCount - 1,
            maxRetries: this.retryConfig.maxRetries,
            nextRetryAt: this.calculateNextRetryTime(message.attemptCount - 1),
            backoffDelayMs: this.calculateBackoffDelay(message.attemptCount - 1),
            retryHistory: [
                {
                    attemptNumber: message.attemptCount - 1,
                    error,
                    timestamp: Date.now(),
                },
            ],
        };

        const serialized = JSON.stringify(retryMessage);
        await this.redis.rpush(this.RETRY_DLQ_KEY, serialized);

        logger.info('Message moved to retry DLQ', {
            messageId: message.id,
            errorType: error.type,
            retryCount: retryMessage.retryCount,
            nextRetryAt: new Date(retryMessage.nextRetryAt).toISOString(),
        });

        return retryMessage.id;
    }

    /**
     * Add message to bad payload DLQ (non-retryable errors)
     */
    async enqueueBadPayload(
        message: QueueMessage,
        validationErrors: Array<{ field?: string; message: string; code?: string }>,
        originalError: string,
        classification: BadPayloadMessage['errorClassification']
    ): Promise<string> {
        const badPayloadMessage: BadPayloadMessage = {
            ...message,
            validationErrors,
            originalError,
            errorClassification: classification,
        };

        const serialized = JSON.stringify(badPayloadMessage);
        await this.redis.rpush(this.BAD_PAYLOAD_DLQ_KEY, serialized);

        logger.warn('Message moved to bad payload DLQ', {
            messageId: message.id,
            errorCount: validationErrors.length,
            classification,
        });

        return badPayloadMessage.id;
    }

    /**
     * Get next message from retry DLQ if retry time has passed
     */
    async getNextRetryMessage(): Promise<RetryQueueMessage | null> {
        const serialized = await this.redis.lpop(this.RETRY_DLQ_KEY);
        if (!serialized) return null;

        const message: RetryQueueMessage = JSON.parse(serialized);

        // Check if retry time has passed
        if (Date.now() < message.nextRetryAt) {
            // Not ready yet, push back to queue
            await this.redis.lpush(this.RETRY_DLQ_KEY, serialized);
            return null;
        }

        return message;
    }

    /**
     * Get all retry messages (for monitoring)
     */
    async getAllRetryMessages(): Promise<RetryQueueMessage[]> {
        const range = await this.redis.lrange(this.RETRY_DLQ_KEY, 0, -1);
        return (range as string[]).map((serialized: string) => JSON.parse(serialized) as RetryQueueMessage);
    }

    /**
     * Get all bad payload messages (for monitoring)
     */
    async getAllBadPayloadMessages(): Promise<BadPayloadMessage[]> {
        const range = await this.redis.lrange(this.BAD_PAYLOAD_DLQ_KEY, 0, -1);
        return (range as string[]).map((serialized: string) => JSON.parse(serialized) as BadPayloadMessage);
    }

    /**
     * Move retry message back to retry DLQ with updated retry history
     */
    async requeueRetry(
        message: RetryQueueMessage,
        error: { type: QueueErrorType; message: string }
    ): Promise<boolean> {
        if (message.retryCount >= message.maxRetries) {
            logger.warn('Message exceeded max retries, discarding', {
                messageId: message.id,
                retryCount: message.retryCount,
                maxRetries: message.maxRetries,
            });
            return false;
        }

        message.retryCount++;
        message.attemptCount++;
        message.lastAttemptAt = Date.now();
        message.nextRetryAt = this.calculateNextRetryTime(message.retryCount);
        message.backoffDelayMs = this.calculateBackoffDelay(message.retryCount);
        message.lastError = {
            type: error.type,
            message: error.message,
            timestamp: Date.now(),
        };
        message.retryHistory.push({
            attemptNumber: message.retryCount,
            error,
            timestamp: Date.now(),
        });

        const serialized = JSON.stringify(message);
        await this.redis.rpush(this.RETRY_DLQ_KEY, serialized);

        logger.info('Retry message requeued', {
            messageId: message.id,
            retryCount: message.retryCount,
            nextRetryAt: new Date(message.nextRetryAt).toISOString(),
        });

        return true;
    }

    /**
     * Get queue statistics
     */
    async getQueueStats(): Promise<QueueStats> {
        const [mainQueueSize, retryDLQSize, badPayloadDLQSize, totalProcessed, totalFailed, totalDiscarded] =
            await Promise.all([
                this.redis.llen(this.MAIN_QUEUE_KEY),
                this.redis.llen(this.RETRY_DLQ_KEY),
                this.redis.llen(this.BAD_PAYLOAD_DLQ_KEY),
                this.redis.get('stats:total_processed').then((v: string | null) => parseInt(v || '0', 10)),
                this.redis.get('stats:total_failed').then((v: string | null) => parseInt(v || '0', 10)),
                this.redis.get('stats:total_discarded').then((v: string | null) => parseInt(v || '0', 10)),
            ]);

        const getOldestAge = async (key: string): Promise<number> => {
            const oldest = await this.redis.lindex(key, -1);
            if (!oldest) return 0;
            const message: QueueMessage = JSON.parse(oldest);
            return Math.floor((Date.now() - message.createdAt) / 1000);
        };

        const [oldestMainAge, oldestRetryAge, oldestBadPayloadAge] = await Promise.all([
            getOldestAge(this.MAIN_QUEUE_KEY),
            getOldestAge(this.RETRY_DLQ_KEY),
            getOldestAge(this.BAD_PAYLOAD_DLQ_KEY),
        ]);

        return {
            mainQueue: {
                size: mainQueueSize,
                oldestMessageAge: oldestMainAge,
            },
            retryDLQ: {
                size: retryDLQSize,
                oldestMessageAge: oldestRetryAge,
            },
            badPayloadDLQ: {
                size: badPayloadDLQSize,
                oldestMessageAge: oldestBadPayloadAge,
            },
            totalProcessed,
            totalFailed,
            totalDiscarded,
        };
    }

    /**
     * Increment statistics counter
     */
    async incrementStat(stat: 'processed' | 'failed' | 'discarded', count: number = 1): Promise<void> {
        const key = `stats:total_${stat}`;
        await this.redis.incrby(key, count);
    }

    /**
     * Clear all queues (use with caution - only for testing/reset)
     */
    async clearAll(): Promise<void> {
        await Promise.all([
            this.redis.del(this.MAIN_QUEUE_KEY),
            this.redis.del(this.RETRY_DLQ_KEY),
            this.redis.del(this.BAD_PAYLOAD_DLQ_KEY),
        ]);
        logger.warn('All queues cleared');
    }

    /**
     * Close Redis connection
     */
    async close(): Promise<void> {
        await this.redis.quit();
        logger.info('Redis queue service connection closed');
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    private calculateBackoffDelay(retryCount: number): number {
        const delay = this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, retryCount);
        return Math.min(delay, this.retryConfig.maxDelayMs);
    }

    /**
     * Calculate next retry time
     */
    private calculateNextRetryTime(retryCount: number): number {
        return Date.now() + this.calculateBackoffDelay(retryCount);
    }

    /**
     * Get retry configuration
     */
    getRetryConfig(): RetryConfig {
        return this.retryConfig;
    }

    /**
     * Get batch configuration
     */
    getBatchConfig(): BatchConfig {
        return this.batchConfig;
    }

    /**
     * Determine if error is retryable
     */
    static isRetryableError(errorType: QueueErrorType): boolean {
        const retryableErrors = [
            QueueErrorType.TIMEOUT,
            QueueErrorType.RATE_LIMIT,
            QueueErrorType.TEMPORARY_NETWORK_ERROR,
            QueueErrorType.SERVER_ERROR,
            QueueErrorType.TRANSIENT_ERROR,
        ];
        return retryableErrors.includes(errorType);
    }

    /**
     * Get Redis client for custom operations
     */
    getRedisClient(): Redis {
        return this.redis;
    }
}

// Export singleton instance
let queueServiceInstance: RedisQueueService | null = null;

export function initializeQueueService(redisUrl?: string): RedisQueueService {
    if (!queueServiceInstance) {
        queueServiceInstance = new RedisQueueService(redisUrl);
    }
    return queueServiceInstance;
}

export function getQueueService(): RedisQueueService {
    if (!queueServiceInstance) {
        throw new Error('Queue service not initialized. Call initializeQueueService first.');
    }
    return queueServiceInstance;
}
