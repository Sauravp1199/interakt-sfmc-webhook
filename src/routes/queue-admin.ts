/**
 * Queue Admin Routes
 * Monitoring and management endpoints for Redis queue system
 *
 * Add these routes to your Express app to enable queue monitoring:
 *
 * import queueAdminRouter from './routes/queue-admin';
 * app.use('/admin/queue', queueAdminRouter);
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { getQueueService } from '../lib/redis-queue';
import { getRetryWorker } from '../lib/retry-worker';

const router = Router();

/**
 * GET /admin/queue/stats
 * Get queue statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const queueService = getQueueService();
        const stats = await queueService.getQueueStats();

        return res.json({
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
        });
    } catch (error) {
        logger.error('Failed to get queue statistics', {
            error: error instanceof Error ? error.message : String(error),
        });

        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * GET /admin/queue/retry-messages
 * Get all messages in retry DLQ
 */
router.get('/retry-messages', async (_req: Request, res: Response) => {
    try {
        const queueService = getQueueService();
        const messages = await queueService.getAllRetryMessages();

        return res.json({
            success: true,
            count: messages.length,
            messages: messages.map((msg) => ({
                id: msg.id,
                retryCount: msg.retryCount,
                maxRetries: msg.maxRetries,
                nextRetryAt: new Date(msg.nextRetryAt).toISOString(),
                lastError: msg.lastError,
                createdAt: new Date(msg.createdAt).toISOString(),
                requestId: msg.requestId,
                webhookType: msg.webhookType,
            })),
        });
    } catch (error) {
        logger.error('Failed to get retry messages', {
            error: error instanceof Error ? error.message : String(error),
        });

        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * GET /admin/queue/bad-payload-messages
 * Get all messages in bad payload DLQ
 */
router.get('/bad-payload-messages', async (_req: Request, res: Response) => {
    try {
        const queueService = getQueueService();
        const messages = await queueService.getAllBadPayloadMessages();

        return res.json({
            success: true,
            count: messages.length,
            messages: messages.map((msg) => ({
                id: msg.id,
                createdAt: new Date(msg.createdAt).toISOString(),
                requestId: msg.requestId,
                webhookType: msg.webhookType,
                errorClassification: msg.errorClassification,
                validationErrors: msg.validationErrors,
                originalError: msg.originalError,
            })),
        });
    } catch (error) {
        logger.error('Failed to get bad payload messages', {
            error: error instanceof Error ? error.message : String(error),
        });

        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * POST /admin/queue/force-retry
 * Force process the next retry message immediately (for debugging)
 */
router.post('/force-retry', async (_req: Request, res: Response) => {
    try {
        const retryWorker = getRetryWorker();
        const success = await retryWorker.forceProcessNextRetry();

        return res.json({
            success,
            message: success ? 'Retry processed successfully' : 'No retry messages available',
        });
    } catch (error) {
        logger.error('Failed to force retry', {
            error: error instanceof Error ? error.message : String(error),
        });

        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * DELETE /admin/queue/clear-all
 * Clear all queues (use with caution!)
 */
router.delete('/clear-all', async (req: Request, res: Response) => {
    const adminSecret = process.env.ADMIN_SECRET;
    const providedSecret = req.headers['x-admin-secret'];

    if (!adminSecret || providedSecret !== adminSecret) {
        logger.warn('Unauthorized attempt to clear queues');
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - invalid admin secret',
        });
    }

    try {
        const queueService = getQueueService();
        await queueService.clearAll();

        logger.warn('All queues cleared by admin');

        return res.json({
            success: true,
            message: 'All queues cleared',
        });
    } catch (error) {
        logger.error('Failed to clear queues', {
            error: error instanceof Error ? error.message : String(error),
        });

        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * GET /admin/queue/config
 * Get queue configuration
 */
router.get('/config', async (_req: Request, res: Response) => {
    try {
        const queueService = getQueueService();
        const retryConfig = queueService.getRetryConfig();
        const batchConfig = queueService.getBatchConfig();

        return res.json({
            success: true,
            retry: {
                maxRetries: retryConfig.maxRetries,
                initialDelayMs: retryConfig.initialDelayMs,
                maxDelayMs: retryConfig.maxDelayMs,
                backoffMultiplier: retryConfig.backoffMultiplier,
            },
            batch: {
                maxBatchSize: batchConfig.maxBatchSize,
                maxBatchBytes: batchConfig.maxBatchBytes,
                batchTimeoutMs: batchConfig.batchTimeoutMs,
            },
        });
    } catch (error) {
        logger.error('Failed to get queue config', {
            error: error instanceof Error ? error.message : String(error),
        });

        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

export default router;
