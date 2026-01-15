/**
 * Request validation utilities
 */

/**
 * Validation error
 */
export class ValidationError extends Error {
  public readonly field: string;
  public readonly code: string;

  constructor(field: string, message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.code = code;
  }
}

/**
 * Event payload interface (for /event endpoint)
 */
export interface EventPayload {
  result: boolean | string;
  message: string;
  id: string;
  apiType: string;
  timestamp: string;
  phoneNumber: string;
  templateName: string;
}

/**
 * Validate event payload
 */
export function validateEventPayload(body: unknown): EventPayload {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('body', 'Request body must be a JSON object');
  }

  const payload = body as Record<string, unknown>;

  // Required fields
  const requiredFields: (keyof EventPayload)[] = [
    'result',
    'message',
    'id',
    'apiType',
    'timestamp',
    'phoneNumber',
    'templateName',
  ];

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      throw new ValidationError(field, `Missing required field: ${field}`);
    }
  }

  // Type validations
  if (typeof payload.message !== 'string') {
    throw new ValidationError('message', 'Field "message" must be a string');
  }

  if (typeof payload.id !== 'string' || payload.id.trim() === '') {
    throw new ValidationError('id', 'Field "id" must be a non-empty string');
  }

  if (typeof payload.apiType !== 'string') {
    throw new ValidationError('apiType', 'Field "apiType" must be a string');
  }

  if (typeof payload.timestamp !== 'string') {
    throw new ValidationError('timestamp', 'Field "timestamp" must be a string');
  }

  if (typeof payload.phoneNumber !== 'string') {
    throw new ValidationError('phoneNumber', 'Field "phoneNumber" must be a string');
  }

  if (typeof payload.templateName !== 'string') {
    throw new ValidationError('templateName', 'Field "templateName" must be a string');
  }

  return {
    result: payload.result as boolean | string,
    message: payload.message as string,
    id: payload.id as string,
    apiType: payload.apiType as string,
    timestamp: payload.timestamp as string,
    phoneNumber: payload.phoneNumber as string,
    templateName: payload.templateName as string,
  };
}

/**
 * Interakt webhook payload interface
 */
export interface InteraktWebhookPayload {
  version?: string;
  type: string;
  timestamp: string;
  data: {
    id?: string;
    customer?: {
      id: string;
      phone_number?: string;
      channel_phone_number?: string;
      traits?: Record<string, unknown>;
    };
    message?: {
      id: string;
      message_status?: string;
      received_at_utc?: string;
      delivered_at_utc?: string;
      seen_at_utc?: string;
      campaign_id?: string;
      raw_template?: string;
      channel_failure_reason?: string;
      channel_error_code?: string;
      message_content_type?: string;
      message?: string;
      media_url?: string;
      meta_data?: Record<string, unknown>;
    };
    event?: Record<string, unknown>;
    workflow_id?: string;
    customer_id?: string;
    customer_number?: string;
    customer_name?: string;
    data?: Array<{
      question: {
        id: string;
        step_number: number;
        message: string;
        user_trait_name?: string;
      };
      answer: {
        id: string;
        message: string;
        received_at_utc: string;
      };
    }>;
  };
}

/**
 * Validate Interakt webhook payload
 */
export function validateWebhookPayload(body: unknown): InteraktWebhookPayload {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('body', 'Request body must be a JSON object');
  }

  const payload = body as Record<string, unknown>;

  if (!payload.type || typeof payload.type !== 'string') {
    throw new ValidationError('type', 'Missing or invalid webhook type');
  }

  if (!payload.data || typeof payload.data !== 'object') {
    throw new ValidationError('data', 'Missing or invalid data object');
  }

  return payload as unknown as InteraktWebhookPayload;
}

/**
 * Sanitize string for safe logging (remove sensitive data)
 */
export function sanitizeForLog(value: string, maxLength = 100): string {
  if (value.length > maxLength) {
    return value.substring(0, maxLength) + '...';
  }
  return value;
}
