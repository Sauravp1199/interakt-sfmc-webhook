# Application Flow Documentation

## Overview
This webhook application receives events from Interakt (WhatsApp messaging platform) and streams them to Salesforce Marketing Cloud (SFMC) Data Extensions in real-time.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Interakt Webhooks          Application              SFMC  │
│  (WhatsApp Events)          (Node.js)            (Data Ext) │
│                                                             │
│  • message_api_sent  ──────────────────────→  Data Stream  │
│  • message_api_delivered    ┌──────────────┐               │
│  • message_api_read         │              │               │
│  • message_api_failed       │  Webhook     │               │
│  • message_api_clicked      │  Handler     │  Batch        │
│  • message_received         │              │  Processing   │
│  • workflow_response        └──────────────┘  (1000/batch) │
│  • account events               ↓                          │
│                            Queue System                     │
└─────────────────────────────────────────────────────────────┘
```

## Request Flow

### 1. Webhook Reception
- **Endpoint**: `POST /webhook/interakt`
- **Port**: 1112 (configurable)
- **Signature Verification**: HMAC-SHA256 (Interakt secret key)
- **Headers Required**:
  - `Content-Type: application/json`
  - `x-interakt-signature: sha256=<signature>`

### 2. Webhook Processing

```
Incoming Webhook
    ↓
[Signature Verification]
    ↓
✓ Valid → Continue
✗ Invalid → Return 400 Error
    ↓
[Build Unified Data Structure]
    ├─ Extract customer info
    ├─ Extract message info
    ├─ Extract metadata
    └─ Flatten nested structure
    ↓
[Generate Unique event_id]
    └─ Format: {message_id}_{webhook_type}_{random_8_chars}
    ↓
[Queue for Batch Processing]
    └─ Add to in-memory queue
    ↓
[Return 200 OK to Interakt]
```

### 3. Batch Processing

The application uses an intelligent batching system:

```
Queue Management:
├─ Batch Size: 1000 records max
├─ Smart Timeout: 3 seconds (if 2+ records waiting)
├─ Fallback Timeout: 30 seconds
└─ Auto-flush when batch size reached

Batch Flow:
├─ Dequeue records from queue
├─ Validate payload (size, format)
├─ Split into 1MB chunks if needed
├─ Rate limiting (2500 req/min, 50 concurrent)
├─ Send to SFMC
├─ Retry on failure (max 5 retries with exponential backoff)
└─ Log results
```

### 4. SFMC Data Extension Insertion

```
Record Format:
{
  "keys": {
    "event_id": "unique-id-for-deduplication"
  },
  "values": {
    "event_id": "unique-id",
    "version": "1.0",
    "timestamp": "2026-02-03T10:00:00Z",
    "type": "message_api_delivered",

    // Customer fields
    "data_customer_id": "uuid",
    "data_customer_channel_phone_number": "whatsapp:+1234567890",
    "data_customer_traits_name": "John Doe",
    "data_customer_traits_email": "john@example.com",

    // Message fields
    "data_message_id": "uuid",
    "data_message_status": "Delivered",
    "data_message_timestamp": "2026-02-03T10:00:00Z",

    // ... 90+ additional flattened fields
  }
}
```

**API Endpoint**: `POST /hub/v1/dataevents/key:{DE_KEY}/rowset`

**Behavior**:
- If `event_id` exists: UPDATE record
- If `event_id` is new: INSERT record
- All records have unique `event_id` to prevent duplicates within SFMC

## Supported Webhook Types

### Message Events (15 types)
- `message_api_sent` - Message sent successfully
- `message_api_delivered` - Message delivered to customer
- `message_api_read` - Customer read the message
- `message_api_failed` - Message delivery failed
- `message_api_clicked` - Customer clicked button/CTA
- `message_received` - Customer sent message
- `workflow_response_update` - Workflow Q&A responses

### Account Events
- `account_alerts` - Account notifications
- `account_update` - Account information changed
- `account_review_update` - Account review status changed
- `business_capability_update` - Business capabilities updated
- `phone_number_quality_update` - Phone number quality changed

### Template Events
- `template_performance_metrics` - Template metrics updated
- `message_template_status_update` - Template status changed

## Configuration

### Environment Variables
```bash
# Server
PORT=1112
NODE_ENV=development

