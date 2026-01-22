/**
 * Queue Integration for Webhook Handler
 * Intercepts webhook processing to enqueue messages instead of direct processing
 */

import { logger } from '../utils/logger';
import { getQueueService } from './redis-queue';

/**
 * Enqueue a webhook payload for processing
 * This replaces direct insertion into SFMC
 */
export async function enqueueWebhookPayload(
    payload: Record<string, unknown>,
    rawPayload: string,
    webhookType: string,
    requestId: string
): Promise<{
    success: boolean;
    messageId: string;
    queuePosition: number;
    message: string;
}> {
    try {
        const queueService = getQueueService();

        // Enqueue the message
        const queuePosition = await queueService.enqueueMain(payload, rawPayload, webhookType, requestId);

        logger.debug('Webhook payload enqueued successfully', {
            requestId,
            webhookType,
            queuePosition,
        });

        return {
            success: true,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            queuePosition,
            message: 'Webhook payload queued for processing',
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Failed to enqueue webhook payload', {
            requestId,
            error: errorMsg,
        });

        throw error;
    }
}

/**
 * Validate payload and decide routing to appropriate DLQ
 */
export async function routeValidationError(
    payload: Record<string, unknown>,
    rawPayload: string,
    requestId: string,
    validationError: Error
): Promise<void> {
    try {
        const queueService = getQueueService();

        // Create temporary message for bad payload DLQ
        const tempMessage = {
            id: `msg_${requestId}`,
            payload,
            rawPayload,
            webhookType: 'unknown',
            timestamp: Date.now(),
            requestId,
            createdAt: Date.now(),
            attemptCount: 0,
        };

        // Route to bad payload DLQ
        await queueService.enqueueBadPayload(
            tempMessage,
            [
                {
                    field: 'payload',
                    message: validationError.message,
                    code: 'VALIDATION_ERROR',
                },
            ],
            validationError.message,
            'SCHEMA_VALIDATION'
        );

        logger.info('Validation error routed to bad payload DLQ', {
            requestId,
            error: validationError.message,
        });
    } catch (error) {
        logger.error('Failed to route validation error', {
            requestId,
            error: error instanceof Error ? error.message : String(error),
        });

        throw error;
    }
}

/**
 * Get current queue statistics
 * Useful for health checks and monitoring
 */
export async function getQueueStatistics(): Promise<Record<string, unknown>> {
    try {
        const queueService = getQueueService();
        const stats = await queueService.getQueueStats();

        return {
            success: true,
            timestamp: new Date().toISOString(),
            queues: {
                mainQueue: {
                    size: stats.mainQueue.size,
                    oldestMessageAgeSeconds: stats.mainQueue.oldestMessageAge,
                },
                retryDLQ: {
                    size: stats.retryDLQ.size,
                    oldestMessageAgeSeconds: stats.retryDLQ.oldestMessageAge,
                },
                badPayloadDLQ: {
                    size: stats.badPayloadDLQ.size,
                    oldestMessageAgeSeconds: stats.badPayloadDLQ.oldestMessageAge,
                },
            },
            statistics: {
                totalProcessed: stats.totalProcessed,
                totalFailed: stats.totalFailed,
                totalDiscarded: stats.totalDiscarded,
            },
        };
    } catch (error) {
        logger.error('Failed to get queue statistics', {
            error: error instanceof Error ? error.message : String(error),
        });

        throw error;
    }
}
