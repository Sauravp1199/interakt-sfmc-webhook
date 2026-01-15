import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Token cache interface
 */
interface TokenCache {
  accessToken: string;
  expiresAt: number;
  soapInstanceUrl: string;
}

/**
 * SFMC Auth Response interface
 */
interface SFMCAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  soap_instance_url: string;
  rest_instance_url: string;
}

// In-memory token cache
let tokenCache: TokenCache | null = null;

// Token refresh lock to prevent concurrent refreshes
let tokenRefreshPromise: Promise<TokenCache> | null = null;

/**
 * Check if token is expired or about to expire
 */
function isTokenExpired(): boolean {
  if (!tokenCache) {
    return true;
  }
  // Token is expired if current time + buffer > expiry time
  const bufferMs = config.tokenRefreshBuffer * 1000;
  return Date.now() + bufferMs >= tokenCache.expiresAt;
}

/**
 * Fetch new access token from SFMC
 */
async function fetchNewToken(): Promise<TokenCache> {
  logger.info('Fetching new SFMC access token');

  try {
    const response = await axios.post<SFMCAuthResponse>(
      `${config.sfmc.authBaseUrl}/v2/token`,
      {
        grant_type: 'client_credentials',
        client_id: config.sfmc.clientId,
        client_secret: config.sfmc.clientSecret,
        account_id: config.sfmc.accountId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { access_token, expires_in, soap_instance_url } = response.data;

    // Calculate expiry time (current time + expires_in seconds)
    const expiresAt = Date.now() + expires_in * 1000;

    const newTokenCache: TokenCache = {
      accessToken: access_token,
      expiresAt,
      soapInstanceUrl: soap_instance_url || config.sfmc.soapBaseUrl,
    };

    logger.info('SFMC token obtained successfully', {
      expiresIn: expires_in,
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return newTokenCache;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('SFMC authentication failed', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      throw new Error(`SFMC authentication failed: ${error.response?.data?.error_description || error.message}`);
    }
    throw error;
  }
}

/**
 * Get valid access token (from cache or fetch new one)
 * Implements token refresh lock to handle concurrent requests
 */
export async function getAccessToken(): Promise<string> {
  // If token is valid, return cached token
  if (!isTokenExpired() && tokenCache) {
    logger.debug('Using cached SFMC token');
    return tokenCache.accessToken;
  }

  // If a refresh is already in progress, wait for it
  if (tokenRefreshPromise) {
    logger.debug('Waiting for in-progress token refresh');
    const cache = await tokenRefreshPromise;
    return cache.accessToken;
  }

  // Start new token refresh
  try {
    tokenRefreshPromise = fetchNewToken();
    tokenCache = await tokenRefreshPromise;
    return tokenCache.accessToken;
  } finally {
    // Clear the refresh promise so future requests can refresh if needed
    tokenRefreshPromise = null;
  }
}

/**
 * Get SOAP instance URL (from cache or config)
 */
export function getSoapInstanceUrl(): string {
  return tokenCache?.soapInstanceUrl || config.sfmc.soapBaseUrl;
}

/**
 * Clear token cache (for testing or forced refresh)
 */
export function clearTokenCache(): void {
  tokenCache = null;
  tokenRefreshPromise = null;
  logger.info('SFMC token cache cleared');
}

/**
 * Get token cache status (for monitoring)
 */
export function getTokenCacheStatus(): {
  hasCachedToken: boolean;
  isExpired: boolean;
  expiresAt: string | null;
} {
  return {
    hasCachedToken: tokenCache !== null,
    isExpired: isTokenExpired(),
    expiresAt: tokenCache ? new Date(tokenCache.expiresAt).toISOString() : null,
  };
}