# SFMC Authentication
SFMC_AUTH_BASE_URL=https://your-instance.auth.marketingcloudapis.com
SFMC_REST_BASE_URL=https://your-instance.rest.marketingcloudapis.com
SFMC_CLIENT_ID=your_client_id
SFMC_CLIENT_SECRET=your_client_secret
SFMC_ACCOUNT_ID=your_account_id

# Data Extensions
SFMC_DE_CUSTOMER_KEY=your-de-key

# Webhook Security
LOCAL_INTERAKT_SECRET=dev_secret_key
PROD_INTERAKT_SECRET=prod_secret_key

# Logging
ENABLE_FILE_LOGGING=true
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=2500
RATE_LIMIT_MAX_CONCURRENT=50
```

## Database Schema (SFMC Data Extension)

**Primary Key**: `event_id` (Text, 255, unique)

**Core Fields**:
- `version` - Webhook version
- `timestamp` - Event timestamp
- `type` - Webhook event type

**Customer Fields** (30+ fields):
- `data_customer_id` - Customer UUID
- `data_customer_channel_phone_number` - WhatsApp number
- `data_customer_traits_*` - Customer attributes

**Message Fields** (40+ fields):
- `data_message_id` - Message UUID
- `data_message_status` - Sent/Delivered/Read/Failed
- `data_message_*` - Message metadata

**Metadata Fields** (20+ fields):
- `data_message_meta_data_*` - Additional context
- `data_full_payload_json` - Complete webhook payload

## Error Handling

### Validation Errors (400)
- Invalid signature
- Missing required fields
- Invalid JSON payload

### Server Errors (500)
- SFMC authentication failure
- SFMC API errors
- Rate limiting exceeded
- Database insertion failure

### Retry Logic
- Automatic retry on network errors
- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Maximum 5 retries
- Failed records moved to DLQ (Dead Letter Queue)

## Logging

### Log Files (when ENABLE_FILE_LOGGING=true)

1. **logs/combined.log**
   - All logs (INFO, WARN, ERROR, DEBUG)
   - Best for general troubleshooting

2. **logs/debug-requests.log**
   - Full request/response bodies
   - Useful for API debugging
   - Shows actual payloads sent to SFMC

3. **logs/error.log**
   - Only error messages
   - Production monitoring

### Log Format
```
[2026-02-03T10:00:00.000Z] [INFO] Message processed successfully
[2026-02-03T10:00:01.000Z] [ERROR] SFMC API Error: Invalid signature
```

## Performance Characteristics

| Metric | Value |
|--------|-------|
| **Webhook Latency** | <100ms (sign + validate) |
| **Batch Size** | 1,000 records max |
| **Batch Processing Time** | 2-5 seconds (typical) |
| **Rate Limit** | 2,500 requests/minute |
| **Concurrent Requests** | 50 max |
| **Queue Capacity** | Limited by available RAM |
| **Token Refresh** | Every 19 minutes |
| **Connection Pooling** | HTTP Keep-Alive enabled |

## Deployment Checklist

- [ ] Set all required environment variables
- [ ] Configure SFMC credentials and DE keys
- [ ] Set webhook signature secrets (different for dev/prod)
- [ ] Enable file logging in production
- [ ] Configure log rotation (10MB files)
- [ ] Set NODE_ENV=production
- [ ] Set LOG_LEVEL=info (or warn)
- [ ] Test with Postman collection
- [ ] Monitor logs during first week
- [ ] Set up alerting for errors

## Troubleshooting

### Webhook Not Received
1. Verify webhook URL is correct in Interakt console
2. Check PORT is not blocked by firewall
3. Verify signature secret matches

### Records Not Appearing in SFMC
1. Check SFMC authentication in logs
2. Verify Data Extension key is correct
3. Check field mapping matches DE schema
4. Review SFMC API errors in debug-requests.log

### High Error Rate
1. Check SFMC rate limiting
2. Verify network connectivity
3. Review SFMC API status
4. Check batch size isn't too large

## Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "healthy",
  "token": {
    "hasToken": true,
    "isValid": true,
    "remainingSeconds": 1050
  },
  "rateLimiter": {
    "requestsPerMinute": 2500,
    "usedRequests": 42,
    "concurrentRequests": 2,
    "maxConcurrent": 50
  }
}
```

## Admin Endpoints

**Clear Logs**: `POST /admin/logs/clear`
- Clears all log files

**Get Logs**: `GET /admin/logs/:type`
- Types: `combined`, `error`, `debug`, `debug-requests`

**Health Status**: `GET /admin/status`
- Returns detailed system status
