# Salesforce Marketing Cloud Data Extension Schemas

This document contains all the Data Extension schemas required for the Interakt Webhook Integration. Create these Data Extensions in SFMC and update the `.env` file with their Customer Keys.

**SOAP API Endpoint:** `https://mc72wv4hqz48m1slvbncl40nnlv4.soap.marketingcloudapis.com/Service.asmx`

---

## MASTER DATA EXTENSION - DE_WEBHOOK_MASTER

**Purpose:** Single unified Data Extension to store ALL webhook events from Interakt with flattened field structure.

**Webhook Types Supported:**
- `message_api_sent`
- `message_api_delivered`
- `message_api_read`
- `message_api_failed`
- `message_api_clicked`
- `message_received`
- `workflow_response_update`
- `account_alerts`
- `account_update`
- `account_review_update`
- `business_capability_update`
- `phone_number_quality_update`
- `template_performance_metrics`
- `message_template_status_update`

### Schema (95 Fields)

| SFMC Field Name | SFMC Type | Length | Primary Key | Required | Example Value |
|-----------------|-----------|--------|-------------|----------|---------------|
| event_id | Text | 36 | Yes | Yes | `evt_{{uuid}}` *(generated)* |
| version | Text | 10 | No | No | `1.0` |
| timestamp | Date | — | No | No | `2024-01-15T10:30:00.000Z` |
| type | Text | 80 | No | Yes | `message_api_sent` |
| **Customer Fields** |||||
| data_customer_id | Text | 100 | No | No | `52918eb3-bd00-4331-a51d-c4dcffee48d6` |
| data_customer_channel_phone_number | Text | 20 | No | No | `917003705584` |
| data_customer_phone_number | Text | 20 | No | No | `7003705584` |
| data_customer_country_code | Text | 10 | No | No | `+91` |
| data_customer_traits_name | Text | 200 | No | No | `SKGG` |
| data_customer_traits_amount | Number | — | No | No | `7000` |
| data_customer_traits_total_orders_count | Number | — | No | No | `0` |
| data_customer_traits_last_order_id | Text | 100 | No | No | `null` |
| data_customer_traits_last_order_name | Text | 200 | No | No | `null` |
| data_customer_traits_total_spent | Text | 50 | No | No | `0.00` |
| data_customer_traits_whatsapp_opted_in | Boolean | — | No | No | `false` |
| data_customer_traits_created_at | Text | 50 | No | No | `2021-06-23T06:46:11` |
| data_customer_traits_user_id | Text | 50 | No | No | `111` |
| data_customer_traits_email | EmailAddress | 254 | No | No | `xyz@gmail.com` |
| **Message Fields** |||||
| data_message_id | Text | 100 | No | No | `msg_sent_{{uuid}}` |
| data_message_chat_message_type | Text | 50 | No | No | `PublicApiMessage` |
| data_message_channel_failure_reason | Text | 500 | No | No | `Recipient is not a valid WhatsApp user` |
| data_message_message_status | Text | 50 | No | No | `Sent / Delivered / Read / Failed` |
| data_message_received_at_utc | Text | 50 | No | No | `2024-01-15T10:30:00.000Z` |
| data_message_delivered_at_utc | Text | 50 | No | No | `2024-01-15T10:30:05.000Z` |
| data_message_seen_at_utc | Text | 50 | No | No | `2024-01-15T10:31:00.000Z` |
| data_message_campaign_id | Text | 100 | No | No | `null` |
| data_message_is_template_message | Boolean | — | No | No | `true` |
| data_message_raw_template | Text | 4000 | No | No | `{"id":"...", "name":"..."}` |
| data_message_channel_error_code | Text | 50 | No | No | `1013` |
| data_message_message_content_type | Text | 50 | No | No | `Template / Text` |
| data_message_media_url | Text | 1000 | No | No | `null` |
| data_message_message | Text | 4000 | No | No | `[{"type":"body", "parameters":[...]}]` |
| **Message Meta Data Fields** |||||
| data_message_meta_data_source | Text | 50 | No | No | `PublicInterakt` |
| data_message_meta_data_source_data_callback_data | Text | 500 | No | No | `some text here123` |
| data_message_meta_data_message_cost_whatsapp_cost | Text | 50 | No | No | `0.03` |
| data_message_meta_data_message_cost_interakt_markup | Text | 50 | No | No | `0.3` |
| data_message_meta_data_message_cost_actual_message_cost | Text | 50 | No | No | `0.33` |
| data_message_meta_data_click_type | Text | 10 | No | No | `QR` |
| data_message_meta_data_button_text | Text | 200 | No | No | `Fill Feedback Form` |
| data_message_meta_data_button_link | Text | 1000 | No | No | `""` |
| data_message_meta_data_click_timestamp | Text | 50 | No | No | `2024-01-15T10:32:00.000Z` |
| data_message_meta_data_button_payload_payload_type | Text | 50 | No | No | `QUICK_REPLY` |
| data_message_meta_data_button_payload_payload_text | Text | 200 | No | No | `Fill Feedback Form` |
| **CTA Event Fields** |||||
| data_event_callbackData | Text | 500 | No | No | `some text here123` |
| data_event_click_type | Text | 10 | No | No | `CTA` |
| data_event_button_text | Text | 200 | No | No | `Track Order` |
| data_event_button_link | Text | 1000 | No | No | `https://www.interakt.shop/` |
| data_event_click_timestamp | Text | 50 | No | No | `2024-01-15T10:32:00.000Z` |
| **Workflow Fields** |||||
| data_workflow_resp_id | Text | 100 | No | No | `workflow_resp_{{uuid}}` |
| data_workflow_created_at_utc | Text | 50 | No | No | `2023-08-25T04:35:27.341000` |
| data_workflow_modified_at_utc | Text | 50 | No | No | `2024-01-15T10:30:00.000Z` |
| data_workflow_id | Text | 100 | No | No | `d2a02d35-6cba-4873-a1fd-060de0342cdd` |
| data_workflow_customer_id | Text | 100 | No | No | `13212830-0a1b-473f-b05a-ddd6872d367b` |
| data_workflow_customer_name | Text | 200 | No | No | `Customer Name` |
| data_workflow_customer_number | Text | 20 | No | No | `+919999999999` |
| data_workflow_triggered_from | Text | 200 | No | No | `FAQ Message` |
| data_workflow_data_0_question_id | Text | 100 | No | No | `95a68fb7-0d52-4597-a5ef-0494f0c49509` |
| data_workflow_data_0_question_step_number | Number | — | No | No | `1` |
| data_workflow_data_0_question_message | Text | 500 | No | No | `What is your company size?` |
| data_workflow_data_0_question_message_type | Text | 50 | No | No | `List Message` |
| data_workflow_data_0_question_list_message_name | Text | 100 | No | No | `interaktive_list` |
| data_workflow_data_0_question_user_trait_name | Text | 100 | No | No | `company_size` |
| data_workflow_data_0_answer_id | Text | 100 | No | No | `f37b61e7-065e-413f-bc36-bf0ba183e605` |
| data_workflow_data_0_answer_message | Text | 500 | No | No | `500+` |
| data_workflow_data_0_answer_received_at_utc | Text | 50 | No | No | `2023-08-25T04:35:36.776000` |
| data_workflow_data_0_answer_message_content_type | Text | 50 | No | No | `InteractiveListReply` |
| data_workflow_data_1_question_id | Text | 100 | No | No | `e3375b79-86ea-454d-a9eb-9b4154020f56` |
| data_workflow_data_1_question_step_number | Number | — | No | No | `2` |
| data_workflow_data_1_question_message | Text | 500 | No | No | `Great, would you like to continue?` |
| data_workflow_data_1_question_message_type | Text | 50 | No | No | `Normal Message` |
| data_workflow_data_1_question_user_trait_name | Text | 100 | No | No | `null` |
| data_workflow_data_1_answer_id | Text | 100 | No | No | `d9afabb4-1411-4010-b21b-4f51c311850b` |
| data_workflow_data_1_answer_message | Text | 500 | No | No | `Yes` |
| data_workflow_data_1_answer_received_at_utc | Text | 50 | No | No | `2023-08-25T04:35:57.611000` |
| data_workflow_data_1_answer_message_content_type | Text | 50 | No | No | `Text` |
| **Account Event Fields** |||||
| data_account_phone_number | Text | 20 | No | No | `16505551111` |
| data_account_event | Text | 100 | No | No | `VERIFIED_ACCOUNT` |
| data_account_review_decision | Text | 50 | No | No | `APPROVED` |
| **Business Capability Fields** |||||
| data_business_max_daily_conversation_per_phone | Number | — | No | No | `123` |
| data_business_max_phone_numbers_per_waba | Number | — | No | No | `23` |
| data_business_max_phone_numbers_per_business | Number | — | No | No | `120` |
| **Phone Quality Fields** |||||
| data_phone_quality_display_phone_number | Text | 20 | No | No | `16505551111` |
| data_phone_quality_event | Text | 50 | No | No | `FLAGGED` |
| data_phone_quality_current_limit | Text | 50 | No | No | `TIER_10K` |
| **Template Performance Fields** |||||
| data_template_template_id | Text | 100 | No | No | `tpl_{{uuid}}` |
| data_template_template_name | Text | 200 | No | No | `order_confirmation_template` |
| data_template_template_language | Text | 20 | No | No | `en` |
| **Message Template Status Fields** |||||
| data_message_template_event | Text | 50 | No | No | `APPROVED` |
| data_message_template_id | Number | — | No | No | `12345678` |
| data_message_template_name | Text | 200 | No | No | `my_message_template` |
| data_message_template_language | Text | 20 | No | No | `pt-BR` |
| data_message_template_reason | Text | 500 | No | No | `null` |
| **Raw Payload** |||||
| data_full_payload_json | Text | 4000 | No | No | `{...complete raw JSON...}` |

