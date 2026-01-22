/**
 * Webhook Handler for Interakt Webhooks
 *
 * Handles all 15 webhook types:
 * - Message Status: message_api_sent, message_api_delivered, message_api_read, message_api_failed
 * - Interactions: message_api_clicked (QR/CTA), message_received, workflow_response_update
 * - Account Events: account_alerts, account_update, account_review_update,
 *                   business_capability_update, phone_number_quality_update
 * - Template Events: template_performance_metrics, message_template_status_update, messages
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { upsertToSFMC } = require('./sfmc-client');
const { enqueue, initQueue } = require('./queue');
const { isProcessed, markProcessed } = require('./idempotency');
const logger = require('../utils/logger');

// Webhook type constants
const WEBHOOK_TYPES = {
    // Message Status Events
    MESSAGE_API_SENT: 'message_api_sent',
    MESSAGE_API_DELIVERED: 'message_api_delivered',
    MESSAGE_API_READ: 'message_api_read',
    MESSAGE_API_FAILED: 'message_api_failed',
    MESSAGE_API_CLICKED: 'message_api_clicked',

    // Incoming Messages
    MESSAGE_RECEIVED: 'message_received',

    // Workflow Events
    WORKFLOW_RESPONSE_UPDATE: 'workflow_response_update',

    // Account Events
    ACCOUNT_ALERTS: 'account_alerts',
    ACCOUNT_UPDATE: 'account_update',
    ACCOUNT_REVIEW_UPDATE: 'account_review_update',
    BUSINESS_CAPABILITY_UPDATE: 'business_capability_update',
    PHONE_NUMBER_QUALITY_UPDATE: 'phone_number_quality_update',

    // Template Events
    TEMPLATE_PERFORMANCE_METRICS: 'template_performance_metrics',
    MESSAGE_TEMPLATE_STATUS_UPDATE: 'message_template_status_update',
    MESSAGES: 'messages'
};

// Queue mode flag (set to true to use queue, false for immediate processing)
const USE_QUEUE = process.env.USE_QUEUE !== 'false';

// Initialize SFMC client for queue
let sfmcClientInitialized = false;

/**
 * Initialize the webhook handler (call on server startup)
 */
function initializeHandler() {
    if (!sfmcClientInitialized && USE_QUEUE) {
        const sfmcClient = require('./sfmc-client');
        initQueue(sfmcClient);
        sfmcClientInitialized = true;
        logger.info('Webhook handler initialized with queue mode: ' + USE_QUEUE);
    }
}

/**
 * Check if running in local/development mode
 */
function isLocalMode() {
    return process.env.NODE_ENV === 'development' ||
           process.env.NODE_ENV === 'local' ||
           !process.env.NODE_ENV;
}

/**
 * Verify webhook signature from Interakt
 * In local/development mode, signature verification is skipped if no signature provided
 */
function verifySignature(payload, signature, secret) {
    // In local mode, allow requests without signature for testing
    if (!signature) {
        if (isLocalMode()) {
            logger.info('No signature provided - allowed in LOCAL/DEV mode for testing');
            return true;
        }
        logger.warn('No signature provided in webhook request');
        return !secret; // Allow if no secret configured
    }

    if (!secret) {
        logger.warn('INTERAKT_SECRET not configured, skipping signature verification');
        return true;
    }

    // Handle "sha256=" prefix if present
    const providedSignature = signature.startsWith('sha256=')
        ? signature.substring(7)
        : signature;

    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(JSON.stringify(payload)).digest('hex');
    const isValid = digest === providedSignature;

    if (!isValid) {
        logger.error('Invalid webhook signature', {
            expected: digest.substring(0, 10) + '...',
            received: providedSignature.substring(0, 10) + '...'
        });
    }

    return isValid;
}

/**
 * Generate unique ID for webhooks
 */
function generateUniqueId(type, payload) {
    const timestamp = payload.timestamp || new Date().toISOString();
    const dataHash = crypto.createHash('md5')
        .update(JSON.stringify(payload.data || {}))
        .digest('hex')
        .substring(0, 12);
    return `${type}_${timestamp}_${dataHash}`;
}

