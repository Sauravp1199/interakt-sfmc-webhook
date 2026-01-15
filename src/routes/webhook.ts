import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config, getCredentials, isLocalhost } from '../config';
import { logger } from '../utils/logger';
import { validateWebhookPayload, ValidationError, InteraktWebhookPayload } from '../utils/validator';
import { upsertToDataExtension } from '../services/sfmcSoap';

const router = Router();

/**
 * All webhook types supported by the master Data Extension
 */
const WEBHOOK_TYPES = {
  // API Message Events
  MESSAGE_API_SENT: 'message_api_sent',
  MESSAGE_API_DELIVERED: 'message_api_delivered',
  MESSAGE_API_READ: 'message_api_read',
  MESSAGE_API_FAILED: 'message_api_failed',
  MESSAGE_API_CLICKED: 'message_api_clicked',

  // Campaign Message Events
  MESSAGE_CAMPAIGN_SENT: 'message_campaign_sent',
  MESSAGE_CAMPAIGN_DELIVERED: 'message_campaign_delivered',
  MESSAGE_CAMPAIGN_READ: 'message_campaign_read',
  MESSAGE_CAMPAIGN_FAILED: 'message_campaign_failed',

  // Incoming Message Events
  MESSAGE_RECEIVED: 'message_received',

  // Workflow Events
  WORKFLOW_RESPONSE_UPDATE: 'workflow_response_update',

  // Account Events
  ACCOUNT_ALERTS: 'account_alerts',
  ACCOUNT_UPDATE: 'account_update',
  ACCOUNT_REVIEW_UPDATE: 'account_review_update',
  BUSINESS_CAPABILITY_UPDATE: 'business_capability_update',

  // Phone Quality Events
  PHONE_NUMBER_QUALITY_UPDATE: 'phone_number_quality_update',

  // Template Events
  TEMPLATE_PERFORMANCE_METRICS: 'template_performance_metrics',
  MESSAGE_TEMPLATE_STATUS_UPDATE: 'message_template_status_update',
};

/**
 * Master Data Extension field interface - Flattened structure with 95 fields
 */
interface MasterWebhookData {
  // Core fields
  event_id: string;
  version: string;
  timestamp: string;
  type: string;

  // Customer fields
  data_customer_id: string;
  data_customer_channel_phone_number: string;
  data_customer_phone_number: string;
  data_customer_country_code: string;
  data_customer_traits_name: string;
  data_customer_traits_amount: string;
  data_customer_traits_total_orders_count: string;
  data_customer_traits_last_order_id: string;
  data_customer_traits_last_order_name: string;
  data_customer_traits_total_spent: string;
  data_customer_traits_whatsapp_opted_in: string;
  data_customer_traits_created_at: string;
  data_customer_traits_user_id: string;
  data_customer_traits_email: string;

  // Message fields
  data_message_id: string;
  data_message_chat_message_type: string;
  data_message_channel_failure_reason: string;
  data_message_message_status: string;
  data_message_received_at_utc: string;
  data_message_delivered_at_utc: string;
  data_message_seen_at_utc: string;
  data_message_campaign_id: string;
  data_message_is_template_message: string;
  data_message_raw_template: string;
  data_message_channel_error_code: string;
  data_message_message_content_type: string;
  data_message_media_url: string;
  data_message_message: string;

  // Message meta data fields
  data_message_meta_data_source: string;
  data_message_meta_data_source_data_callback_data: string;
  data_message_meta_data_message_cost_whatsapp_cost: string;
  data_message_meta_data_message_cost_interakt_markup: string;
  data_message_meta_data_message_cost_actual_message_cost: string;
  data_message_meta_data_click_type: string;
  data_message_meta_data_button_text: string;
  data_message_meta_data_button_link: string;
  data_message_meta_data_click_timestamp: string;
  data_message_meta_data_button_payload_payload_type: string;
  data_message_meta_data_button_payload_payload_text: string;

  // CTA Event fields
  data_event_callbackData: string;
  data_event_click_type: string;
  data_event_button_text: string;
  data_event_button_link: string;
  data_event_click_timestamp: string;