---

### Environment Variables Configuration (Master DE)

```env
# Master Data Extension for all webhook events
DE_WEBHOOK_MASTER=YOUR_DE_WEBHOOK_MASTER_CUSTOMER_KEY
```

---

---

# LEGACY: Individual Data Extension Schemas (Deprecated)

The schemas below are for reference only. The recommended approach is to use the single **DE_WEBHOOK_MASTER** above.

---

## 1. DE_MESSAGES - Message Status Events

**Purpose:** Stores all message status events (sent, delivered, read, failed)

**Webhook Types:** `message_api_sent`, `message_api_delivered`, `message_api_read`, `message_api_failed`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| MessageId | Text | 100 | Yes | Yes | Unique message identifier |
| CustomerId | Text | 100 | No | No | Customer identifier |
| PhoneNumber | Text | 20 | No | No | Customer phone number (channel_phone_number) |
| CustomerName | Text | 255 | No | No | Customer name from traits |
| MessageStatus | Text | 20 | No | No | Status: Sent, Delivered, Read, Failed |
| ReceivedAt | Text | 50 | No | No | Message received timestamp (received_at_utc) |
| DeliveredAt | Text | 50 | No | No | Message delivered timestamp (delivered_at_utc) |
| SeenAt | Text | 50 | No | No | Message seen timestamp (seen_at_utc) |
| CampaignId | Text | 100 | No | No | Campaign identifier (campaign_id) |
| TemplateName | Text | 255 | No | No | Template name extracted from raw_template |
| CallbackData | Text | 500 | No | No | Callback data from meta_data.source_data |
| MessageCost | Text | 20 | No | No | Actual message cost (actual_message_cost) |
| FailureReason | Text | 500 | No | No | Failure reason (channel_failure_reason) |
| ErrorCode | Text | 20 | No | No | Error code (channel_error_code) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 2. DE_BUTTON_CLICKS - Button Click Events

