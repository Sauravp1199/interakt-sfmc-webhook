import crypto from 'crypto';
import { logger } from './logger';

/**
 * Verifies Interakt webhook signature using SHA256 HMAC
 *
 * The signature is sent in the "Interakt-Signature" header in the format:
 * sha256=<hex_encoded_sha256_hmac>
 *
 * @param payload - The raw request body as a string
 * @param receivedSignature - The signature from the "Interakt-Signature" header
 * @param secret - The shared secret key
 * @param isLocal - Whether this is a local/development environment
 *   If true: allows missing signature with warning (testing mode)
 *   If false: requires valid signature or rejects with 401 (strict mode)
 * @param strictMode - If true, ALWAYS require valid signature regardless of isLocal
 * @returns true if signature is valid, false otherwise
 *
 * @example
 * // Development mode - allows missing signature
 * const isValid = verifyInteraktSignature(
 *   '{"foo":1,"bar":2}',
 *   'sha256=b84783d10ede5bd6ed771e8b16fbe5a7093340159d6e49ec4248350b6ec2c7b4',
 *   'mySecret',
 *   true,  // isLocal = true (development)
 *   false  // strictMode = false (lenient)
 * );
 *
 * @example
 * // Strict mode - requires valid signature always
 * const isValid = verifyInteraktSignature(
 *   '{"foo":1,"bar":2}',
 *   'sha256=b84783d10ede5bd6ed771e8b16fbe5a7093340159d6e49ec4248350b6ec2c7b4',
 *   'mySecret',
 *   true,  // isLocal = true (development)
 *   true   // strictMode = true (enforced)
 * );
 */
export function verifyInteraktSignature(
  payload: string,
  receivedSignature: string | undefined,
  secret: string,
  isLocal: boolean = false,
  strictMode: boolean = false
): boolean {
  // If no secret is configured, log warning but don't fail in development
  if (!secret) {
    logger.warn('WEBHOOK_SIGNATURE secret not configured, skipping signature verification');
    return isLocal && !strictMode; // Allow in local non-strict, deny otherwise
  }

  // Allow missing signature in LOCAL environment for testing (unless strict mode)
  if (!receivedSignature) {
    if (isLocal && !strictMode) {
      logger.info('⚠️  No signature provided - allowed in LOCAL environment for testing');
      return true;
    }
    logger.warn('❌ No signature provided in webhook request - request REJECTED');
    return false;
  }

  try {
    // Extract the hex signature (remove 'sha256=' prefix if present)
    const signaturePrefix = 'sha256=';
    const hexSignature = receivedSignature.startsWith(signaturePrefix)
      ? receivedSignature.substring(signaturePrefix.length)
      : receivedSignature;

    // Generate expected signature: HMAC-SHA256 of payload with secret, encoded as hex
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hexSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );

      if (!isValid) {
        logger.error('❌ Invalid webhook signature - request REJECTED', {
          expected: expectedSignature.substring(0, 16) + '...',
          received: hexSignature.substring(0, 16) + '...',
        });
      } else {
        logger.info('✅ Webhook signature verified successfully');
      }

      return isValid;
    } catch (comparisonError) {
      logger.error('Signature comparison failed - likely invalid hex format', {
        error: comparisonError instanceof Error ? comparisonError.message : String(comparisonError),
      });
      return false;
    }
  } catch (error) {
    logger.error('Signature verification error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Express middleware to verify Interakt webhook signature
 * Must be used after express.json() middleware with raw body capture
 *
 * Requires the request to have a rawBody property set by express.json verify callback
 */
export function createSignatureVerificationMiddleware(
  getSecretFn: (req: any) => string,
  isLocalFn: (req: any) => boolean
) {
  return (req: any, res: any, next: any) => {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const receivedSignature = req.headers['interakt-signature'] as string | undefined;
    const secret = getSecretFn(req);
    const isLocal = isLocalFn(req);

    if (!verifyInteraktSignature(rawBody, receivedSignature, secret, isLocal)) {
      logger.warn('Webhook signature verification failed', {
        path: req.path,
        method: req.method,
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid or missing signature',
        message: 'The Interakt-Signature header is invalid or missing',
      });
    }

    // Signature verified, continue to next middleware
    next();
  };
}
