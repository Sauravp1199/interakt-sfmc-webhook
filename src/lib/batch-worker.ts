/**
 * Batch Worker
 * Processes messages from main queue, batches them, and sends to SFMC
 */

import { logger } from '../utils/logger';
import { getQueueService } from './redis-queue';
import { upsertToDataExtension } from '../services/sfmcRest';
import { classifyError, ErrorClassificationResult } from './error-classifier';
import { QueueMessage } from './queue-types';
import { config } from '../config';

export interface BatchWorkerConfig {
    enabled: boolean;
    pollIntervalMs: number;
    dataExtensionKey?: string;
}

export class BatchWorker {
    private isRunning = false;
    private pollInterval: NodeJS.Timeout | null = null;
    private config: BatchWorkerConfig;
    private lastMessageTime: number = 0;
    private currentBatchSize: number = 0;
    private batchStartTime: number = 0;

    constructor(config: BatchWorkerConfig) {
        this.config = {
            enabled: config.enabled !== false,
            pollIntervalMs: config.pollIntervalMs || 2000,
            dataExtensionKey:
                config.dataExtensionKey || config.dataExtensionKey || config.dataExtensionKey,
        };
    }

    /**
     * Start the batch worker
     */
    async start(): Promise<void> {
        if (!this.config.enabled) {
            logger.info('Batch worker is disabled');
            return;
        }

        if (this.isRunning) {
            logger.warn('Batch worker is already running');
            return;
        }

        this.isRunning = true;
        logger.info('Starting batch worker', {
            pollInterval: this.config.pollIntervalMs,
        });

        this.poll();
    }