**Purpose:** Stores Quick Reply (QR) and Call-to-Action (CTA) button clicks

**Webhook Types:** `message_api_clicked`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| MessageId | Text | 100 | Yes | Yes | Unique message identifier |
| CustomerId | Text | 100 | No | No | Customer identifier |
| PhoneNumber | Text | 20 | No | No | Customer phone number |
| CustomerName | Text | 255 | No | No | Customer name from traits |
| ClickType | Text | 10 | No | No | Click type: QR or CTA |
| ButtonText | Text | 255 | No | No | Button text that was clicked |
| ButtonLink | Text | 500 | No | No | Button URL (for CTA buttons) |
| ClickedAt | Text | 50 | No | No | Click timestamp (click_timestamp) |
| CallbackData | Text | 500 | No | No | Callback data |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 3. DE_INCOMING_MESSAGES - Customer Messages

**Purpose:** Stores incoming messages from customers

**Webhook Types:** `message_received`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| MessageId | Text | 100 | Yes | Yes | Unique message identifier |
| CustomerId | Text | 100 | No | No | Customer identifier |
| PhoneNumber | Text | 20 | No | No | Customer phone number |
| CustomerName | Text | 255 | No | No | Customer name from traits |
| MessageType | Text | 50 | No | No | Message content type (Text, Image, etc.) |
| MessageText | Text | 4000 | No | No | Message content |
| MediaUrl | Text | 500 | No | No | Media URL if present |
| ReceivedAt | Text | 50 | No | No | Message received timestamp |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 4. DE_WORKFLOW_RESPONSES - Workflow Q&A Responses