  // Workflow fields
  data_workflow_resp_id: string;
  data_workflow_created_at_utc: string;
  data_workflow_modified_at_utc: string;
  data_workflow_id: string;
  data_workflow_customer_id: string;
  data_workflow_customer_name: string;
  data_workflow_customer_number: string;
  data_workflow_triggered_from: string;
  data_workflow_data_0_question_id: string;
  data_workflow_data_0_question_step_number: string;
  data_workflow_data_0_question_message: string;
  data_workflow_data_0_question_message_type: string;
  data_workflow_data_0_question_list_message_name: string;
  data_workflow_data_0_question_user_trait_name: string;
  data_workflow_data_0_answer_id: string;
  data_workflow_data_0_answer_message: string;
  data_workflow_data_0_answer_received_at_utc: string;
  data_workflow_data_0_answer_message_content_type: string;
  data_workflow_data_1_question_id: string;
  data_workflow_data_1_question_step_number: string;
  data_workflow_data_1_question_message: string;
  data_workflow_data_1_question_message_type: string;
  data_workflow_data_1_question_user_trait_name: string;
  data_workflow_data_1_answer_id: string;
  data_workflow_data_1_answer_message: string;
  data_workflow_data_1_answer_received_at_utc: string;
  data_workflow_data_1_answer_message_content_type: string;

  // Account event fields
  data_account_phone_number: string;
  data_account_event: string;
  data_account_review_decision: string;

  // Business capability fields
  data_business_max_daily_conversation_per_phone: string;
  data_business_max_phone_numbers_per_waba: string;
  data_business_max_phone_numbers_per_business: string;

  // Phone quality fields
  data_phone_quality_display_phone_number: string;
  data_phone_quality_event: string;
  data_phone_quality_current_limit: string;

  // Template performance fields
  data_template_template_id: string;
  data_template_template_name: string;
  data_template_template_language: string;

  // Message template status fields
  data_message_template_event: string;
  data_message_template_id: string;
  data_message_template_name: string;
  data_message_template_language: string;
  data_message_template_reason: string;

  // Raw payload
  data_full_payload_json: string;
}

/**
 * Create empty/default Master Webhook Data object with all 95 fields
 */
function createEmptyMasterData(): MasterWebhookData {
  return {
    // Core fields
    event_id: '',
    version: '',
    timestamp: '',
    type: '',

    // Customer fields
    data_customer_id: '',
    data_customer_channel_phone_number: '',
    data_customer_phone_number: '',
    data_customer_country_code: '',
    data_customer_traits_name: '',
    data_customer_traits_amount: '',
    data_customer_traits_total_orders_count: '',
    data_customer_traits_last_order_id: '',
    data_customer_traits_last_order_name: '',
    data_customer_traits_total_spent: '',
    data_customer_traits_whatsapp_opted_in: '',
    data_customer_traits_created_at: '',
    data_customer_traits_user_id: '',
    data_customer_traits_email: '',

    // Message fields
    data_message_id: '',
    data_message_chat_message_type: '',
    data_message_channel_failure_reason: '',
    data_message_message_status: '',
    data_message_received_at_utc: '',
    data_message_delivered_at_utc: '',
    data_message_seen_at_utc: '',
    data_message_campaign_id: '',
    data_message_is_template_message: '',
    data_message_raw_template: '',
    data_message_channel_error_code: '',
    data_message_message_content_type: '',
    data_message_media_url: '',
    data_message_message: '',

    // Message meta data fields
    data_message_meta_data_source: '',
    data_message_meta_data_source_data_callback_data: '',
    data_message_meta_data_message_cost_whatsapp_cost: '',
    data_message_meta_data_message_cost_interakt_markup: '',
    data_message_meta_data_message_cost_actual_message_cost: '',
    data_message_meta_data_click_type: '',
    data_message_meta_data_button_text: '',
    data_message_meta_data_button_link: '',
    data_message_meta_data_click_timestamp: '',
    data_message_meta_data_button_payload_payload_type: '',
    data_message_meta_data_button_payload_payload_text: '',

    // CTA Event fields
    data_event_callbackData: '',
    data_event_click_type: '',
    data_event_button_text: '',
    data_event_button_link: '',
    data_event_click_timestamp: '',

    // Workflow fields
    data_workflow_resp_id: '',
    data_workflow_created_at_utc: '',
    data_workflow_modified_at_utc: '',
    data_workflow_id: '',
    data_workflow_customer_id: '',
    data_workflow_customer_name: '',
    data_workflow_customer_number: '',
    data_workflow_triggered_from: '',
    data_workflow_data_0_question_id: '',
    data_workflow_data_0_question_step_number: '',
    data_workflow_data_0_question_message: '',
    data_workflow_data_0_question_message_type: '',
    data_workflow_data_0_question_list_message_name: '',
    data_workflow_data_0_question_user_trait_name: '',
    data_workflow_data_0_answer_id: '',
    data_workflow_data_0_answer_message: '',
    data_workflow_data_0_answer_received_at_utc: '',
    data_workflow_data_0_answer_message_content_type: '',
    data_workflow_data_1_question_id: '',
    data_workflow_data_1_question_step_number: '',
    data_workflow_data_1_question_message: '',
    data_workflow_data_1_question_message_type: '',
    data_workflow_data_1_question_user_trait_name: '',
    data_workflow_data_1_answer_id: '',
    data_workflow_data_1_answer_message: '',
    data_workflow_data_1_answer_received_at_utc: '',
    data_workflow_data_1_answer_message_content_type: '',

    // Account event fields
    data_account_phone_number: '',
    data_account_event: '',
    data_account_review_decision: '',

    // Business capability fields
    data_business_max_daily_conversation_per_phone: '',
    data_business_max_phone_numbers_per_waba: '',
    data_business_max_phone_numbers_per_business: '',

    // Phone quality fields
    data_phone_quality_display_phone_number: '',
    data_phone_quality_event: '',
    data_phone_quality_current_limit: '',

    // Template performance fields
    data_template_template_id: '',
    data_template_template_name: '',
    data_template_template_language: '',

    // Message template status fields
    data_message_template_event: '',
    data_message_template_id: '',
    data_message_template_name: '',
    data_message_template_language: '',
    data_message_template_reason: '',

    // Raw payload
    data_full_payload_json: '',
  };
}

