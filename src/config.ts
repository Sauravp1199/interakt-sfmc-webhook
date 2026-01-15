import dotenv from 'dotenv';

dotenv.config();

/**
 * Environment-specific credentials configuration
 * LOCAL_* values are used for localhost requests
 * PROD_* values are used for production domain requests
 */
interface EnvironmentCredentials {
  adminKey: string;
  interaktSecret: string;
  webhookSignature: string;
}

/**
 * Application configuration loaded from environment variables
 */
export const config = {
  // Server
  port: parseInt(process.env.PORT || '1112', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // SFMC Authentication
  sfmc: {
    authBaseUrl: process.env.SFMC_AUTH_BASE_URL || 'https://mc72wv4hqz48m1slvbncl40nnlv4.auth.marketingcloudapis.com',
    soapBaseUrl: process.env.SFMC_SOAP_BASE_URL || 'https://mc72wv4hqz48m1slvbncl40nnlv4.soap.marketingcloudapis.com',
    clientId: process.env.SFMC_CLIENT_ID || '',
    clientSecret: process.env.SFMC_CLIENT_SECRET || '',
    accountId: process.env.SFMC_ACCOUNT_ID || '',
  },

  // Data Extension Customer Keys
  dataExtensions: {
    // Event DE (for /event endpoint)
    event: process.env.SFMC_DE_CUSTOMER_KEY || '402A0395-7B93-4866-AF97-530424622A9F',
    // Unified Webhook DE (for /webhook/interakt endpoint - all message status & interactions)
    webhookEvents: process.env.DE_WEBHOOK_EVENTS || '9E205464-0FD8-4D1A-A57D-39F92C70D2C9',
    // Master DE for ALL webhook types (single unified Data Extension)
    webhookMaster: process.env.DE_WEBHOOK_MASTER || '',
  },

  // Environment-specific credentials (LOCAL for localhost, PROD for live domain)
  credentials: {
    local: {
      adminKey: process.env.LOCAL_ADMIN_KEY || '',
      interaktSecret: process.env.LOCAL_INTERAKT_SECRET || '',
      webhookSignature: process.env.LOCAL_WEBHOOK_SIGNATURE || '',
    } as EnvironmentCredentials,
    prod: {
      adminKey: process.env.PROD_ADMIN_KEY || '',
      interaktSecret: process.env.PROD_INTERAKT_SECRET || '',
      webhookSignature: process.env.PROD_WEBHOOK_SIGNATURE || '',
    } as EnvironmentCredentials,
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Token cache settings
  tokenRefreshBuffer: 60, // Refresh token 60 seconds before expiry

  // Retry settings
  maxRetries: 2,
  retryBaseDelayMs: 1000,
};

/**
 * Check if request is from localhost
 */
export function isLocalhost(host: string | undefined): boolean {
  if (!host) return false;
  const lowerHost = host.toLowerCase();
  return (
    lowerHost.startsWith('localhost') ||
    lowerHost.startsWith('127.0.0.1') ||
    lowerHost.startsWith('0.0.0.0')
  );
}

/**
 * Get credentials based on request origin (localhost vs production)
 */
export function getCredentials(host: string | undefined): EnvironmentCredentials {
  return isLocalhost(host) ? config.credentials.local : config.credentials.prod;
}

/**
 * Validate required configuration
 */
export function validateConfig(): void {
  const required = [
    { key: 'SFMC_CLIENT_ID', value: config.sfmc.clientId },
    { key: 'SFMC_CLIENT_SECRET', value: config.sfmc.clientSecret },
    { key: 'SFMC_ACCOUNT_ID', value: config.sfmc.accountId },
  ];

  const missing = required.filter((r) => !r.value);

  if (missing.length > 0) {
    console.warn(
      `Warning: Missing environment variables: ${missing.map((m) => m.key).join(', ')}`
    );
  }

  // Check for local credentials
  if (!config.credentials.local.adminKey) {
    console.warn('Warning: LOCAL_ADMIN_KEY not configured');
  }
  if (!config.credentials.local.interaktSecret) {
    console.warn('Warning: LOCAL_INTERAKT_SECRET not configured');
  }
}