/**
 * Safe JSON stringify
 */
function safeStringify(obj) {
    if (!obj) return null;
    try {
        return JSON.stringify(obj);
    } catch (e) {
        logger.warn('Failed to stringify object', { error: e.message });
        return null;
    }
}

/**
 * Safe string conversion
 */
function safeString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * Truncate string to max length
 */
function truncate(str, maxLength) {
    if (!str) return '';
    const strValue = String(str);
    return strValue.length > maxLength ? strValue.substring(0, maxLength) : strValue;
}

/**
 * Build unified Data Extension object from webhook payload
 * Maps all Interakt webhook fields to the unified SFMC DE schema
 */
function buildUnifiedDeData(payload) {
    const { version, timestamp, type, data } = payload;
    const customer = data?.customer || {};
    const message = data?.message || {};
    const event = data?.event || {};
    const metaData = message?.meta_data || {};
    const sourceData = metaData?.source_data || {};
    const messageCost = metaData?.message_cost || {};
    const buttonPayload = metaData?.button_payload?.payload || {};
    const traits = customer?.traits || {};

    // Generate unique event_id using message ID + type
    const messageId = message?.id || data?.id;
    const eventId = messageId
        ? `${messageId}_${type}_${uuidv4().substring(0, 8)}`
        : `${type}_${uuidv4()}`;

    // Build the unified DE data object
    const deData = {
        // COMMON FIELDS
        event_id: eventId,
        version: version || '1.0',
        timestamp: timestamp,
        type: type,

        // CUSTOMER FIELDS
        data_customer_id: safeString(customer?.id) || eventId, // Use event_id as fallback for PK
        data_customer_channel_phone_number: safeString(customer?.channel_phone_number),
        data_customer_phone_number: safeString(customer?.phone_number),
        data_customer_country_code: safeString(customer?.country_code),

        // CUSTOMER TRAITS
        data_customer_traits_name: safeString(traits?.name),
        data_customer_traits_amount: safeString(traits?.amount),
        data_customer_traits_total_orders_count: safeString(traits?.total_orders_count),
        data_customer_traits_last_order_id: safeString(traits?.last_order_id),
        data_customer_traits_last_order_name: safeString(traits?.last_order_name),
        data_customer_traits_total_spent: safeString(traits?.total_spent),
        data_customer_traits_whatsapp_opted_in: safeString(traits?.whatsapp_opted_in),
        data_customer_traits_created_at: safeString(traits?.created_at),
        data_customer_traits_user_id: safeString(traits?.['User Id'] || traits?.user_id),
        data_customer_traits_email: safeString(traits?.email),

        // MESSAGE FIELDS
        data_message_id: safeString(message?.id),
        data_message_chat_message_type: safeString(message?.chat_message_type),
        data_message_channel_failure_reason: safeString(message?.channel_failure_reason),
        data_message_message_status: safeString(message?.message_status),
        data_message_received_at_utc: safeString(message?.received_at_utc),
        data_message_delivered_at_utc: safeString(message?.delivered_at_utc),
        data_message_seen_at_utc: safeString(message?.seen_at_utc),
        data_message_campaign_id: safeString(message?.campaign_id),
        data_message_is_template_message: safeString(message?.is_template_message),
        data_message_raw_template: truncate(safeString(message?.raw_template), 4000),
        data_message_channel_error_code: safeString(message?.channel_error_code),
        data_message_message_content_type: safeString(message?.message_content_type),
        data_message_media_url: safeString(message?.media_url),
        data_message_message: truncate(safeString(message?.message), 4000),

        // MESSAGE META DATA
        data_message_meta_data_source: safeString(metaData?.source),
        data_message_meta_data_source_data_callback_data: safeString(sourceData?.callback_data),
        data_message_meta_data_message_cost_whatsapp_cost: safeString(messageCost?.whatsapp_cost),
        data_message_meta_data_message_cost_interakt_markup: safeString(messageCost?.interakt_markup),
        data_message_meta_data_message_cost_actual_message_cost: safeString(messageCost?.actual_message_cost),

        // CLICK DATA (Quick Reply - from meta_data)
        data_message_meta_data_click_type: safeString(metaData?.click_type),
        data_message_meta_data_button_text: safeString(metaData?.button_text),
        data_message_meta_data_button_link: safeString(metaData?.button_link),
        data_message_meta_data_click_timestamp: safeString(metaData?.click_timestamp),
        data_message_meta_data_button_payload_payload_type: safeString(buttonPayload?.type),
        data_message_meta_data_button_payload_payload_text: safeString(buttonPayload?.text),

        // CTA EVENT DATA (from data.event)
        data_event_callbackData: safeString(event?.callbackData),
        data_event_click_type: safeString(event?.click_type),
        data_event_button_text: safeString(event?.button_text),
        data_event_button_link: safeString(event?.button_link),
        data_event_click_timestamp: safeString(event?.click_timestamp),

        // WORKFLOW FIELDS
        data_workflow_resp_id: safeString(data?.id),
        data_workflow_created_at_utc: safeString(data?.created_at_utc),
        data_workflow_modified_at_utc: safeString(data?.modified_at_utc),
        data_workflow_id: safeString(data?.workflow_id),
        data_workflow_customer_id: safeString(data?.customer_id),
        data_workflow_customer_name: safeString(data?.customer_name),
        data_workflow_customer_number: safeString(data?.customer_number),
        data_workflow_triggered_from: safeString(data?.triggered_from),

        // ACCOUNT EVENT FIELDS
        data_account_phone_number: safeString(data?.phone_number),
        data_account_event: safeString(data?.event),
        data_account_review_decision: safeString(data?.decision),

        // BUSINESS CAPABILITY UPDATE FIELDS
        data_business_max_daily_conversation_per_phone: safeString(data?.max_daily_conversation_per_phone),
        data_business_max_phone_numbers_per_waba: safeString(data?.max_phone_numbers_per_waba),
        data_business_max_phone_numbers_per_business: safeString(data?.max_phone_numbers_per_business),

        // PHONE NUMBER QUALITY UPDATE FIELDS
        data_phone_quality_display_phone_number: safeString(data?.display_phone_number),
        data_phone_quality_event: safeString(data?.event),
        data_phone_quality_current_limit: safeString(data?.current_limit),

        // TEMPLATE PERFORMANCE METRICS FIELDS
        data_template_template_id: safeString(data?.templates_performance_metrics?.template_id),
        data_template_template_name: safeString(data?.templates_performance_metrics?.template_name),
        data_template_template_language: safeString(data?.templates_performance_metrics?.template_language),

        // MESSAGE TEMPLATE STATUS UPDATE FIELDS
        data_message_template_event: safeString(data?.event),
        data_message_template_id: safeString(data?.message_template_id),
        data_message_template_name: safeString(data?.message_template_name),
        data_message_template_language: safeString(data?.message_template_language),
        data_message_template_reason: safeString(data?.reason),

        // RAW PAYLOAD JSON BACKUP
        data_full_payload_json: truncate(safeStringify(payload), 50000) // LongText field
    };

    return deData;
}

