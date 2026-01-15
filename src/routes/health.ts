import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getTokenCacheStatus } from '../services/sfmcAuth';

const router = Router();

// Track server start time
const serverStartTime = Date.now();

// Stats tracking
const stats = {
  requestsTotal: 0,
  requestsSuccess: 0,
  requestsFailed: 0,
};

/**
 * Increment stats counters
 */
export function incrementStats(success: boolean): void {
  stats.requestsTotal++;
  if (success) {
    stats.requestsSuccess++;
  } else {
    stats.requestsFailed++;
  }
}

/**
 * GET /
 * Root endpoint - service info
 */
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    service: 'Interakt to SFMC Webhook Integration',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      stats: 'GET /stats',
      event: 'POST /event',
      webhook: 'POST /webhook/interakt',
      adminClearCache: 'POST /admin/clear-cache',
    },
  });
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  const tokenStatus = getTokenCacheStatus();
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
  const memoryUsage = process.memoryUsage();

  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      unit: 'MB',
    },
    sfmcToken: {
      hasCachedToken: tokenStatus.hasCachedToken,
      isExpired: tokenStatus.isExpired,
      expiresAt: tokenStatus.expiresAt,
    },
    stats: {
      totalRequests: stats.requestsTotal,
      successfulRequests: stats.requestsSuccess,
      failedRequests: stats.requestsFailed,
      successRate:
        stats.requestsTotal > 0
          ? `${((stats.requestsSuccess / stats.requestsTotal) * 100).toFixed(2)}%`
          : 'N/A',
    },
    environment: config.nodeEnv,
    nodeVersion: process.version,
  };

  res.status(200).json(healthData);
});

/**
 * GET /stats
 * Statistics endpoint
 */
router.get('/stats', (_req: Request, res: Response) => {
  const tokenStatus = getTokenCacheStatus();
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

  res.status(200).json({
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    requests: {
      total: stats.requestsTotal,
      success: stats.requestsSuccess,
      failed: stats.requestsFailed,
      successRate:
        stats.requestsTotal > 0
          ? `${((stats.requestsSuccess / stats.requestsTotal) * 100).toFixed(2)}%`
          : 'N/A',
    },
    sfmcToken: tokenStatus,
  });
});

export default router;
