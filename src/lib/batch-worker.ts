/**
 * Batch Worker
 * Processes messages from main queue, batches them, and sends to SFMC
 */

import { logger } from '../utils/logger';
import { getQueueService } from './redis-queue';
import { upsertToDataExtension } from '../services/sfmcSoap';
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
     * Poll and process batches
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
     * Process a single batch from the queue
     */
    private async processBatch(): Promise<void> {
        const queueService = getQueueService();
        const batchConfig = queueService.getBatchConfig();

        // Check queue size - skip if empty or very small
        const stats = await queueService.getQueueStats();
        if (stats.mainQueue.size === 0) {
            return;
        }

        // Dequeue batch of messages
        const messages = await queueService.dequeueBatch(batchConfig.maxBatchSize);

        if (messages.length === 0) {
            return;
        }

        logger.info('Processing batch', {
            batchSize: messages.length,
            queueSize: stats.mainQueue.size,
        });

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
