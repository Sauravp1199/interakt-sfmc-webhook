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
 * Detect webhook type from payload structure
 * Used for auto-normalization when type is missing
 */
function detectWebhookType(payload: Record<string, unknown>): string {
  const message = payload.message as Record<string, unknown> | undefined;
  const event = payload.event as Record<string, unknown> | undefined;

  // If it's a click event, infer from event object
  if (event && event.click_type) {
    return 'message_api_clicked';
  }

  // If it has message with status, infer from message_status
  if (message && message.message_status) {
    const status = String(message.message_status).toLowerCase();
    switch (status) {
      case 'sent':
        return 'message_api_sent';
      case 'delivered':
        return 'message_api_delivered';
      case 'read':
        return 'message_api_read';
      case 'failed':
        return 'message_api_failed';
      case 'received':
        return 'message_received';
      default:
        return 'message_api_sent';
    }
  }

  // Default fallback
  return 'message_api_sent';
}

/**
 * Auto-normalize payload format
 * Supports both:
 * 1. Standard format: {"version": "1.0", "type": "...", "timestamp": "...", "data": {...}}
 * 2. Legacy format: {"customer": {...}, "message": {...}, "event": {...}} (auto-wrapped and transformed)
 *
 * For legacy format, event fields are merged into message.meta_data to ensure consistency
 */
function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  // Check if it's already in correct format (has type and data)
  if (payload.type && typeof payload.type === 'string' && payload.data && typeof payload.data === 'object') {
    // Already normalized
    return payload;
  }

  // Check if it's the legacy format (customer/message/event at root)
  const hasCustomer = payload.customer && typeof payload.customer === 'object';
  const hasMessage = payload.message && typeof payload.message === 'object';
  const hasEvent = payload.event && typeof payload.event === 'object';

  if (hasCustomer || hasMessage || hasEvent) {
    // Auto-normalize: wrap in required structure and transform event to meta_data

    // Start with the message object, or empty if not provided
    const messageData = (payload.message || {}) as Record<string, unknown>;
    let normalizedMessage: Record<string, unknown> = {};

    // Copy all message fields
    for (const [key, value] of Object.entries(messageData)) {
      if (value !== undefined) {
        normalizedMessage[key] = value;
      }
    }

    // If event exists, merge its fields into message.meta_data
    if (hasEvent) {
      const eventData = payload.event as Record<string, unknown>;
      const existingMetaData = (normalizedMessage.meta_data || {}) as Record<string, unknown>;

      // Create a new meta_data object with existing data
      const mergedMetaData: Record<string, unknown> = {};

      // Copy existing meta_data fields
      for (const [key, value] of Object.entries(existingMetaData)) {
        if (value !== undefined) {
          mergedMetaData[key] = value;
        }
      }

      // Copy all event fields into meta_data
      for (const [key, value] of Object.entries(eventData)) {
        if (value !== undefined && value !== null) {
          mergedMetaData[key] = value;
        }
      }

      normalizedMessage.meta_data = mergedMetaData;
    }

    // Build the normalized data object
    const dataObj: Record<string, unknown> = {
      customer: payload.customer,
      message: normalizedMessage,
    };

    // Include any other root-level fields in data (but exclude event since we merged it)
    if (payload.id) {
      dataObj.id = payload.id;
    }
    if (payload.workflow_id) {
      dataObj.workflow_id = payload.workflow_id;
    }
    if (payload.customer_id) {
      dataObj.customer_id = payload.customer_id;
    }
    if (payload.customer_name) {
      dataObj.customer_name = payload.customer_name;
    }
    if (payload.customer_number) {
      dataObj.customer_number = payload.customer_number;
    }
    if (payload.data && payload.data !== payload.customer) {
      dataObj.data = payload.data;
    }

    // Detect webhook type from the payload
    const detectedType = detectWebhookType(payload);

    const normalized = {
      version: payload.version || '1.0',
      type: payload.type || detectedType,
      timestamp: payload.timestamp || new Date().toISOString(),
      data: dataObj,
    };

    return normalized;
  }

  // Return as-is if we can't determine the format
  return payload;
}

/**
 * Validate Interakt webhook payload
 * Supports two payload formats:
 * 1. Standard format: {"version": "1.0", "type": "message_api_sent", "timestamp": "...", "data": {...}}
 * 2. Simplified format: {"customer": {...}, "message": {...}, "event": {...}} (auto-normalized to #1)
 */
export function validateWebhookPayload(body: unknown): InteraktWebhookPayload {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('body', 'Request body must be a JSON object');
  }

  let payload = body as Record<string, unknown>;

  // Auto-normalize payload if needed
  payload = normalizePayload(payload);

  // After normalization, ensure we have the required fields
  const normalizedPayload = payload as Record<string, unknown>;

  // Ensure type exists
  if (!normalizedPayload.type) {
    const hasData = normalizedPayload.customer || normalizedPayload.message || normalizedPayload.event;
    if (hasData) {
      // If data exists but no type, we should have normalized it - something is wrong
      throw new ValidationError('type', 'Failed to detect webhook type from payload');
    }
    throw new ValidationError('type', 'Missing type field');
  }

  if (typeof normalizedPayload.type !== 'string') {
    throw new ValidationError('type', 'Field "type" must be a string');
  }

  // Ensure data exists
  if (!normalizedPayload.data) {
    throw new ValidationError('data', 'Missing data object');
  }

  if (typeof normalizedPayload.data !== 'object' || normalizedPayload.data === null) {
    throw new ValidationError('data', 'Field "data" must be an object');
  }

  return normalizedPayload as unknown as InteraktWebhookPayload;
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
