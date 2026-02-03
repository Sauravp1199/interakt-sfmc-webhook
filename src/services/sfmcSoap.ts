import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getAccessToken, getSoapInstanceUrl } from './sfmcAuth';
import {
  buildCreateSoapEnvelope,
  buildUpdateSoapEnvelope,
  DEProperty,
  objectToProperties,
} from '../utils/soapBuilder';
import { parseSoapResponse, isDuplicateKeyError, SoapResponse } from '../utils/soapParser';

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize URL - remove trailing slashes and fix double slashes
 */
function normalizeUrl(url: string): string {
  if (!url) return '';
  let normalized = url.replace(/\/+$/, '');
  normalized = normalized.replace(/([^:])\/\/+/g, '$1/');
  return normalized;
}

/**
 * Execute SOAP request with retry logic
 */
async function executeSoapRequest(
  soapEnvelope: string,
  operation: 'Create' | 'Update',
  retryCount = 0
): Promise<SoapResponse> {
  // Normalize the URL to prevent double slashes
  const baseUrl = normalizeUrl(getSoapInstanceUrl());
  const soapEndpoint = `${baseUrl}/Service.asmx`;

  try {
    logger.info('SOAP request sent', {
      operation,
      endpoint: soapEndpoint,
      retryCount
    });

    const response = await axios.post(soapEndpoint, soapEnvelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: operation,
      },
      timeout: 30000, // 30 second timeout
    });

    const parsedResponse = await parseSoapResponse(response.data);

    logger.info('SOAP response received', {
      status: parsedResponse.status,
      statusCode: parsedResponse.statusCode
    });

    return parsedResponse;
  } catch (error) {
    // Handle network/timeout errors with retry
    if (axios.isAxiosError(error) && retryCount < config.maxRetries) {
      const isRetryable =
        !error.response || // Network error
        error.code === 'ECONNABORTED' || // Timeout
        (error.response.status >= 500 && error.response.status < 600); // Server error

      if (isRetryable) {
        const delay = config.retryBaseDelayMs * Math.pow(2, retryCount); // Exponential backoff
        logger.warn(`SOAP ${operation} failed, retrying in ${delay}ms`, {
          error: error.message,
          retryCount: retryCount + 1,
          maxRetries: config.maxRetries,
        });

        await sleep(delay);
        return executeSoapRequest(soapEnvelope, operation, retryCount + 1);
      }
    }

    // Log and re-throw non-retryable errors
    if (axios.isAxiosError(error)) {
      logger.error('SOAP request failed', {
        operation,
        status: error.response?.status,
        message: error.message
      });

      // Try to parse error response if available
      if (error.response?.data) {
        return parseSoapResponse(error.response.data);
      }

      return {
        status: 'ERROR',
        statusCode: String(error.response?.status || 'NETWORK_ERROR'),
        statusMessage: error.message,
        requestId: '',
        overallStatus: 'Error',
        rawSoapResponse: error.response?.data || '',
      };
    }

    throw error;
  }
}

/**
 * Insert data into SFMC Data Extension
 */
export async function insertToDataExtension(
  customerKey: string,
  data: Record<string, unknown>
): Promise<SoapResponse> {
  const accessToken = await getAccessToken();
  const soapEndpoint = getSoapInstanceUrl();
  const properties = objectToProperties(data);

  logger.info('Inserting data into SFMC Data Extension', {
    customerKey,
    fieldCount: properties.length,
  });

  const soapEnvelope = buildCreateSoapEnvelope(
    accessToken,
    soapEndpoint,
    customerKey,
    properties
  );

  return executeSoapRequest(soapEnvelope, 'Create');
}

/**
 * Update data in SFMC Data Extension
 */
export async function updateDataExtension(
  customerKey: string,
  data: Record<string, unknown>
): Promise<SoapResponse> {
  const accessToken = await getAccessToken();
  const soapEndpoint = getSoapInstanceUrl();
  const properties = objectToProperties(data);

  logger.info('Updating data in SFMC Data Extension', {
    customerKey,
    fieldCount: properties.length,
  });

  const soapEnvelope = buildUpdateSoapEnvelope(
    accessToken,
    soapEndpoint,
    customerKey,
    properties
  );

  return executeSoapRequest(soapEnvelope, 'Update');
}

/**
 * Upsert data into SFMC Data Extension
 * Tries insert first, if duplicate error then updates
 */
export async function upsertToDataExtension(
  customerKey: string,
  data: Record<string, unknown>
): Promise<SoapResponse> {
  // Try insert first
  const insertResponse = await insertToDataExtension(customerKey, data);

  // If successful, return
  if (insertResponse.status === 'OK') {
    return insertResponse;
  }

  // If duplicate key error, try update
  if (isDuplicateKeyError(insertResponse)) {
    logger.info('Duplicate record detected, attempting update', {
      customerKey,
    });
    return updateDataExtension(customerKey, data);
  }

  // Return the original error
  return insertResponse;
}

/**
 * Insert with custom properties array (for advanced use cases)
 */
export async function insertWithProperties(
  customerKey: string,
  properties: DEProperty[]
): Promise<SoapResponse> {
  const accessToken = await getAccessToken();
  const soapEndpoint = getSoapInstanceUrl();

  logger.info('Inserting data with custom properties', {
    customerKey,
    fieldCount: properties.length,
  });

  const soapEnvelope = buildCreateSoapEnvelope(
    accessToken,
    soapEndpoint,
    customerKey,
    properties
  );

  return executeSoapRequest(soapEnvelope, 'Create');
}
