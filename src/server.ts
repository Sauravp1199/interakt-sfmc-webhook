import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import healthRouter, { incrementStats } from './routes/health';
import eventRouter from './routes/event';
import webhookRouter from './routes/webhook';
import adminRouter from './routes/admin';
import { initializeQueueService } from './lib/redis-queue';
import { initializeBatchWorker } from './lib/batch-worker';
import { initializeRetryWorker } from './lib/retry-worker';

// Validate configuration on startup
validateConfig();

// Initialize Redis queue service
const queueService = initializeQueueService(process.env.REDIS_URL);

// Initialize batch worker
const batchWorker = initializeBatchWorker({
  enabled: process.env.BATCH_WORKER_ENABLED !== 'false',
  pollIntervalMs: parseInt(process.env.BATCH_WORKER_POLL_INTERVAL || '2000', 10),
});

// Initialize retry worker
const retryWorker = initializeRetryWorker({
  enabled: process.env.RETRY_WORKER_ENABLED !== 'false',
  maxRetryAttempts: parseInt(process.env.QUEUE_MAX_RETRIES || '5', 10),
  idleDetector: {
    idleQueueThreshold: parseInt(process.env.RETRY_IDLE_THRESHOLD || '5', 10),
    idleDurationMs: parseInt(process.env.RETRY_IDLE_DURATION || '10000', 10),
    pollIntervalMs: parseInt(process.env.RETRY_POLL_INTERVAL || '5000', 10),
  },
});

const app = express();

// Security middleware
app.use(helmet());

// Parse JSON bodies (with raw body for signature verification)
app.use(
  express.json({
    limit: '10mb',
    verify: (req: Request, _res: Response, buf: Buffer) => {
      // Store raw body for signature verification
      (req as Request & { rawBody?: string }).rawBody = buf.toString();
    },
  })
);

// Trust proxy (required for Heroku/reverse proxy)
app.set('trust proxy', 1);

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/webhook', webhookLimiter);

// Rate limiting for event endpoint
const eventLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/event', eventLimiter);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')?.substring(0, 50),
  });

  // Track response for stats
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const success = res.statusCode >= 200 && res.statusCode < 400;

    if (req.path.startsWith('/event') || req.path.startsWith('/webhook')) {
      incrementStats(success);
    }

    logger.debug(`Response sent`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
    });
  });

  next();
});

// Routes
app.use('/', healthRouter);
app.use('/event', eventRouter);
app.use('/webhook', webhookRouter);
app.use('/admin', adminRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn('404 - Endpoint not found', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });
  res.status(500).json({
    error: 'Internal server error',
  });
});

// Start server
const server = app.listen(config.port, async () => {
  logger.info('Server started', {
    port: config.port,
    environment: config.nodeEnv,
    nodeVersion: process.version,
  });

  console.log('\n========================================');
  console.log('  Interakt SFMC Webhook Server v2.0');
  console.log('========================================');
  console.log(`  Port:        ${config.port}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Node:        ${process.version}`);
  console.log('========================================');
  console.log('  Endpoints:');
  console.log(`  - GET  /           Service info`);
  console.log(`  - GET  /health     Health check`);
  console.log(`  - GET  /stats      Statistics`);
  console.log(`  - POST /event      Event receiver`);
  console.log(`  - POST /webhook/interakt  Webhook receiver`);
  console.log('========================================');
  console.log('  Queue System:');
  console.log(`  - Batch Worker:    ${batchWorker.isActive() ? 'Enabled' : 'Disabled'}`);
  console.log(`  - Retry Worker:    ${retryWorker.isActive() ? 'Enabled' : 'Disabled'}`);
  console.log('========================================');
  console.log('  Starting queue workers...\n');

  // Start queue workers
  try {
    await batchWorker.start();
    logger.info('Batch worker started');
  } catch (error) {
    logger.error('Failed to start batch worker', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await retryWorker.start();
    logger.info('Retry worker started');
  } catch (error) {
    logger.error('Failed to start retry worker', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  console.log('  Ready to receive requests\n');
});

// Graceful shutdown handlers
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received: shutting down gracefully`);

  // Stop workers
  try {
    await batchWorker.stop();
    logger.info('Batch worker stopped');
  } catch (error) {
    logger.error('Error stopping batch worker', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await retryWorker.stop();
    logger.info('Retry worker stopped');
  } catch (error) {
    logger.error('Error stopping retry worker', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Close Redis connection
  try {
    await queueService.close();
    logger.info('Queue service closed');
  } catch (error) {
    logger.error('Error closing queue service', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  server.close(() => {
    logger.info('Server closed successfully');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught Exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled Rejection', {
    reason: String(reason),
  });
});

export default app;