/**
 * Verify webhook signature from Interakt
 */
function verifySignature(payload: string, signature: string | undefined, secret: string, isLocal: boolean): boolean {
  if (!signature) {
    if (isLocal) {
      logger.info('No signature provided - allowed in LOCAL environment for testing');
      return true;
    }
    logger.warn('No signature provided in webhook request');
    return !secret;
  }

  if (!secret) {
    logger.warn('INTERAKT_SECRET not configured, skipping signature verification');
    return true;
  }

  const providedSignature = signature.startsWith('sha256=')
    ? signature.substring(7)
    : signature;

  const hmac = crypto.createHmac('sha256', secret);
  const expectedSignature = hmac.update(payload).digest('hex');

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!isValid) {
      logger.error('Invalid webhook signature', {
        expected: expectedSignature.substring(0, 10) + '...',
        received: providedSignature.substring(0, 10) + '...',
      });
    }

    return isValid;
  } catch {
    logger.error('Signature comparison failed');
    return false;
  }
}

/**
 * Truncate string to max length
 */
function truncate(str: string | null | undefined, maxLength: number): string {
  if (!str) return '';
  const strValue = String(str);
  return strValue.length > maxLength ? strValue.substring(0, maxLength) : strValue;
}

/**
 * Safe string conversion
 */
function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Insert data into master webhook Data Extension
 */
async function insertToMasterDE(data: MasterWebhookData): Promise<void> {
  const deKey = config.dataExtensions.webhookMaster || config.dataExtensions.webhookEvents;
  if (!deKey) {
    throw new Error('Master Data Extension key not configured (DE_WEBHOOK_MASTER)');
  }
  await upsertToDataExtension(deKey, data as unknown as Record<string, unknown>);
}

/**
 * Extract customer data from payload
 */
function extractCustomerData(customer: Record<string, unknown> | undefined): Partial<MasterWebhookData> {
  if (!customer) return {};

  const traits = (customer.traits || {}) as Record<string, unknown>;

  return {
    data_customer_id: safeString(customer.id),
    data_customer_channel_phone_number: safeString(customer.channel_phone_number),
    data_customer_phone_number: safeString(customer.phone_number),
    data_customer_country_code: safeString(customer.country_code),
    data_customer_traits_name: safeString(traits.name),
    data_customer_traits_amount: safeString(traits.amount),
    data_customer_traits_total_orders_count: safeString(traits.total_orders_count),
    data_customer_traits_last_order_id: safeString(traits.last_order_id),
    data_customer_traits_last_order_name: safeString(traits.last_order_name),
    data_customer_traits_total_spent: safeString(traits.total_spent),
    data_customer_traits_whatsapp_opted_in: safeString(traits.whatsapp_opted_in),
    data_customer_traits_created_at: safeString(traits.created_at),
    data_customer_traits_user_id: safeString(traits['User Id']),
    data_customer_traits_email: safeString(traits.email),
  };
}

