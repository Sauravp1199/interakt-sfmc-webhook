import { Router, Request, Response } from 'express';
import { config, getCredentials, isLocalhost } from '../config';
import { logger } from '../utils/logger';
import { clearTokenCache } from '../services/sfmcAuth';

const router = Router();

/**
 * Admin authentication middleware
 * Uses environment-specific admin key based on request origin
 */
function requireAdminAuth(req: Request, res: Response, next: () => void): void {
  const providedAdminKey = req.headers['x-admin-key'] as string;
  const host = req.headers.host as string | undefined;
  const credentials = getCredentials(host);
  const envType = isLocalhost(host) ? 'LOCAL' : 'PROD';

  if (!credentials.adminKey) {
    res.status(503).json({
      error: `Admin functionality not configured for ${envType} environment`,
      environment: envType,
    });
    return;
  }

  if (providedAdminKey !== credentials.adminKey) {
    logger.warn('Unauthorized admin access attempt', { ip: req.ip, envType });
    res.status(401).json({
      error: 'Unauthorized',
      environment: envType,
    });
    return;
  }

  next();
}

/**
 * POST /admin/clear-cache
 * Clear SFMC token cache
 */
router.post('/clear-cache', requireAdminAuth, (req: Request, res: Response) => {
  const host = req.headers.host as string | undefined;
  const envType = isLocalhost(host) ? 'LOCAL' : 'PROD';

  clearTokenCache();

  logger.info('Admin cleared token cache', { ip: req.ip, envType });

  res.status(200).json({
    message: 'Cache cleared successfully',
    environment: envType,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/config
 * Get non-sensitive configuration (for debugging)
 */
router.get('/config', requireAdminAuth, (req: Request, res: Response) => {
  const host = req.headers.host as string | undefined;
  const envType = isLocalhost(host) ? 'LOCAL' : 'PROD';
  const credentials = getCredentials(host);

  res.status(200).json({
    currentEnvironment: envType,
    nodeEnv: config.nodeEnv,
    port: config.port,
    logLevel: config.logLevel,
    sfmc: {
      authBaseUrl: config.sfmc.authBaseUrl,
      soapBaseUrl: config.sfmc.soapBaseUrl,
      accountId: config.sfmc.accountId ? '***configured***' : 'NOT SET',
      clientId: config.sfmc.clientId ? '***configured***' : 'NOT SET',
      clientSecret: config.sfmc.clientSecret ? '***configured***' : 'NOT SET',
    },
    dataExtensions: {
      event: config.dataExtensions.event || 'NOT SET',
      webhookEvents: config.dataExtensions.webhookEvents || 'NOT SET',
    },
    credentials: {
      local: {
        adminKey: config.credentials.local.adminKey ? '***configured***' : 'NOT SET',
        interaktSecret: config.credentials.local.interaktSecret ? '***configured***' : 'NOT SET',
        webhookSignature: config.credentials.local.webhookSignature ? '***configured***' : 'NOT SET',
      },
      prod: {
        adminKey: config.credentials.prod.adminKey ? '***configured***' : 'NOT SET',
        interaktSecret: config.credentials.prod.interaktSecret ? '***configured***' : 'NOT SET',
        webhookSignature: config.credentials.prod.webhookSignature ? '***configured***' : 'NOT SET',
      },
    },
    activeCredentials: {
      environment: envType,
      adminKey: credentials.adminKey ? '***configured***' : 'NOT SET',
      interaktSecret: credentials.interaktSecret ? '***configured***' : 'NOT SET',
      webhookSignature: credentials.webhookSignature ? '***configured***' : 'NOT SET',
    },
    tokenRefreshBuffer: config.tokenRefreshBuffer,
    maxRetries: config.maxRetries,
  });
});

export default router;