**Purpose:** Stores workflow question and answer pairs

**Webhook Types:** `workflow_response_update`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| WorkflowId | Text | 100 | Yes | Yes | Workflow identifier (workflow_id) |
| CustomerId | Text | 100 | Yes | Yes | Customer identifier (customer_id) |
| StepNumber | Text | 10 | Yes | Yes | Step number in workflow |
| PhoneNumber | Text | 20 | No | No | Customer phone number (customer_number) |
| CustomerName | Text | 255 | No | No | Customer name (customer_name) |
| Question | Text | 1000 | No | No | Question message |
| Answer | Text | 1000 | No | No | Customer answer |
| TraitName | Text | 100 | No | No | User trait name (user_trait_name) |
| AnsweredAt | Text | 50 | No | No | Answer timestamp (received_at_utc) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

**Note:** Primary Key is composite: WorkflowId + CustomerId + StepNumber

---

## 5. DE_ACCOUNT_ALERTS - Account Alerts

**Purpose:** Stores account alert events

**Webhook Types:** `account_alerts`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (account_alerts) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 6. DE_ACCOUNT_UPDATE - Account Updates

**Purpose:** Stores account update events (e.g., VERIFIED_ACCOUNT)

**Webhook Types:** `account_update`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (account_update) |
| phone_number | Text | 20 | No | No | Phone number being updated |
| event | Text | 50 | No | No | Event status (VERIFIED_ACCOUNT, etc.) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 7. DE_ACCOUNT_REVIEW_UPDATE - Account Review Updates

**Purpose:** Stores account review decision events

**Webhook Types:** `account_review_update`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (account_review_update) |
| decision | Text | 50 | No | No | Review decision (APPROVED, REJECTED) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 8. DE_BUSINESS_CAPABILITY_UPDATE - Business Capability Updates

**Purpose:** Stores business capability/limit updates

**Webhook Types:** `business_capability_update`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (business_capability_update) |
| max_daily_conversation_per_phone | Text | 20 | No | No | Max daily conversations per phone |
| max_phone_numbers_per_waba | Text | 20 | No | No | Max phone numbers per WABA |
| max_phone_numbers_per_business | Text | 20 | No | No | Max phone numbers per business |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 9. DE_PHONE_NUMBER_QUALITY_UPDATE - Phone Quality Updates

**Purpose:** Stores phone number quality status updates

**Webhook Types:** `phone_number_quality_update`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (phone_number_quality_update) |
| display_phone_number | Text | 20 | No | No | Phone number being flagged |
| event | Text | 50 | No | No | Quality event (FLAGGED, GREEN, etc.) |
| current_limit | Text | 20 | No | No | Current messaging limit tier (TIER_10K, etc.) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 10. DE_TEMPLATE_PERFORMANCE_METRICS - Template Performance

**Purpose:** Stores template performance metrics

**Webhook Types:** `template_performance_metrics`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (template_performance_metrics) |
| template_id | Text | 100 | No | No | Template identifier |
| template_name | Text | 255 | No | No | Template name |
| template_language | Text | 10 | No | No | Template language code |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## 11. DE_MESSAGE_TEMPLATE_STATUS_UPDATE - Template Status Updates

**Purpose:** Stores template approval/rejection status updates

**Webhook Types:** `message_template_status_update`