/**
 * Build workflow step data for Q&A pairs
 */
function buildWorkflowStepData(payload, qaData, stepIndex) {
    const { data } = payload;
    const question = qaData?.question || {};
    const answer = qaData?.answer || {};

    // Generate unique event_id for workflow step
    const eventId = `workflow_${data?.workflow_id}_step${stepIndex}_${question?.id || uuidv4().substring(0, 8)}_${answer?.id || uuidv4().substring(0, 8)}`;

    // Build base unified data
    const deData = buildUnifiedDeData(payload);

    // Override event_id for this specific step
    deData.event_id = eventId;
    deData.data_customer_id = eventId; // Use event_id as PK for workflow steps

    // Add workflow Q&A data
    deData.data_workflow_data_0_question_id = safeString(question?.id);
    deData.data_workflow_data_0_question_step_number = safeString(question?.step_number);
    deData.data_workflow_data_0_question_message = truncate(safeString(question?.message), 500);
    deData.data_workflow_data_0_question_message_type = safeString(question?.message_type);
    deData.data_workflow_data_0_question_list_message_name = safeString(question?.list_message_name);
    deData.data_workflow_data_0_question_user_trait_name = safeString(question?.user_trait_name);
    deData.data_workflow_data_0_answer_id = safeString(answer?.id);
    deData.data_workflow_data_0_answer_message = truncate(safeString(answer?.message), 500);
    deData.data_workflow_data_0_answer_received_at_utc = safeString(answer?.received_at_utc);
    deData.data_workflow_data_0_answer_message_content_type = safeString(answer?.message_content_type);

    return deData;
}

