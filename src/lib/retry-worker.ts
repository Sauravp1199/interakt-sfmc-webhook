/**
 * Retry Worker
 * Processes retry DLQ when system is idle
 * Implements idle detection and backoff-based retry mechanism
 */

import { logger } from '../utils/logger';
import { getQueueService } from './redis-queue';
import { upsertToDataExtension } from '../services/sfmcSoap';
import { classifyError } from './error-classifier';
import { config } from '../config';

export interface IdleDetectorConfig {
    idleQueueThreshold: number; // Consider idle if queue size < this
    idleDurationMs: number; // Must be idle for this duration
    pollIntervalMs: number; // How often to check idle state
}

export interface RetryWorkerConfig {
    enabled: boolean;
    maxRetryAttempts: number;
    idleDetector: IdleDetectorConfig;
}

export class IdleDetector {
    private idleStartTime: number | null = null;
    private config: IdleDetectorConfig;

    constructor(config: IdleDetectorConfig) {
        this.config = config;
    }

    /**
     * Update idle state based on current queue size
     * Returns true if system is idle
     */
    async updateIdleState(): Promise<boolean> {
        const queueService = getQueueService();
        const stats = await queueService.getQueueStats();
        const currentQueueSize = stats.mainQueue.size;

        const isCurrentlyIdle = currentQueueSize < this.config.idleQueueThreshold;

        if (isCurrentlyIdle) {
            // System is idle
            if (this.idleStartTime === null) {
                // Just became idle
                this.idleStartTime = Date.now();
                logger.debug('System became idle', { queueSize: currentQueueSize });
            } else {
                // Check if idle duration threshold met
                const idleDuration = Date.now() - this.idleStartTime;
                if (idleDuration >= this.config.idleDurationMs) {
                    logger.debug('System is idle (threshold met)', {
                        queueSize: currentQueueSize,
                        idleDuration,
                    });
                    return true;
                }
            }
        } else {
            // System is not idle
            if (this.idleStartTime !== null) {
                logger.debug('System is no longer idle', { queueSize: currentQueueSize });
                this.idleStartTime = null;
            }
        }

        return false;
    }

    /**
     * Reset idle state
     */
    resetIdleState(): void {
        this.idleStartTime = null;
    }
}

export class RetryWorker {
    private isRunning = false;
    private pollInterval: NodeJS.Timeout | null = null;
    private config: RetryWorkerConfig;
    private idleDetector: IdleDetector;
    private isCurrentlyIdle = false;

    constructor(config: RetryWorkerConfig) {
        this.config = {
            enabled: config.enabled !== false,
            maxRetryAttempts: config.maxRetryAttempts || 5,
            idleDetector: config.idleDetector || {
                idleQueueThreshold: parseInt(process.env.RETRY_IDLE_THRESHOLD || '5', 10),
                idleDurationMs: parseInt(process.env.RETRY_IDLE_DURATION || '10000', 10),
                pollIntervalMs: parseInt(process.env.RETRY_POLL_INTERVAL || '5000', 10),
            },
        };

        this.idleDetector = new IdleDetector(this.config.idleDetector);
    }

    /**
     * Start the retry worker
     */
    async start(): Promise<void> {
        if (!this.config.enabled) {
            logger.info('Retry worker is disabled');
            return;
        }

        if (this.isRunning) {
            logger.warn('Retry worker is already running');
            return;
        }

        this.isRunning = true;
        logger.info('Starting retry worker', {
            idleThreshold: this.config.idleDetector.idleQueueThreshold,
            idleDuration: this.config.idleDetector.idleDurationMs,
            pollInterval: this.config.idleDetector.pollIntervalMs,
        });

        this.poll();
    }

