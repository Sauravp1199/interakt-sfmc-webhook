import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { validateEventPayload, ValidationError } from '../utils/validator';
import { insertToDataExtension } from '../services/sfmcRest';

const router = Router();

/**
 * POST /event
 * Receive event payload and insert into SFMC Data Extension
 *
 * SIGNATURE VALIDATION:
 * Signature verification is handled by signatureAuthMiddleware in src/middleware/signature-auth.ts
 * This middleware validates the Interakt-Signature header before the request reaches this handler
 *
 * Therefore, if we reach this point, the signature is already verified as valid
 */
router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  logger.info('Event received', { requestId });

  try {
    // NOTE: Signature verification is already done by signatureAuthMiddleware
    // No need to check signature here - it's already validated

    // Validate request payload
    const payload = validateEventPayload(req.body);

    logger.debug('Event payload validated', {
      requestId,
      id: payload.id,
      apiType: payload.apiType,
    });

    // Map payload to Data Extension fields
    const deData = {
      result: String(payload.result),
      message: payload.message,
      id: payload.id,
      apiType: payload.apiType,
      timestamp: payload.timestamp,
      phoneNumber: payload.phoneNumber,
      templateName: payload.templateName,
    };

    // Insert into SFMC Data Extension
    const soapResponse = await insertToDataExtension(
      config.dataExtensions.event,
      deData
    );

    const processingTime = Date.now() - startTime;

    if (soapResponse.status === 'OK') {
      logger.info('Event processed successfully', {
        requestId,
        processingTime,
        sfmcRequestId: soapResponse.requestId,
      });

      return res.status(200).json({
        status: 'OK',
        statusMessage: soapResponse.statusMessage,
        requestId: soapResponse.requestId,
        overallStatus: soapResponse.overallStatus,
        processingTime,
      });
    } else {
      logger.error('SFMC insert failed', {
        requestId,
        statusCode: soapResponse.statusCode,
        statusMessage: soapResponse.statusMessage,
        processingTime,
      });

      return res.status(500).json({
        status: 'ERROR',
        statusMessage: soapResponse.statusMessage,
        requestId: soapResponse.requestId,
        overallStatus: soapResponse.overallStatus,
        processingTime,
        rawResponse: config.nodeEnv === 'development' ? soapResponse.rawResponse : undefined,
      });
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;

    if (error instanceof ValidationError) {
      logger.warn('Event validation failed', {
        requestId,
        field: error.field,
        message: error.message,
      });

      return res.status(400).json({
        status: 'ERROR',
        statusMessage: error.message,
        field: error.field,
        code: error.code,
        processingTime,
      });
    }

    logger.error('Event processing error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      processingTime,
    });

    return res.status(500).json({
      status: 'ERROR',
      statusMessage: error instanceof Error ? error.message : 'Internal server error',
      requestId,
      processingTime,
    });
  }
});

export default router;
