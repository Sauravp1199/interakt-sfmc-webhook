import { parseStringPromise } from 'xml2js';
import { logger } from './logger';

/**
 * SOAP Response parsed result
 */
export interface SoapResponse {
  status: 'OK' | 'ERROR';
  statusCode: string;
  statusMessage: string;
  requestId: string;
  overallStatus: string;
  rawSoapResponse: string;
}

/**
 * Parse SOAP Create/Update response from SFMC
 */
export async function parseSoapResponse(xmlResponse: string): Promise<SoapResponse> {
  try {
    const result = await parseStringPromise(xmlResponse, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name) => name.replace(/^.*:/, '')], // Remove namespace prefixes
    });

    // Navigate to response body
    const envelope = result.Envelope;
    const body = envelope?.Body;

    // Check for CreateResponse or UpdateResponse
    const createResponse = body?.CreateResponse;
    const updateResponse = body?.UpdateResponse;
    const response = createResponse || updateResponse;

    if (!response) {
      logger.error('Invalid SOAP response structure', { body });
      return {
        status: 'ERROR',
        statusCode: 'PARSE_ERROR',
        statusMessage: 'Invalid SOAP response structure',
        requestId: '',
        overallStatus: 'Error',
        rawSoapResponse: xmlResponse,
      };
    }

    const overallStatus = response.OverallStatus || 'Unknown';
    const requestId = response.RequestID || '';
    const results = response.Results;

    // Extract status from Results
    const statusCode = results?.StatusCode || overallStatus;
    const statusMessage = results?.StatusMessage || '';

    const isSuccess = overallStatus === 'OK';

    logger.debug('SOAP response parsed', {
      overallStatus,
      statusCode,
      statusMessage,
      requestId,
    });

    return {
      status: isSuccess ? 'OK' : 'ERROR',
      statusCode,
      statusMessage,
      requestId,
      overallStatus,
      rawSoapResponse: xmlResponse,
    };
  } catch (error) {
    logger.error('Failed to parse SOAP response', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: 'ERROR',
      statusCode: 'PARSE_ERROR',
      statusMessage: `Failed to parse SOAP response: ${error instanceof Error ? error.message : String(error)}`,
      requestId: '',
      overallStatus: 'Error',
      rawSoapResponse: xmlResponse,
    };
  }
}

/**
 * Check if error is a duplicate key error (for upsert logic)
 */
export function isDuplicateKeyError(soapResponse: SoapResponse): boolean {
  const message = soapResponse.statusMessage.toLowerCase();
  return (
    message.includes('duplicate') ||
    message.includes('exists') ||
    message.includes('unique') ||
    message.includes('primary key')
  );
}