/**
 * Process webhook and send to SFMC
 */
async function processToSFMC(dataExtensionKey, deData, useQueue = USE_QUEUE) {
    if (useQueue) {
        await enqueue(dataExtensionKey, deData);
        logger.info('Enqueued to batch queue', {
            eventId: deData.event_id,
            type: deData.type
        });
    } else {
        await upsertToSFMC(dataExtensionKey, deData);
        logger.info('Immediate upsert completed', {
            eventId: deData.event_id,
            type: deData.type
        });
    }
}

/**
 * Handle workflow response - each Q&A step is a separate record
 */
async function handleWorkflowResponse(payload, dataExtensionKey) {
    const { data } = payload;

    logger.info('========== PROCESSING WORKFLOW RESPONSE ==========');
    logger.info('Workflow ID: ' + data?.workflow_id);
    logger.info('Customer ID: ' + data?.customer_id);
    logger.info('Customer Name: ' + data?.customer_name);
    logger.info('Customer Number: ' + data?.customer_number);
    logger.info('Total Q&A Steps: ' + (data?.data?.length || 0));

    const qaArray = data?.data || [];
    let insertedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < qaArray.length; i++) {
        const qa = qaArray[i];
        const questionId = qa?.question?.id;
        const answerId = qa?.answer?.id;
        const workflowStepId = `workflow_${data?.workflow_id}_${questionId}_${answerId}`;

        logger.info(`--- Processing Step ${i + 1}/${qaArray.length} ---`);
        logger.info('Question ID: ' + questionId);
        logger.info('Answer ID: ' + answerId);
        logger.info('Idempotency Key: ' + workflowStepId);

        // Check if already processed
        if (await isProcessed(workflowStepId)) {
            logger.warn('SKIPPING: Workflow step already processed', {
                workflowId: data?.workflow_id,
                stepNumber: qa?.question?.step_number,
                workflowStepId
            });
            skippedCount++;
            continue;
        }

        // Build and process data
        const deData = buildWorkflowStepData(payload, qa, i);
        await processToSFMC(dataExtensionKey, deData);
        await markProcessed(workflowStepId, 'workflow_step');
        insertedCount++;
        logger.info('Workflow step processed successfully');
    }

    logger.info('========== WORKFLOW RESPONSE SUMMARY ==========');
    logger.info('Total Steps: ' + qaArray.length);
    logger.info('Processed: ' + insertedCount);
    logger.info('Skipped (duplicates): ' + skippedCount);
    logger.info('===============================================');
}

/**
 * Main webhook handler
 * @param {Object} payload - Webhook payload
 * @param {Object} headers - Request headers
 * @param {Object} options - Handler options
 * @param {boolean} options.skipIdempotencyCheck - Skip idempotency check (if already verified by caller)
 */