    /**
     * Stop the batch worker
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn('Batch worker is not running');
            return;
        }

        this.isRunning = false;

        if (this.pollInterval) {
            clearTimeout(this.pollInterval);
            this.pollInterval = null;
        }

        logger.info('Batch worker stopped');
    }

    /**
     * Poll and process batches with intelligent timeout logic
     * - When 2+ records collected, waits 3 seconds
     * - If no new record in 3 seconds, flushes batch
     * - If batch reaches max size (1000), flushes immediately
     */
    private poll(): void {
        if (!this.isRunning) return;

        this.processBatch()
            .catch((error) => {
                logger.error('Batch worker error', {
                    error: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                this.pollInterval = setTimeout(() => this.poll(), this.config.pollIntervalMs);
            });
    }

    /**
     * Intelligent batch processing with smart timeout
     * Flushes when:
     * 1. Batch reaches 1000 records (max batch size)
     * 2. 3 seconds passed since last record AND 2+ records in batch
     * 3. Fallback timeout if no activity
     */
    private async processBatch(): Promise<void> {
        const queueService = getQueueService();
        const batchConfig = queueService.getBatchConfig();
        const now = Date.now();
        const SMART_TIMEOUT_MS = 3000; // 3 second timeout
        const FALLBACK_TIMEOUT_MS = 30000; // 30 second fallback timeout
        const MIN_RECORDS_FOR_TIMEOUT = 2; // Wait for at least 2 records

        // Check queue size
        const stats = await queueService.getQueueStats();
        if (stats.mainQueue.size === 0) {
            // Reset batch tracking if queue is empty
            this.lastMessageTime = 0;
            this.currentBatchSize = 0;
            return;
        }

        // Update tracking if queue has new messages
        if (stats.mainQueue.size > 0) {
            if (this.currentBatchSize === 0) {
                // First message(s) arriving - start batch timer
                this.batchStartTime = now;
                this.lastMessageTime = now;
                logger.debug('Smart batch: Starting new batch collection');
            } else {
                // More messages arriving - reset smart timeout
                this.lastMessageTime = now;
            }
            this.currentBatchSize = stats.mainQueue.size;
        }

        // Determine if batch should be flushed
        const timeSinceLastMessage = now - this.lastMessageTime;
        const timeSinceBatchStart = now - this.batchStartTime;
        const shouldFlush =
            this.currentBatchSize >= batchConfig.maxBatchSize || // Reached max size (1000)
            (this.currentBatchSize >= MIN_RECORDS_FOR_TIMEOUT &&
                timeSinceLastMessage >= SMART_TIMEOUT_MS) || // 3 sec timeout with 2+ records
            timeSinceBatchStart >= FALLBACK_TIMEOUT_MS; // Fallback 30 sec timeout

        if (!shouldFlush) {
            logger.debug('Smart batch: Waiting for more records', {
                currentSize: this.currentBatchSize,
                maxSize: batchConfig.maxBatchSize,
                timeSinceLastMsg: timeSinceLastMessage,
                timeout: SMART_TIMEOUT_MS,
            });
            return;
        }

        // Dequeue batch of messages
        const messages = await queueService.dequeueBatch(batchConfig.maxBatchSize);

        if (messages.length === 0) {
            // Reset batch state
            this.lastMessageTime = 0;
            this.currentBatchSize = 0;
            return;
        }

        // Log flush reason
        let flushReason = 'unknown';
        if (messages.length >= batchConfig.maxBatchSize) {
            flushReason = 'MAX_SIZE_REACHED (1000 records)';
        } else if (this.currentBatchSize >= MIN_RECORDS_FOR_TIMEOUT && timeSinceLastMessage >= SMART_TIMEOUT_MS) {
            flushReason = `SMART_TIMEOUT (${timeSinceLastMessage}ms since last message)`;
        } else if (timeSinceBatchStart >= FALLBACK_TIMEOUT_MS) {
            flushReason = `FALLBACK_TIMEOUT (${timeSinceBatchStart}ms since batch start)`;
        }

        logger.info('Smart batch: Flushing batch', {
            batchSize: messages.length,
            flushReason,
            queueRemaining: stats.mainQueue.size - messages.length,
        });

        // Reset batch tracking
        this.lastMessageTime = 0;
        this.currentBatchSize = 0;
        this.batchStartTime = 0;

        // Create batch object
        const batch = queueService.createBatch(
            messages,
            this.config.dataExtensionKey || config.dataExtensions.webhookMaster || config.dataExtensions.webhookEvents
        );

        // Process batch
        await this.processBatchMessages(batch.messages, batch.dataExtensionKey);
    }

    /**
     * Process batch messages and insert into SFMC
     */
    private async processBatchMessages(messages: QueueMessage[], dataExtensionKey: string): Promise<void> {
        const queueService = getQueueService();

        if (messages.length === 0) {
            return;
        }

        const batchStartTime = Date.now();

        try {
            // Reconstruct data from payload for each message
            const recordsToInsert = messages.map((msg) => msg.payload as Record<string, unknown>);

            logger.debug('Inserting batch to SFMC', {
                count: recordsToInsert.length,
                deKey: dataExtensionKey,
            });

            // Insert batch to SFMC Data Extension
            // Note: The actual upsertToDataExtension function handles batch insertion
            for (const record of recordsToInsert) {
                await upsertToDataExtension(dataExtensionKey, record);
            }

            const processingTime = Date.now() - batchStartTime;

            logger.info('Batch processed successfully', {
                count: messages.length,
                processingTime,
                deKey: dataExtensionKey,
            });

            // Increment success counter
            await queueService.incrementStat('processed', messages.length);

            // Track individual message success
            for (const msg of messages) {
                logger.debug('Message processed', {
                    messageId: msg.id,
                    batchId: msg.batchId,
                    requestId: msg.requestId,
                });
            }
        } catch (error) {
            const processingTime = Date.now() - batchStartTime;
            const errorClassification = classifyError(error);

            logger.error('Batch processing failed', {
                count: messages.length,
                errorType: errorClassification.type,
                errorMessage: errorClassification.message,
                processingTime,
            });

            // Route messages to appropriate DLQ based on error type
            await this.routeFailedMessages(messages, errorClassification);

            await queueService.incrementStat('failed', messages.length);
        }
    }

    /**
     * Route failed messages to appropriate DLQ
     */
    private async routeFailedMessages(
        messages: QueueMessage[],
        errorClassification: ErrorClassificationResult
    ): Promise<void> {
        const queueService = getQueueService();

        for (const msg of messages) {
            if (errorClassification.isRetryable) {
                // Move to retry DLQ for temporary failures
                await queueService.enqueueRetry(msg, {
                    type: errorClassification.type,
                    message: errorClassification.message,
                });

                logger.debug('Message moved to retry DLQ', {
                    messageId: msg.id,
                    errorType: errorClassification.type,
                });
            } else {
                // Move to bad payload DLQ for permanent failures
                await queueService.enqueueBadPayload(
                    msg,
                    [{ message: errorClassification.message, code: errorClassification.type }],
                    errorClassification.message,
                    'OTHER'
                );

                logger.debug('Message moved to bad payload DLQ', {
                    messageId: msg.id,
                    errorType: errorClassification.type,
                });
            }
        }
    }

    /**
     * Check if worker is running
     */
    isActive(): boolean {
        return this.isRunning;
    }
}

// Singleton instance
let batchWorkerInstance: BatchWorker | null = null;

export function initializeBatchWorker(config: BatchWorkerConfig): BatchWorker {
    if (!batchWorkerInstance) {
        batchWorkerInstance = new BatchWorker(config);
    }
    return batchWorkerInstance;
}

export function getBatchWorker(): BatchWorker {
    if (!batchWorkerInstance) {
        throw new Error('Batch worker not initialized');
    }
    return batchWorkerInstance;
}
