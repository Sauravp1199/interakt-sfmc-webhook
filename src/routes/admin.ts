import { Router, Request, Response } from 'express';
import { config, isLocalhost } from '../config';
import { logger } from '../utils/logger';
import { clearTokenCache } from '../services/sfmcAuth';

const router = Router();

/**
 * POST /admin/clear-cache
 * Clear SFMC token cache
 * 
 * SIGNATURE VALIDATION:
 * Signature verification is handled by signatureAuthMiddleware in src/middleware/signature-auth.ts
 * This middleware validates the Interakt-Signature header before the request reaches this handler
 */
router.post('/clear-cache', (req: Request, res: Response) => {
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
 * 
 * SIGNATURE VALIDATION:
 * Signature verification is handled by signatureAuthMiddleware in src/middleware/signature-auth.ts
 * This middleware validates the Interakt-Signature header before the request reaches this handler
 */
router.get('/config', (req: Request, res: Response) => {
  const host = req.headers.host as string | undefined;
  const envType = isLocalhost(host) ? 'LOCAL' : 'PROD';
  const { getCredentials } = require('../config');
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