/**
 * Extract message data from payload
 */
function extractMessageData(message: Record<string, unknown> | undefined): Partial<MasterWebhookData> {
  if (!message) return {};

  const metaData = (message.meta_data || {}) as Record<string, unknown>;
  const sourceData = (metaData.source_data || {}) as Record<string, unknown>;
  const messageCost = (metaData.message_cost || {}) as Record<string, unknown>;
  const buttonPayload = (metaData.button_payload || {}) as Record<string, unknown>;
  const payloadInner = (buttonPayload.payload || {}) as Record<string, unknown>;

  return {
    data_message_id: safeString(message.id),
    data_message_chat_message_type: safeString(message.chat_message_type),
    data_message_channel_failure_reason: safeString(message.channel_failure_reason),
    data_message_message_status: safeString(message.message_status),
    data_message_received_at_utc: safeString(message.received_at_utc),
    data_message_delivered_at_utc: safeString(message.delivered_at_utc),
    data_message_seen_at_utc: safeString(message.seen_at_utc),
    data_message_campaign_id: safeString(message.campaign_id),
    data_message_is_template_message: safeString(message.is_template_message),
    data_message_raw_template: truncate(safeString(message.raw_template), 4000),
    data_message_channel_error_code: safeString(message.channel_error_code),
    data_message_message_content_type: safeString(message.message_content_type),
    data_message_media_url: safeString(message.media_url),
    data_message_message: truncate(safeString(message.message), 4000),
    data_message_meta_data_source: safeString(metaData.source),
    data_message_meta_data_source_data_callback_data: safeString(sourceData.callback_data),
    data_message_meta_data_message_cost_whatsapp_cost: safeString(messageCost.whatsapp_cost),
    data_message_meta_data_message_cost_interakt_markup: safeString(messageCost.interakt_markup),
    data_message_meta_data_message_cost_actual_message_cost: safeString(messageCost.actual_message_cost),
    data_message_meta_data_click_type: safeString(metaData.click_type),
    data_message_meta_data_button_text: safeString(metaData.button_text),
    data_message_meta_data_button_link: safeString(metaData.button_link),
    data_message_meta_data_click_timestamp: safeString(metaData.click_timestamp),
    data_message_meta_data_button_payload_payload_type: safeString(payloadInner.type),
    data_message_meta_data_button_payload_payload_text: safeString(payloadInner.text),
  };
}

/**
 * Extract CTA event data from payload
 */
function extractEventData(event: Record<string, unknown> | undefined): Partial<MasterWebhookData> {
  if (!event) return {};

  return {
    data_event_callbackData: safeString(event.callbackData),
    data_event_click_type: safeString(event.click_type),
    data_event_button_text: safeString(event.button_text),
    data_event_button_link: safeString(event.button_link),
    data_event_click_timestamp: safeString(event.click_timestamp),
  };
}

/**
 * Handle message events (sent, delivered, read, failed, clicked, received)
 */
