import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getAccessToken, getRestInstanceUrl } from './sfmcAuth';

/**
 * Standard response interface for API operations
 */
export interface RestResponse {
  status: 'OK' | 'ERROR';
  statusCode: string;
  statusMessage: string;
  requestId: string;
  overallStatus: string;
  rawResponse?: unknown;
}

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
 * Execute REST request with retry logic
 */
async function executeRestRequest(
  url: string,
  data: Record<string, unknown>,
  accessToken: string,
  retryCount = 0
): Promise<RestResponse> {
  const normalizedUrl = normalizeUrl(url);

  try {
    logger.info('REST request sent', { method: 'POST', url: normalizedUrl, retryCount });

    const response = await axios.post(normalizedUrl, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      timeout: 30000, // 30 second timeout
    });

    logger.info('REST response received', { status: response.status, statusText: response.statusText });

    const responseData = response.data as Record<string, unknown>;

    return {
      status: 'OK',
      statusCode: String(response.status),
      statusMessage: 'Success',
      requestId: String(responseData.requestId || responseData.id || ''),
      overallStatus: 'OK',
      rawResponse: responseData,
    };
  } catch (error) {
    // Handle network/timeout errors with retry
    if (axios.isAxiosError(error) && retryCount < config.maxRetries) {
      const isRetryable =
        !error.response || // Network error
        error.code === 'ECONNABORTED' || // Timeout
        (error.response.status >= 500 && error.response.status < 600); // Server error

      if (isRetryable) {
        const delay = config.retryBaseDelayMs * Math.pow(2, retryCount); // Exponential backoff
        logger.warn(`REST request failed, retrying in ${delay}ms`, {
          error: error.message,
          retryCount: retryCount + 1,
          maxRetries: config.maxRetries,
        });

        await sleep(delay);
        return executeRestRequest(url, data, accessToken, retryCount + 1);
      }
    }

    // Log and return error response
    if (axios.isAxiosError(error)) {
      logger.error('REST request failed', {
        url: normalizedUrl,
        status: error.response?.status,
        message: error.message
      });

      return {
        status: 'ERROR',
        statusCode: String(error.response?.status || 'NETWORK_ERROR'),
        statusMessage: error.message,
        requestId: '',
        overallStatus: 'Error',
        rawResponse: error.response?.data || {},
      };
    }

    throw error;
  }
}

/**
 * Insert data into SFMC Data Extension via REST API
 */
export async function insertToDataExtension(
  customerKey: string,
  data: Record<string, unknown>
): Promise<RestResponse> {
  const accessToken = await getAccessToken();
  const restInstanceUrl = getRestInstanceUrl();

  const url = `${restInstanceUrl}/hub/v1/dataevents/key:${customerKey}/rowset`;

  logger.info('Inserting data into SFMC Data Extension via REST API', {
    customerKey,
    fieldCount: Object.keys(data).length,
  });

  return executeRestRequest(url, { rows: [data] }, accessToken);
}

/**
 * Upsert data into SFMC Data Extension via REST API
 * REST API handles upserts automatically based on primary keys
 */
export async function upsertToDataExtension(
  customerKey: string,
  data: Record<string, unknown>
): Promise<RestResponse> {
  const accessToken = await getAccessToken();
  const restInstanceUrl = getRestInstanceUrl();

  const url = `${restInstanceUrl}/hub/v1/dataevents/key:${customerKey}/rowset`;

  logger.info('Upserting data into SFMC Data Extension via REST API', {
    customerKey,
    fieldCount: Object.keys(data).length,
  });

  return executeRestRequest(url, { rows: [data] }, accessToken);
}

/**
 * Update data in SFMC Data Extension via REST API
 * For REST API, update and upsert are handled the same way
 */
export async function updateDataExtension(
  customerKey: string,
  data: Record<string, unknown>
): Promise<RestResponse> {
  // REST API handles updates the same as upserts
  return upsertToDataExtension(customerKey, data);
}

/**
 * Insert with custom data array (for batch operations)
 */
export async function insertWithData(
  customerKey: string,
  dataArray: Record<string, unknown>[]
): Promise<RestResponse> {
  const accessToken = await getAccessToken();
  const restInstanceUrl = getRestInstanceUrl();

  const url = `${restInstanceUrl}/hub/v1/dataevents/key:${customerKey}/rowset`;

  logger.info('Inserting batch data into SFMC Data Extension via REST API', {
    customerKey,
    rowCount: dataArray.length,
  });

  return executeRestRequest(url, { rows: dataArray }, accessToken);
}
