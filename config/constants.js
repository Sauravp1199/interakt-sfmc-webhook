/**
 * Application constants
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
    PHONE_NUMBER_QUALITY_UPDATE: 'phone_number_quality_update',

    // Template Events
    MESSAGE_TEMPLATE_STATUS_UPDATE: 'message_template_status_update',
    TEMPLATE_PERFORMANCE_METRICS: 'template_performance_metrics',

    // Generic Messages Event
    MESSAGES: 'messages'
};

const MESSAGE_STATUS = {
    SENT: 'Sent',
    DELIVERED: 'Delivered',
    READ: 'Read',
    FAILED: 'Failed'
};

const CLICK_TYPES = {
    QUICK_REPLY: 'QR',
    CALL_TO_ACTION: 'CTA'
};

module.exports = {
    WEBHOOK_TYPES,
    MESSAGE_STATUS,
    CLICK_TYPES
};