    /**
     * Stop the retry worker
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn('Retry worker is not running');
            return;
        }

        this.isRunning = false;

        if (this.pollInterval) {
            clearTimeout(this.pollInterval);
            this.pollInterval = null;
        }

        logger.info('Retry worker stopped');
    }

    /**
     * Poll and process retries
     */
    private poll(): void {
        if (!this.isRunning) return;

        this.checkAndProcess()
            .catch((error) => {
                logger.error('Retry worker error', {
                    error: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                this.pollInterval = setTimeout(() => this.poll(), this.config.idleDetector.pollIntervalMs);
            });
    }

    /**
     * Check idle state and process retries
     */
    private async checkAndProcess(): Promise<void> {
        const isIdle = await this.idleDetector.updateIdleState();

        if (isIdle && !this.isCurrentlyIdle) {
            // Just became idle, log transition
            logger.info('System is now idle, starting retry processing');
            this.isCurrentlyIdle = true;
        } else if (!isIdle && this.isCurrentlyIdle) {
            // No longer idle
            logger.info('System is no longer idle, pausing retry processing');
            this.isCurrentlyIdle = false;
            this.idleDetector.resetIdleState();
            return;
        }

        if (!isIdle) {
            return; // Not idle yet, wait
        }

        // Process one retry message
        await this.processOneRetry();
    }

    /**
     * Process a single retry message from retry DLQ
     */
    private async processOneRetry(): Promise<void> {
        const queueService = getQueueService();

        // Get next message ready for retry
        const message = await queueService.getNextRetryMessage();

        if (!message) {
            // No message ready for retry or DLQ is empty
            return;
        }

        logger.info('Processing retry message', {
            messageId: message.id,
            retryCount: message.retryCount,
            maxRetries: message.maxRetries,
        });

        const retryStartTime = Date.now();

        try {
            // Attempt to insert to SFMC again
            const deKey =
                (message.payload as any)?.deKey ||
                config.dataExtensions.webhookMaster ||
                config.dataExtensions.webhookEvents;

            await upsertToDataExtension(deKey, message.payload as Record<string, unknown>);

            const processingTime = Date.now() - retryStartTime;

            logger.info('Retry message processed successfully', {
                messageId: message.id,
                retryCount: message.retryCount,
                processingTime,
            });

            // Message succeeded, increment success counter
            await queueService.incrementStat('processed');
        } catch (error) {
            const processingTime = Date.now() - retryStartTime;
            const errorClassification = classifyError(error);

            logger.warn('Retry message failed', {
                messageId: message.id,
                retryCount: message.retryCount,
                errorType: errorClassification.type,
                errorMessage: errorClassification.message,
                processingTime,
            });

            // Check if we should retry again
            if (message.retryCount < message.maxRetries) {
                // Requeue for retry
                const requeued = await queueService.requeueRetry(message, {
                    type: errorClassification.type,
                    message: errorClassification.message,
                });

                if (requeued) {
                    logger.info('Retry message requeued', {
                        messageId: message.id,
                        nextRetryAt: new Date(message.nextRetryAt).toISOString(),
                    });
                }
            } else {
                // Max retries exceeded, move to bad payload DLQ
                logger.error('Retry message exceeded max retries', {
                    messageId: message.id,
                    retryCount: message.retryCount,
                    maxRetries: message.maxRetries,
                });

                await queueService.enqueueBadPayload(
                    message,
                    [{ message: errorClassification.message }],
                    errorClassification.message,
                    'OTHER'
                );

                await queueService.incrementStat('discarded');
            }
        }
    }

    /**
     * Force process a message (bypass idle check)
     * Useful for testing or manual intervention
     */
    async forceProcessNextRetry(): Promise<boolean> {
        const queueService = getQueueService();
        const messages = await queueService.getAllRetryMessages();

        if (messages.length === 0) {
            logger.warn('No retry messages available');
            return false;
        }

        // Get oldest message (first in queue)
        const message = messages[0];

        logger.info('Force processing retry message', {
            messageId: message.id,
            retryCount: message.retryCount,
        });

        const retryStartTime = Date.now();

        try {
            const deKey =
                (message.payload as any)?.deKey ||
                config.dataExtensions.webhookMaster ||
                config.dataExtensions.webhookEvents;

            await upsertToDataExtension(deKey, message.payload as Record<string, unknown>);

            logger.info('Force retry succeeded', {
                messageId: message.id,
                processingTime: Date.now() - retryStartTime,
            });

            return true;
        } catch (error) {
            logger.error('Force retry failed', {
                messageId: message.id,
                error: error instanceof Error ? error.message : String(error),
            });

            return false;
        }
    }

    /**
     * Check if worker is running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Check if system is currently idle
     */
    isIdle(): boolean {
        return this.isCurrentlyIdle;
    }
}

// Singleton instance
let retryWorkerInstance: RetryWorker | null = null;

export function initializeRetryWorker(config: RetryWorkerConfig): RetryWorker {
    if (!retryWorkerInstance) {
        retryWorkerInstance = new RetryWorker(config);
    }
    return retryWorkerInstance;
}

export function getRetryWorker(): RetryWorker {
    if (!retryWorkerInstance) {
        throw new Error('Retry worker not initialized');
    }
    return retryWorkerInstance;
}
