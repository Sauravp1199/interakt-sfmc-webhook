/**
 * Interakt to SFMC Webhook Server
 *
 * Main entry point for the webhook application.
 * Receives webhooks from Interakt and sends data to SFMC Data Extensions.
 *
 * Endpoints:
 * - GET  /               Service info
 * - GET  /health         Health check
 * - GET  /stats          Statistics
 * - POST /webhook/interakt   Main webhook endpoint (all 15 webhook types)
 * - POST /admin/clear-cache  Clear idempotency cache
 * - POST /admin/flush-queue  Force flush queue
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { handleWebhook, initializeHandler } = require('./lib/webhook-handler');
const { getStats, clearCache } = require('./lib/idempotency');
const { getQueueStats, flush: flushQueue, shutdown: shutdownQueue } = require('./lib/queue');
const { getTokenStatus, clearTokenCache } = require('./lib/sfmc-client');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 1112;

// Initialize webhook handler (sets up queue)
initializeHandler();

// Security middleware
app.use(helmet());
app.use(bodyParser.json({ limit: '10mb' }));

// Trust proxy (required for Heroku/reverse proxy)
app.set('trust proxy', 1);

// Rate limiting - prevent abuse
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Max 100 requests per minute per IP
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/webhook', webhookLimiter);

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')?.substring(0, 50)
    });
    next();
});

// =============================================================================
// ROOT ENDPOINT
// =============================================================================
app.get('/', (req, res) => {
    res.status(200).json({
        service: 'Interakt to SFMC Webhook Integration',
        status: 'running',
        version: '2.0.0',
        description: 'Receives Interakt webhooks and inserts data into SFMC Data Extensions using REST API',
        endpoints: {
            health: 'GET /health',
            stats: 'GET /stats',
            webhook: 'POST /webhook/interakt',
            adminClearCache: 'POST /admin/clear-cache',
            adminFlushQueue: 'POST /admin/flush-queue'
        },
        webhookTypes: [
            'message_api_sent', 'message_api_delivered', 'message_api_read', 'message_api_failed',
            'message_api_clicked', 'message_received', 'workflow_response_update',
            'account_alerts', 'account_update', 'account_review_update',
            'business_capability_update', 'phone_number_quality_update',
            'template_performance_metrics', 'message_template_status_update', 'messages'
        ]
    });
});

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
app.get('/health', (req, res) => {
    const cacheStats = getStats();
    const queueStats = getQueueStats();
    const tokenStatus = getTokenStatus();

    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            unit: 'MB'
        },
        cache: cacheStats,
        queue: queueStats,
        sfmcToken: tokenStatus,
        environment: process.env.NODE_ENV || 'development',
        dataExtensionKey: process.env.SFMC_DE_CUSTOMER_KEY ? '[CONFIGURED]' : '[NOT SET]'
    };

    res.status(200).json(healthData);
});

// =============================================================================
// STATS ENDPOINT
// =============================================================================
app.get('/stats', (req, res) => {
    const cacheStats = getStats();
    const queueStats = getQueueStats();

    res.status(200).json({
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        idempotency: cacheStats,
        queue: queueStats
    });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

// Clear idempotency cache
app.post('/admin/clear-cache', (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.LOCAL_ADMIN_KEY || process.env.ADMIN_KEY;

    if (!expectedKey) {
        return res.status(503).json({
            error: 'Admin functionality not configured'
        });
    }

    if (adminKey !== expectedKey) {
        logger.warn('Unauthorized cache clear attempt', { ip: req.ip });
        return res.status(401).json({ error: 'Unauthorized' });
    }

    clearCache();
    clearTokenCache();
    logger.info('Cache cleared by admin', { ip: req.ip });

    res.status(200).json({
        message: 'Cache cleared successfully (idempotency + token cache)',
        timestamp: new Date().toISOString()
    });
});

// Force flush queue
app.post('/admin/flush-queue', async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.LOCAL_ADMIN_KEY || process.env.ADMIN_KEY;

    if (!expectedKey) {
        return res.status(503).json({
            error: 'Admin functionality not configured'
        });
    }

    if (adminKey !== expectedKey) {
        logger.warn('Unauthorized queue flush attempt', { ip: req.ip });
        return res.status(401).json({ error: 'Unauthorized' });
    }

    logger.info('Manual queue flush initiated by admin', { ip: req.ip });

    try {
        const result = await flushQueue();
        res.status(200).json({
            message: 'Queue flushed successfully',
            result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Queue flush failed', { error: error.message });
        res.status(500).json({
            error: 'Queue flush failed',
            message: error.message
        });
    }
});

// =============================================================================
// MAIN WEBHOOK ENDPOINT
// =============================================================================
app.post('/webhook/interakt', async (req, res) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        // Quick validation
        const { type, data, timestamp } = req.body;

        if (!type || !data) {
            logger.warn('Invalid webhook payload - missing type or data', { requestId });
            return res.status(400).json({
                success: false,
                error: 'Invalid payload: missing type or data',
                requestId
            });
        }

        // Fast signature verification
        const signature = req.headers['x-interakt-signature'];
        const secret = process.env.LOCAL_INTERAKT_SECRET || process.env.INTERAKT_SECRET;

        if (secret && signature) {
            const crypto = require('crypto');
            const providedSig = signature.startsWith('sha256=') ? signature.substring(7) : signature;
            const hmac = crypto.createHmac('sha256', secret);
            const digest = hmac.update(JSON.stringify(req.body)).digest('hex');

            if (digest !== providedSig) {
                logger.error('Invalid signature', { requestId });
                return res.status(401).json({
                    success: false,
                    error: 'Invalid signature',
                    requestId
                });
            }
        }

        // Quick idempotency check
        const { isProcessed, markProcessed } = require('./lib/idempotency');
        const messageId = data?.message?.id || data?.id;
        const uniqueId = messageId
            ? `${messageId}_${type}`
            : `${type}_${timestamp}_${require('crypto').createHash('md5').update(JSON.stringify(data || {})).digest('hex').substring(0, 12)}`;

        if (await isProcessed(uniqueId)) {
            const responseTime = Date.now() - startTime;
            return res.status(200).json({
                success: true,
                message: 'Already processed',
                requestId,
                responseTime
            });
        }

        // Mark as processing immediately to prevent duplicates
        await markProcessed(uniqueId, type);

        // RESPOND IMMEDIATELY - Process SFMC in background
        const responseTime = Date.now() - startTime;
        res.status(200).json({
            success: true,
            requestId,
            responseTime,
            message: 'Webhook received and queued for processing'
        });

        // Fire-and-forget: Process SFMC asynchronously after response
        setImmediate(async () => {
            try {
                await handleWebhook(req.body, req.headers);
                logger.info('Background SFMC processing completed', { requestId, type });
            } catch (bgError) {
                logger.error('Background SFMC processing failed', {
                    requestId,
                    error: bgError.message,
                    type,
                    stack: bgError.stack
                });
            }
        });

    } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error('Webhook error', {
            requestId,
            error: error.message,
            processingTime,
            stack: error.stack
        });

        if (error.code === 'DUPLICATE_MESSAGE') {
            return res.status(200).json({
                success: true,
                message: 'Already processed',
                requestId
            });
        }

        res.status(500).json({
            success: false,
            error: 'Internal server error',
            requestId
        });
    }
});

// =============================================================================
// 404 HANDLER
// =============================================================================
app.use((req, res) => {
    logger.warn('404 - Endpoint not found', {
        method: req.method,
        path: req.path,
        ip: req.ip
    });
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path
    });
});

// =============================================================================
// GLOBAL ERROR HANDLER
// =============================================================================
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path
    });
    res.status(500).json({
        error: 'Internal server error'
    });
});

// =============================================================================
// START SERVER
// =============================================================================
const server = app.listen(PORT, () => {
    logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version
    });

    console.log('\n========================================');
    console.log('  Interakt SFMC Webhook Server v2.0');
    console.log('========================================');
    console.log(`  Port:        ${PORT}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Node:        ${process.version}`);
    console.log('========================================');
    console.log('  Configuration:');
    console.log(`  - SFMC Auth URL:    ${process.env.SFMC_AUTH_BASE_URL ? '[SET]' : '[NOT SET]'}`);
    console.log(`  - SFMC REST URL:    ${process.env.SFMC_REST_BASE_URL ? '[SET]' : '[NOT SET]'}`);
    console.log(`  - DE Customer Key:  ${process.env.SFMC_DE_CUSTOMER_KEY ? '[SET]' : '[NOT SET]'}`);
    console.log(`  - Queue Batch Size: ${process.env.QUEUE_BATCH_SIZE || 2}`);
    console.log('========================================');
    console.log('  Endpoints:');
    console.log('  - GET  /               Service info');
    console.log('  - GET  /health         Health check');
    console.log('  - GET  /stats          Statistics');
    console.log('  - POST /webhook/interakt  Webhook receiver');
    console.log('========================================');
    console.log('  Ready to receive webhooks\n');
});

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================
const shutdown = async (signal) => {
    logger.info(`${signal} signal received: shutting down gracefully`);

    // Flush queue before shutdown
    try {
        logger.info('Flushing queue before shutdown...');
        await shutdownQueue();
        logger.info('Queue flushed successfully');
    } catch (error) {
        logger.error('Queue flush on shutdown failed', { error: error.message });
    }

    server.close(() => {
        logger.info('Server closed successfully');
        process.exit(0);
    });

    // Force close after 15 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 15000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', {
        error: err.message,
        stack: err.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
        reason: String(reason)
    });
});

module.exports = app;