async function handleWebhook(payload, headers, options = {}) {
    const { type, data, timestamp } = payload;
    const { skipIdempotencyCheck = false } = options;

    // Initialize handler if not done
    initializeHandler();

    // Log incoming webhook
    logger.info('========== INCOMING WEBHOOK REQUEST ==========');
    logger.info('Webhook Endpoint: POST /webhook/interakt');
    logger.info('Webhook Type: ' + type);
    logger.info('Webhook Timestamp: ' + timestamp);
    logger.info('Request Headers:', {
        'x-interakt-signature': headers['x-interakt-signature'] ? '[PRESENT]' : '[NOT PRESENT]',
        'content-type': headers['content-type'],
        'x-request-id': headers['x-request-id']
    });
    logger.info('Full Request Body:', JSON.stringify(payload, null, 2));
    logger.info('===============================================');

    // 1. Verify signature
    const signature = headers['x-interakt-signature'];
    const secret = process.env.LOCAL_INTERAKT_SECRET || process.env.INTERAKT_SECRET;
    if (!verifySignature(payload, signature, secret)) {
        logger.error('WEBHOOK ERROR: Signature verification failed');
        throw new Error('Invalid signature');
    }
    logger.info('Signature verification: PASSED');

    // 2. Get unique ID for idempotency
    let uniqueId = data?.message?.id || data?.id;
    if (!uniqueId) {
        uniqueId = generateUniqueId(type, payload);
        logger.info('Generated unique ID', { type, uniqueId });
    }
    const fullUniqueId = `${uniqueId}_${type}`;
    logger.info('Idempotency Key: ' + fullUniqueId);

    // 3. Check if already processed (skip if caller already verified)
    if (!skipIdempotencyCheck && await isProcessed(fullUniqueId)) {
        logger.warn('DUPLICATE WEBHOOK - Already processed', { fullUniqueId, type });
        const error = new Error('Already processed');
        error.code = 'DUPLICATE_MESSAGE';
        throw error;
    }

    if (skipIdempotencyCheck) {
        logger.info('Idempotency check skipped (already verified by caller)', { type, uniqueId: fullUniqueId });
    } else {
        logger.info('Processing webhook - Not a duplicate', { type, uniqueId: fullUniqueId });
    }

    // 4. Get Data Extension key from environment
    const dataExtensionKey = process.env.SFMC_DE_CUSTOMER_KEY;
    if (!dataExtensionKey) {
        logger.error('CONFIGURATION ERROR: SFMC_DE_CUSTOMER_KEY not set in .env');
        throw new Error('SFMC_DE_CUSTOMER_KEY not configured');
    }
    logger.info('Target Data Extension Key: ' + dataExtensionKey);

    // 5. Process based on webhook type
    try {
        if (type === WEBHOOK_TYPES.WORKFLOW_RESPONSE_UPDATE) {
            // Workflow responses - each Q&A is a separate record
            await handleWorkflowResponse(payload, dataExtensionKey);
        } else {
            // All other webhook types - single unified record
            const deData = buildUnifiedDeData(payload);

            // Log mapped data
            logger.info('========== MAPPED DATA EXTENSION OBJECT ==========');
            logger.info('Event ID: ' + deData.event_id);
            logger.info('Webhook Type: ' + deData.type);
            logger.info('Data Extension Key: ' + dataExtensionKey);

            // Count non-empty fields
            const nonEmptyFields = Object.entries(deData).filter(([, value]) =>
                value !== null && value !== undefined && value !== ''
            );
            logger.info('Total fields with values: ' + nonEmptyFields.length);
            logger.info('Fields being sent:', JSON.stringify(
                nonEmptyFields.reduce((acc, [key, value]) => {
                    acc[key] = value;
                    return acc;
                }, {}),
                null, 2
            ));
            logger.info('==================================================');

            await processToSFMC(dataExtensionKey, deData);
        }

        // 6. Mark as processed
        await markProcessed(fullUniqueId, type);
        logger.info('Webhook processing COMPLETED', { fullUniqueId, type });

    } catch (error) {
        logger.error('========== WEBHOOK PROCESSING ERROR ==========');
        logger.error('Error Type: ' + error.name);
        logger.error('Error Message: ' + error.message);
        logger.error('Error Stack: ' + error.stack);
        logger.error('Webhook Type: ' + type);
        logger.error('Unique ID: ' + fullUniqueId);
        logger.error('==============================================');
        throw error;
    }
}

module.exports = {
    handleWebhook,
    verifySignature,
    buildUnifiedDeData,
    initializeHandler,
    WEBHOOK_TYPES
};