| Field Name | Data Type | Length | Primary Key | Required | Description |
|------------|-----------|--------|-------------|----------|-------------|
| timestamp | Text | 50 | Yes | Yes | Event timestamp |
| version | Text | 10 | No | No | API version |
| type | Text | 50 | No | No | Event type (message_template_status_update) |
| event | Text | 50 | No | No | Status event (APPROVED, REJECTED, etc.) |
| message_template_id | Text | 50 | No | No | Template ID |
| message_template_name | Text | 255 | No | No | Template name |
| message_template_language | Text | 10 | No | No | Template language code |
| reason | Text | 500 | No | No | Rejection reason (if applicable) |
| ProcessedAt | Text | 50 | No | No | Webhook processing timestamp |

---

## Environment Variables Configuration

After creating all Data Extensions, update your `.env` file with the Customer Keys:

```env
# Message Status Events (sent, delivered, read, failed)
DE_MESSAGES=YOUR_DE_MESSAGES_CUSTOMER_KEY

# Button Click Events (Quick Reply & CTA)
DE_BUTTON_CLICKS=YOUR_DE_BUTTON_CLICKS_CUSTOMER_KEY

# Incoming Messages from Customers
DE_INCOMING_MESSAGES=YOUR_DE_INCOMING_MESSAGES_CUSTOMER_KEY

# Workflow Responses
DE_WORKFLOW_RESPONSES=YOUR_DE_WORKFLOW_RESPONSES_CUSTOMER_KEY

# Account Events
DE_ACCOUNT_ALERTS=YOUR_DE_ACCOUNT_ALERTS_CUSTOMER_KEY
DE_ACCOUNT_UPDATE=YOUR_DE_ACCOUNT_UPDATE_CUSTOMER_KEY
DE_ACCOUNT_REVIEW_UPDATE=YOUR_DE_ACCOUNT_REVIEW_UPDATE_CUSTOMER_KEY
DE_BUSINESS_CAPABILITY_UPDATE=YOUR_DE_BUSINESS_CAPABILITY_UPDATE_CUSTOMER_KEY
DE_PHONE_NUMBER_QUALITY_UPDATE=YOUR_DE_PHONE_NUMBER_QUALITY_UPDATE_CUSTOMER_KEY

# Template Events
DE_TEMPLATE_PERFORMANCE_METRICS=YOUR_DE_TEMPLATE_PERFORMANCE_METRICS_CUSTOMER_KEY
DE_MESSAGE_TEMPLATE_STATUS_UPDATE=YOUR_DE_MESSAGE_TEMPLATE_STATUS_UPDATE_CUSTOMER_KEY
```

---

## Quick Reference: Webhook Type to Data Extension Mapping

| Webhook Type | Data Extension |
|--------------|----------------|
| message_api_sent | DE_MESSAGES |
| message_api_delivered | DE_MESSAGES |
| message_api_read | DE_MESSAGES |
| message_api_failed | DE_MESSAGES |
| message_api_clicked | DE_BUTTON_CLICKS |
| message_received | DE_INCOMING_MESSAGES |
| workflow_response_update | DE_WORKFLOW_RESPONSES |
| account_alerts | DE_ACCOUNT_ALERTS |
| account_update | DE_ACCOUNT_UPDATE |
| account_review_update | DE_ACCOUNT_REVIEW_UPDATE |
| business_capability_update | DE_BUSINESS_CAPABILITY_UPDATE |
| phone_number_quality_update | DE_PHONE_NUMBER_QUALITY_UPDATE |
| template_performance_metrics | DE_TEMPLATE_PERFORMANCE_METRICS |
| message_template_status_update | DE_MESSAGE_TEMPLATE_STATUS_UPDATE |
| messages | DE_MESSAGES (generic event) |

---

## Notes

1. **Field Names:** All field names match exactly with the original Interakt webhook payload field names as requested.

2. **Data Types:** All fields use Text data type for maximum compatibility. Dates are stored as ISO strings.

3. **Primary Keys:** Each DE has appropriate primary key(s) to prevent duplicates.

4. **ProcessedAt:** Added to all DEs to track when the webhook was processed.

5. **DE_MESSAGES for generic "messages":** The generic `messages` webhook type is stored in DE_MESSAGES with minimal data.
