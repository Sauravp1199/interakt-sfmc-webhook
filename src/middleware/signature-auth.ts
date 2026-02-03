import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { getCredentials } from '../config';

/**
 * SIGNATURE VALIDATION CONFIGURATION (ENVIRONMENT-BASED)
 *
 * The signature value is loaded from environment-specific credentials:
 * - LOCAL (localhost): Uses LOCAL_WEBHOOK_SIGNATURE from .env
 * - PROD (live domain): Uses PROD_WEBHOOK_SIGNATURE from .env
 *
 * Format: Signature: sha256=<base64_encoded_secret>
 * Example: Signature: sha256=VGRHLVdwcHBjZTRud291c1NINDlFS1dnVWstbzNhQU5Rdy1nNzg5cnBuMDo=
 *
 * ⚠️ SECURITY NOTE: This is SIMPLE STRING MATCHING, not cryptographic HMAC validation.
 */

const SIGNATURE_HEADER = 'signature';
const SKIP_VALIDATION = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

/**
 * Verify signature using simple string matching
 */
function verifySignature(
  receivedSignature: string | undefined,
  expectedSignature: string
): boolean {
  // Signature header is required
  if (!receivedSignature) {
    logger.warn('No signature provided - request rejected', {
      header: SIGNATURE_HEADER,
    });
    return false;
  }

  try {
    // Simple string comparison
    const isValid = receivedSignature === expectedSignature;

    logger.debug('Signature verification', {
      header: SIGNATURE_HEADER,
      received: receivedSignature.substring(0, 20) + '...',
      expected: expectedSignature.substring(0, 20) + '...',
      match: isValid,
    });

    if (!isValid) {
      logger.warn('Signature verification failed', {
        received: receivedSignature.substring(0, 20) + '...',
        expected: expectedSignature.substring(0, 20) + '...',
      });
    }

    return isValid;
  } catch (error) {
    logger.error('Signature verification error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Middleware: Verify Signature header on all protected API requests
 * Environment-based validation using LOCAL_WEBHOOK_SIGNATURE or PROD_WEBHOOK_SIGNATURE
 */
export function signatureAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const endpoint = req.originalUrl || req.url;
  const host = req.get('host');

  // Skip validation if disabled for local testing
  if (SKIP_VALIDATION) {
    logger.warn('SIGNATURE VALIDATION SKIPPED - SKIP_SIGNATURE_VALIDATION=true', {
      endpoint,
      host,
    });
    next();
    return;
  }

  // Get environment-specific credentials
  const credentials = getCredentials(host);
  const secretFromEnv = credentials.webhookSignature;

  // Validate signature is configured
  if (!secretFromEnv) {
    logger.error('Webhook signature not configured', {
      endpoint,
      host,
      environment: host?.includes('localhost') ? 'LOCAL' : 'PROD',
    });

    res.status(500).json({
      status: 'ERROR',
      error: 'Server configuration error',
      message: 'Webhook signature not configured in environment',
    });
    return;
  }

  // Build expected signature
  const expectedSignature = `sha256=${secretFromEnv}`;

  // Get signature from header
  const receivedSignature = req.headers[SIGNATURE_HEADER] as string | undefined;

  // Verify signature
  if (!verifySignature(receivedSignature, expectedSignature)) {
    logger.warn('Request rejected - invalid or missing signature', {
      endpoint,
      host,
      environment: host?.includes('localhost') ? 'LOCAL' : 'PROD',
    });

    res.status(401).json({
      status: 'UNAUTHORIZED',
      error: 'Invalid or missing signature',
      message: `All requests must include a valid ${SIGNATURE_HEADER} header`,
      header: SIGNATURE_HEADER,
      format: 'sha256=<base64_encoded_secret>',
    });
    return;
  }

  // Signature is valid - continue
  logger.debug('Signature verified - request allowed', {
    endpoint,
    host,
    environment: host?.includes('localhost') ? 'LOCAL' : 'PROD',
  });

  next();
}

export const verifyRequestSignature = verifySignature;