async function handleMessageEvent(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const { customer, message, event } = payload.data;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    ...extractCustomerData(customer as Record<string, unknown>),
    ...extractMessageData(message as Record<string, unknown>),
    ...extractEventData(event as Record<string, unknown>),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * Handle workflow response events
 */
async function handleWorkflowResponse(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const data = payload.data as Record<string, unknown>;

  if (!data.workflow_id || !data.data) {
    throw new Error('Missing workflow data');
  }

  const workflowData = data.data as Array<{
    question: Record<string, unknown>;
    answer: Record<string, unknown>;
  }>;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_workflow_resp_id: safeString(data.id),
    data_workflow_created_at_utc: safeString(data.created_at_utc),
    data_workflow_modified_at_utc: safeString(data.modified_at_utc),
    data_workflow_id: safeString(data.workflow_id),
    data_workflow_customer_id: safeString(data.customer_id),
    data_workflow_customer_name: safeString(data.customer_name),
    data_workflow_customer_number: safeString(data.customer_number),
    data_workflow_triggered_from: safeString(data.triggered_from),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  // Extract first Q&A pair (index 0)
  if (workflowData.length > 0) {
    const qa0 = workflowData[0];
    deData.data_workflow_data_0_question_id = safeString(qa0.question.id);
    deData.data_workflow_data_0_question_step_number = safeString(qa0.question.step_number);
    deData.data_workflow_data_0_question_message = truncate(safeString(qa0.question.message), 500);
    deData.data_workflow_data_0_question_message_type = safeString(qa0.question.message_type);
    deData.data_workflow_data_0_question_list_message_name = safeString(qa0.question.list_message_name);
    deData.data_workflow_data_0_question_user_trait_name = safeString(qa0.question.user_trait_name);
    deData.data_workflow_data_0_answer_id = safeString(qa0.answer.id);
    deData.data_workflow_data_0_answer_message = truncate(safeString(qa0.answer.message), 500);
    deData.data_workflow_data_0_answer_received_at_utc = safeString(qa0.answer.received_at_utc);
    deData.data_workflow_data_0_answer_message_content_type = safeString(qa0.answer.message_content_type);
  }

  // Extract second Q&A pair (index 1)
  if (workflowData.length > 1) {
    const qa1 = workflowData[1];
    deData.data_workflow_data_1_question_id = safeString(qa1.question.id);
    deData.data_workflow_data_1_question_step_number = safeString(qa1.question.step_number);
    deData.data_workflow_data_1_question_message = truncate(safeString(qa1.question.message), 500);
    deData.data_workflow_data_1_question_message_type = safeString(qa1.question.message_type);
    deData.data_workflow_data_1_question_user_trait_name = safeString(qa1.question.user_trait_name);
    deData.data_workflow_data_1_answer_id = safeString(qa1.answer.id);
    deData.data_workflow_data_1_answer_message = truncate(safeString(qa1.answer.message), 500);
    deData.data_workflow_data_1_answer_received_at_utc = safeString(qa1.answer.received_at_utc);
    deData.data_workflow_data_1_answer_message_content_type = safeString(qa1.answer.message_content_type);
  }

  await insertToMasterDE(deData);
}

/**
 * Handle account events (alerts, update, review_update)
 */
async function handleAccountEvent(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const data = payload.data as Record<string, unknown>;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_account_phone_number: safeString(data.phone_number),
    data_account_event: safeString(data.event),
    data_account_review_decision: safeString(data.decision),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * Handle business capability update events
 */
async function handleBusinessCapabilityUpdate(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const data = payload.data as Record<string, unknown>;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_business_max_daily_conversation_per_phone: safeString(data.max_daily_conversation_per_phone),
    data_business_max_phone_numbers_per_waba: safeString(data.max_phone_numbers_per_waba),
    data_business_max_phone_numbers_per_business: safeString(data.max_phone_numbers_per_business),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * Handle phone number quality update events
 */
async function handlePhoneNumberQualityUpdate(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const data = payload.data as Record<string, unknown>;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_phone_quality_display_phone_number: safeString(data.display_phone_number),
    data_phone_quality_event: safeString(data.event),
    data_phone_quality_current_limit: safeString(data.current_limit),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * Handle template performance metrics events
 */
async function handleTemplatePerformanceMetrics(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const data = payload.data as Record<string, unknown>;
  const templateMetrics = (data.templates_performance_metrics || data) as Record<string, unknown>;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_template_template_id: safeString(templateMetrics.template_id),
    data_template_template_name: safeString(templateMetrics.template_name),
    data_template_template_language: safeString(templateMetrics.template_language),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * Handle message template status update events
 */
async function handleMessageTemplateStatusUpdate(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const data = payload.data as Record<string, unknown>;

  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_message_template_event: safeString(data.event),
    data_message_template_id: safeString(data.message_template_id),
    data_message_template_name: safeString(data.message_template_name),
    data_message_template_language: safeString(data.message_template_language),
    data_message_template_reason: safeString(data.reason),
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * Handle generic/unknown events
 */
async function handleGenericEvent(payload: InteraktWebhookPayload, rawPayload: string): Promise<void> {
  const deData: MasterWebhookData = {
    ...createEmptyMasterData(),
    event_id: `evt_${uuidv4()}`,
    version: payload.version || '1.0',
    timestamp: payload.timestamp,
    type: payload.type,
    data_full_payload_json: truncate(rawPayload, 4000),
  };

  await insertToMasterDE(deData);
}

/**
 * POST /webhook/interakt
 * Main webhook endpoint for Interakt events - stores ALL events in master Data Extension
 */
router.post('/interakt', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId =
    (req.headers['x-request-id'] as string) ||
    `wh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    const host = req.headers.host as string | undefined;
    const credentials = getCredentials(host);
    const envType = isLocalhost(host) ? 'LOCAL' : 'PROD';

    logger.debug('Request environment detected', { host, envType, requestId });

    const rawBody = JSON.stringify(req.body);

    const signature = req.headers['x-interakt-signature'] as string | undefined;
    const isLocal = envType === 'LOCAL';
    if (!verifySignature(rawBody, signature, credentials.interaktSecret, isLocal)) {
      logger.warn('Invalid webhook signature', { requestId, envType });
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
        requestId,
        environment: envType,
      });
    }

    const payload = validateWebhookPayload(req.body);

    logger.info('Webhook received', {
      requestId,
      type: payload.type,
      timestamp: payload.timestamp,
      messageId: payload.data.message?.id || payload.data.id,
    });

    // Route based on webhook type - ALL events go to master DE
    switch (payload.type) {
      // Message events
      case WEBHOOK_TYPES.MESSAGE_API_SENT:
      case WEBHOOK_TYPES.MESSAGE_CAMPAIGN_SENT:
      case WEBHOOK_TYPES.MESSAGE_API_DELIVERED:
      case WEBHOOK_TYPES.MESSAGE_CAMPAIGN_DELIVERED:
      case WEBHOOK_TYPES.MESSAGE_API_READ:
      case WEBHOOK_TYPES.MESSAGE_CAMPAIGN_READ:
      case WEBHOOK_TYPES.MESSAGE_API_FAILED:
      case WEBHOOK_TYPES.MESSAGE_CAMPAIGN_FAILED:
      case WEBHOOK_TYPES.MESSAGE_API_CLICKED:
      case WEBHOOK_TYPES.MESSAGE_RECEIVED:
        await handleMessageEvent(payload, rawBody);
        break;

      // Workflow events
      case WEBHOOK_TYPES.WORKFLOW_RESPONSE_UPDATE:
        await handleWorkflowResponse(payload, rawBody);
        break;

      // Account events
      case WEBHOOK_TYPES.ACCOUNT_ALERTS:
      case WEBHOOK_TYPES.ACCOUNT_UPDATE:
      case WEBHOOK_TYPES.ACCOUNT_REVIEW_UPDATE:
        await handleAccountEvent(payload, rawBody);
        break;

      // Business capability events
      case WEBHOOK_TYPES.BUSINESS_CAPABILITY_UPDATE:
        await handleBusinessCapabilityUpdate(payload, rawBody);
        break;

      // Phone quality events
      case WEBHOOK_TYPES.PHONE_NUMBER_QUALITY_UPDATE:
        await handlePhoneNumberQualityUpdate(payload, rawBody);
        break;

      // Template events
      case WEBHOOK_TYPES.TEMPLATE_PERFORMANCE_METRICS:
        await handleTemplatePerformanceMetrics(payload, rawBody);
        break;

      case WEBHOOK_TYPES.MESSAGE_TEMPLATE_STATUS_UPDATE:
        await handleMessageTemplateStatusUpdate(payload, rawBody);
        break;

      default:
        logger.warn('Unhandled webhook type', { type: payload.type, requestId });
        await handleGenericEvent(payload, rawBody);
    }

    const processingTime = Date.now() - startTime;

    logger.info('Webhook processed successfully', {
      requestId,
      type: payload.type,
      processingTime,
    });

    return res.status(200).json({
      success: true,
      requestId,
      processingTime,
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;

    if (error instanceof ValidationError) {
      logger.warn('Webhook validation failed', {
        requestId,
        field: error.field,
        message: error.message,
      });

      return res.status(400).json({
        success: false,
        error: error.message,
        field: error.field,
        requestId,
        processingTime,
      });
    }

    logger.error('Webhook processing error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      processingTime,
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      requestId,
      processingTime,
    });
  }
});

export default router;
