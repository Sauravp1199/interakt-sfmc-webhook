# Interakt SFMC Webhook Integration - Complete Codebase Overview

**Version:** 2.0.0
**Purpose:** Production-ready TypeScript webhook service that integrates Interakt (WhatsApp Business Platform) with Salesforce Marketing Cloud (SFMC)
**Type:** REST API with Redis-backed queue system

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [System Components](#system-components)
4. [Data Flow](#data-flow)
5. [Queue System](#queue-system)
6. [API Endpoints](#api-endpoints)
7. [Project Structure](#project-structure)
8. [Key Files & Modules](#key-files--modules)
9. [Configuration](#configuration)
10. [Webhook Event Types](#webhook-event-types)
11. [SFMC Integration](#sfmc-integration)
12. [Error Handling & Retries](#error-handling--retries)
13. [Deployment](#deployment)

---

## Executive Summary

This service acts as a **middleware bridge** between Interakt (a WhatsApp business messaging platform) and Salesforce Marketing Cloud. It:

- **Receives webhooks** from Interakt reporting message events (sent, delivered, read, failed, clicked, received, etc.)
- **Receives direct API events** from your own services via POST `/event`
- **Queues messages** in Redis to handle high volumes and ensure reliability
- **Batches data** for efficient SFMC SOAP API calls
- **Stores data** in SFMC Data Extensions for use in marketing campaigns
- **Implements retry logic** for failed requests
- **Provides monitoring** via health checks and queue statistics

**Key Technologies:**
- **Runtime:** Node.js 18+
- **Language:** TypeScript (compiled to JavaScript)
- **Database:** Redis (for queueing only - no persistent storage)
- **Message Queue:** Redis Streams / Lists
- **API Protocol:** SOAP for SFMC communication
- **Authentication:** OAuth 2.0 for SFMC

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SOURCES                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐         ┌──────────────┐      ┌─────────────┐    │
│  │   Interakt   │         │ Your Service │      │ Postman     │    │
│  │  (WhatsApp)  │         │   (API)      │      │ (Testing)   │    │
│  └──────┬───────┘         └──────┬───────┘      └──────┬──────┘    │
│         │                        │                     │             │
│         │ POST /webhook/interakt │ POST /event        │             │
└─────────┼────────────────────────┼─────────────────────┼─────────────┘
          │                        │                     │
          v                        v                     v
┌─────────────────────────────────────────────────────────────────────┐
│              EXPRESS.JS WEBHOOK SERVER (PORT 3000)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Route: /webhook/interakt         Route: /event                     │
│  ├─ Signature Verification        ├─ Basic Validation              │
│  ├─ Payload Validation             ├─ Event Payload Mapping        │
│  ├─ Idempotency Check             └─ Direct SFMC Insert (or Queue) │
│  └─ Queue Enqueue / Direct Process                                 │
│                                                                       │
│                      [REQUEST ROUTING LAYER]                        │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              REDIS QUEUE SERVICE                             │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │                                                              │  │
│  │  Main Queue       ← Enqueued messages from webhooks         │  │
│  │  Retry DLQ        ← Failed messages for retry               │  │
│  │  Bad Payload DLQ  ← Messages that don't validate            │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
          │                        │                     │
          │                        v                     │
          │              ┌─────────────────────┐        │
          │              │ BATCH WORKER        │        │
          │              │ (processes queue)   │        │
          │              └─────────┬───────────┘        │
          │                        │                    │
          ├────────────────────────┤                    │
          │                        │                    │
          v                        v                    v
┌─────────────────────────────────────────────────────────────────────┐
│                    SFMC SOAP API SERVICE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. Get OAuth Token (cached, refreshed before expiry)              │
│  2. Build SOAP XML Envelope (batched data)                         │
│  3. Execute Create/Update Request via SOAP                         │
│  4. Parse SOAP Response (status, error codes)                      │
│  5. Retry on failure (exponential backoff)                         │
│                                                                       │
└────────────────────────┬──────────────────────────────────────────────┘
                         │
                         v
          ┌──────────────────────────────────┐
          │ SALESFORCE MARKETING CLOUD       │
          │                                  │
          │ Data Extensions:                 │
          │ ├─ Master Webhook (95 fields)   │
          │ ├─ Event DE                     │
          │ ├─ Message Status DE            │
          │ ├─ Button Clicks DE             │
          │ └─ Custom DEs (as needed)       │
          │                                  │
          └──────────────────────────────────┘
```

---

## System Components

### 1. **Express Server** (`src/server.ts`)
- Entry point for the application
- Sets up Express middleware (helmet, rate limiting, JSON parsing)
- Initializes Redis queue service, batch worker, retry worker
- Configures routes for `/event`, `/webhook`, `/admin`, `/health`

### 2. **Redis Queue Service** (`src/lib/redis-queue.ts`)
- Manages three Redis data structures:
  - **Main Queue:** Primary queue for incoming messages
  - **Retry DLQ:** Dead Letter Queue for failed messages awaiting retry
  - **Bad Payload DLQ:** Permanently failed/invalid messages
- Handles message serialization/deserialization
- Provides batch dequeuing functionality
- Calculates queue statistics

### 3. **Batch Worker** (`src/lib/batch-worker.ts`)
- Continuously polls the main queue
- Dequeues messages in configurable batches
- Builds SFMC SOAP requests from batched data
- Sends to SFMC SOAP API
- Handles success/error routing (back to retry DLQ on failure)

### 4. **Retry Worker** (`src/lib/retry-worker.ts`)
- Monitors the Retry DLQ
- Retries failed messages with exponential backoff
- Tracks retry attempts
- Routes permanently failed messages to Bad Payload DLQ after max retries

### 5. **SFMC SOAP Service** (`src/services/sfmcSoap.ts`)
- Handles OAuth token acquisition and caching
- Builds SOAP envelopes for Create/Update requests
- Executes SOAP API calls with retry logic
- Parses SOAP responses for status/errors

### 6. **Webhook Router** (`src/routes/webhook.ts`)
- Handles POST requests to `/webhook/interakt`
- Verifies HMAC-SHA256 signatures
- Validates webhook payloads
- Checks idempotency (prevents duplicate processing)
- Flattens nested webhook data into master DE fields
- Enqueues or directly processes messages

### 7. **Event Router** (`src/routes/event.ts`)
- Handles POST requests to `/event`
- Validates event payloads from your services
- Maps event data to SFMC fields
- Can enqueue or directly insert into SFMC

### 8. **Admin Router** (`src/routes/admin.ts`)
- Provides administrative endpoints
- Clear queue statistics
- Manually flush queues
- Export queue contents

---

## Data Flow

### **Scenario 1: Webhook from Interakt**

```
1. Interakt sends webhook: POST /webhook/interakt
   ↓
2. Express receives request, parses JSON body
   ↓
3. Signature verification (HMAC-SHA256)
   ├─ Extract signature from header
   ├─ Recreate signature using raw body + secret
   └─ Compare signatures (fail if mismatch)
   ↓
4. Payload validation
   ├─ Check required fields (id, type, data.customer.id, etc.)
   ├─ Check data types
   └─ Return 400 if validation fails
   ↓
5. Idempotency check (in-memory cache)
   ├─ Generate hash of payload
   ├─ Check if already processed
   ├─ If duplicate: return 200 (already processed)
   └─ If new: continue and mark as processed
   ↓
6. Flatten nested payload
   ├─ Extract all customer data, message data, event data
   ├─ Map to 95 master DE field names
   └─ Create flat object ready for SFMC
   ↓
7. Enqueue message to Redis
   ├─ Create QueueMessage object (with id, timestamp, requestId)
   ├─ Serialize to JSON
   └─ Push to Redis main queue
   ↓
8. Return 202 Accepted to Interakt
   ├─ Include queue position
   └─ Webhook sender doesn't wait for SFMC processing
```

### **Scenario 2: Event from Your API**

```
1. Your service sends: POST /event
   ├─ Payload: { result, message, id, apiType, timestamp, phoneNumber, templateName }
   ↓
2. Express receives request
   ↓
3. Validate event payload
   ├─ Check required fields
   ├─ Validate data types
   └─ Return 400 if invalid
   ↓
4. Map event to Data Extension fields
   ├─ result → result
   ├─ message → message
   ├─ id → id
   └─ etc.
   ↓
5. Insert directly to SFMC (may also queue depending on config)
   ├─ Get OAuth token
   ├─ Build SOAP Create request
   ├─ Send to SFMC SOAP API
   └─ Return response immediately
```

### **Scenario 3: Batch Worker Processing Queue**

```
1. Batch Worker polls Redis main queue every 2000ms
   ↓
2. Queue check
   ├─ If queue empty → wait for next poll
   └─ If queue has messages → continue
   ↓
3. Dequeue batch of messages (default 30 per batch)
   ├─ Read up to 30 messages from Redis
   ├─ Calculate total payload size
   ├─ Stop reading if size > 1MB
   └─ Build array of dequeued messages
   ↓
4. Prepare SFMC data
   ├─ Iterate through batch
   ├─ Convert message payload to SFMC format
   ├─ Build array of properties for SOAP
   └─ Create XML-safe strings
   ↓
5. Build SOAP envelope
   ├─ Get OAuth token (cached)
   ├─ Create SOAP wrapper with auth header
   ├─ Add batch data as DataExtensionObject rows
   └─ Wrap in SOAP envelope
   ↓
6. Send to SFMC SOAP API
   ├─ POST request to SOAP endpoint
   ├─ Include auth token in header
   ├─ Set 30-second timeout
   └─ Retry on network/timeout errors (up to 3 retries with exponential backoff)
   ↓
7. Parse SOAP response
   ├─ Extract status code
   ├─ Check for errors
   ├─ Identify which rows succeeded/failed
   └─ Classify error type
   ↓
8. Handle response
   ├─ If all succeeded → delete from main queue, log success
   ├─ If some failed → separate failed into retry DLQ or bad payload DLQ
   ├─ If all failed → move to retry DLQ
   └─ If unrecoverable (validation error) → move to bad payload DLQ
```

### **Scenario 4: Retry Worker Processing Failures**

```
1. Retry Worker polls Retry DLQ every 5000ms
   ↓
2. Check for messages ready for retry
   ├─ Extract message from Retry DLQ
   ├─ Check retry count < max retries (default 5)
   ├─ Check if enough time has passed since last attempt
   │  (exponential backoff: delay = initialDelay * (multiplier ^ attemptCount))
   └─ If not ready → put back in Retry DLQ for later
   ↓
3. If ready, retry the message
   ├─ Increment retry attempt count
   ├─ Build SOAP request again
   ├─ Send to SFMC
   ├─ Parse response
   ↓
4. Route result
   ├─ If success → delete from retry DLQ, log success
   ├─ If still failing and retries left → put back in Retry DLQ with updated timestamp
   └─ If max retries exceeded → move to Bad Payload DLQ
```

---

## Queue System

### **Queue Architecture**

The queue system is **Redis-based** with three distinct queues:

#### **1. Main Queue** (`webhook:queue:main`)
- **Purpose:** Primary queue for new incoming messages
- **Data Structure:** Redis List (RPUSH/LPOP)
- **Capacity:** Unlimited (but configurable max size in memory)
- **TTL:** No automatic expiry
- **Processing:** Batch Worker continuously polls and dequeues

```json
{
  "id": "msg_550e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "event_id": "evt_123",
    "type": "message_api_sent",
    "data": { ... }
  },
  "rawPayload": "{...}",
  "webhookType": "message_api_sent",
  "timestamp": 1706955000000,
  "requestId": "req_12345",
  "createdAt": 1706955000000,
  "attemptCount": 0
}
```

#### **2. Retry DLQ** (`webhook:dlq:retry`)
- **Purpose:** Queue for messages that failed SFMC insert and need retry
- **Data Structure:** Redis Sorted Set (by next retry time)
- **Capacity:** Configurable
- **TTL:** Messages expire after max retry attempts
- **Processing:** Retry Worker polls and retries with exponential backoff

```json
{
  "id": "msg_550e8400-e29b-41d4-a716-446655440000",
  "payload": { ... },
  "rawPayload": "{...}",
  "webhookType": "message_api_sent",
  "timestamp": 1706955000000,
  "requestId": "req_12345",
  "createdAt": 1706955000000,
  "attemptCount": 2,
  "nextRetryTime": 1706955020000,
  "errors": [
    {
      "attempt": 1,
      "errorCode": "500",
      "errorMessage": "Timeout",
      "timestamp": 1706955010000
    }
  ]
}
```

#### **3. Bad Payload DLQ** (`webhook:dlq:bad-payload`)
- **Purpose:** Queue for permanently unprocessable messages
- **Data Structure:** Redis List
- **Capacity:** Configurable
- **TTL:** Long-term storage (manual cleanup)
- **Processing:** No automatic retry; manual inspection needed

```json
{
  "id": "msg_550e8400-e29b-41d4-a716-446655440000",
  "rawPayload": "{...}",
  "webhookType": "message_api_sent",
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Missing required field: data_customer_id",
    "timestamp": 1706955000000
  },
  "requestId": "req_12345"
}
```

### **Batching Strategy**

Messages are batched to optimize SFMC SOAP API calls:

| Configuration | Default | Description |
|--------------|---------|-------------|
| `QUEUE_BATCH_SIZE` | 30 | Max messages per batch |
| `QUEUE_BATCH_BYTES` | 1MB | Max total size per batch |
| `QUEUE_BATCH_TIMEOUT` | 5000ms | Max wait before sending incomplete batch |

**Batching Algorithm:**
```
1. Dequeue up to N messages
2. For each message:
   - Check if adding it exceeds size limit
   - If no: add to batch
   - If yes: process current batch, start new batch
3. Once batch complete:
   - Build SOAP XML with all batch items
   - Send single request
   - Reduces SOAP calls by 30x vs single inserts
```

### **Queue Configuration (Environment Variables)**

```bash
# Queue behavior
QUEUE_BATCH_SIZE=30                    # Messages per batch
QUEUE_BATCH_BYTES=1048576              # Max batch size (1MB)
QUEUE_BATCH_TIMEOUT=5000               # Flush timeout (5 sec)

# Retry strategy
QUEUE_MAX_RETRIES=5                    # Max retry attempts
QUEUE_RETRY_INITIAL_DELAY=5000         # First retry delay (5 sec)
QUEUE_RETRY_MAX_DELAY=300000           # Max retry delay (5 min)
QUEUE_RETRY_BACKOFF=2.0                # Backoff multiplier (exponential)

# Workers
BATCH_WORKER_ENABLED=true              # Enable batch processing
BATCH_WORKER_POLL_INTERVAL=2000        # Poll every 2 sec

RETRY_WORKER_ENABLED=true              # Enable retry processing
RETRY_POLL_INTERVAL=5000               # Poll every 5 sec
RETRY_IDLE_THRESHOLD=5                 # Idle after 5 failed attempts
RETRY_IDLE_DURATION=10000              # Idle for 10 sec

# Redis
REDIS_URL=redis://localhost:6379
```

### **Queue Statistics & Monitoring**

The queue provides real-time statistics via `/admin/queue/stats`:

```json
{
  "mainQueue": {
    "size": 45,
    "averageAge": 1234,
    "oldestMessage": 1706955000000
  },
  "retryDLQ": {
    "size": 12,
    "averageRetries": 2.5,
    "nextRetryIn": 5000
  },
  "badPayloadDLQ": {
    "size": 3
  },
  "stats": {
    "totalProcessed": 10245,
    "totalRetried": 234,
    "totalBadPayloads": 3,
    "successRate": 0.977,
    "averageProcessingTime": 234
  }
}
```

---

## API Endpoints

### **1. Webhook Endpoint**

**POST** `/webhook/interakt`

Receives webhooks from Interakt for all event types.

**Request:**
```bash
curl -X POST http://localhost:3000/webhook/interakt \
  -H "Content-Type: application/json" \
  -H "X-Interakt-Signature: sha256=HMAC_SIGNATURE_HERE" \
  -d '{
    "id": "evt_550e8400-e29b-41d4-a716-446655440000",
    "type": "message_api_sent",
    "version": "1.0",
    "timestamp": "2024-02-02T10:30:00Z",
    "data": {
      "customer": {
        "id": "CUST123",
        "channel_phone_number": "+91234567890",
        ...
      },
      "message": {
        "id": "msg_123",
        "status": "sent",
        ...
      }
    }
  }'
```

**Response (202 Accepted):**
```json
{
  "status": "ACCEPTED",
  "message": "Message queued for processing",
  "queuePosition": 45,
  "requestId": "req_12345"
}
```

**Error (400 Bad Request):**
```json
{
  "error": "Validation failed",
  "details": "Missing required field: data.customer.id",
  "requestId": "req_12345"
}
```

**Error (403 Forbidden):**
```json
{
  "error": "Signature verification failed",
  "requestId": "req_12345"
}
```

### **2. Event Endpoint**

**POST** `/event`

Receive events from your own services for insertion into SFMC.

**Request:**
```bash
curl -X POST http://localhost:3000/event \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_123",
    "result": "success",
    "message": "Payment processed",
    "apiType": "payment_webhook",
    "timestamp": "2024-02-02T10:30:00Z",
    "phoneNumber": "+91234567890",
    "templateName": "payment_confirmation"
  }'
```

**Response (200 OK):**
```json
{
  "status": "OK",
  "statusMessage": "Data Extension object was created",
  "requestId": "00001234",
  "overallStatus": "OK",
  "processingTime": 245
}
```

### **3. Health Check Endpoint**

**GET** `/health`

System health and statistics.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-02-02T10:30:00Z",
  "uptime": 123456789,
  "environment": "production",
  "version": "2.0.0"
}
```

### **4. Statistics Endpoint**

**GET** `/health/stats`

Queue and processing statistics.

**Response:**
```json
{
  "totalWebhooks": 10245,
  "successfulInserts": 10012,
  "failedInserts": 233,
  "currentQueueSize": 45,
  "successRate": 0.977,
  "averageProcessingTime": 234
}
```

### **5. Admin: Clear Cache**

**POST** `/admin/cache/clear`

Clear idempotency cache (use with caution).

**Response:**
```json
{
  "status": "OK",
  "message": "Cache cleared",
  "itemsCleared": 1234
}
```

### **6. Admin: Queue Statistics**

**GET** `/admin/queue/stats`

Detailed queue statistics.

**Response:**
```json
{
  "mainQueue": { "size": 45 },
  "retryDLQ": { "size": 12 },
  "badPayloadDLQ": { "size": 3 },
  "stats": { ... }
}
```

### **7. Admin: Flush Queue**

**POST** `/admin/queue/flush`

Force immediate flush of main queue.

**Response:**
```json
{
  "status": "OK",
  "messagesFlushed": 45,
  "processingTime": 1234
}
```

---

## Project Structure

```
interakt-sfmc-webhook/
├── src/                              # TypeScript source files (new architecture)
│   ├── server.ts                     # Main Express app
│   ├── config.ts                     # Configuration management
│   ├── lib/
│   │   ├── redis-queue.ts            # Redis queue service
│   │   ├── batch-worker.ts           # Batch processing worker
│   │   ├── retry-worker.ts           # Retry logic worker
│   │   ├── error-classifier.ts       # Error type classification
│   │   └── queue-types.ts            # TypeScript interfaces
│   ├── routes/
│   │   ├── webhook.ts                # POST /webhook/interakt
│   │   ├── event.ts                  # POST /event
│   │   ├── health.ts                 # GET /health, /stats
│   │   ├── admin.ts                  # Admin endpoints
│   │   └── queue-admin.ts            # Queue management endpoints
│   ├── services/
│   │   ├── sfmcAuth.ts               # OAuth token management
│   │   └── sfmcSoap.ts               # SOAP API wrapper
│   └── utils/
│       ├── logger.ts                 # Structured logging
│       ├── soapBuilder.ts            # Build SOAP XML envelopes
│       ├── soapParser.ts             # Parse SOAP responses
│       └── validator.ts              # Request validation
│
├── lib/                              # JavaScript files (legacy, being phased out)
│   ├── webhook-handler.js            # Webhook processing logic
│   ├── sfmc-client.js                # SFMC OAuth and API client
│   ├── queue.js                      # Legacy queue implementation
│   ├── idempotency.js                # Duplicate detection
│   ├── payload-validator.js          # Payload validation
│   ├── error-classifier.js           # Error classification
│   ├── request-queue.js              # Request queueing middleware
│   └── rate-limiter.js               # Rate limiting utilities
│
├── config/
│   └── constants.js                  # Application constants
│
├── utils/
│   └── logger.js                     # Logging utilities
│
├── routes/
│   └── logs.ts                       # Legacy route
│
├── samples/                          # Example webhook payloads
│   ├── webhook-message-sent.json
│   ├── webhook-message-delivered.json
│   ├── webhook-message-failed.json
│   ├── webhook-incoming-message.json
│   ├── webhook-button-click.json
│   ├── webhook-workflow-response.json
│   └── event-payload.json
│
├── postman/                          # Postman collections for testing
│   ├── Interakt-SFMC-Local.postman_environment.json
│   ├── Interakt-SFMC-Prod.postman_environment.json
│   ├── Interakt-SFMC-Webhook.postman_collection.json
│   └── Data Extension APIs.postman_collection.json
│
├── logs/                             # Application logs directory
│
├── src/                              # Dist directory (compiled TypeScript)
│
├── server.js                         # Express server entry point (JS version)
├── test-bulk-insert.js               # Bulk insert test script
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript configuration
├── Dockerfile                        # Docker image definition
├── docker-compose.yml                # Docker compose for local dev
├── Procfile                          # Heroku deployment config
├── README.md                         # Quick start guide
└── CODEBASE_OVERVIEW.md             # This file
```

---

## Key Files & Modules

### **`src/server.ts` - Application Entry Point**
- Initializes Express app with middleware
- Sets up Redis queue service
- Starts batch and retry workers
- Registers routes
- Implements global error handling

**Key Functions:**
- `validateConfig()` - Validates environment variables on startup
- `initializeQueueService()` - Creates Redis queue instance
- `initializeBatchWorker()` - Starts batch processing
- `initializeRetryWorker()` - Starts retry processing

### **`src/lib/redis-queue.ts` - Queue Service**
- Manages Redis operations for three separate queues
- Handles message serialization/deserialization
- Provides batch dequeue functionality
- Tracks statistics

**Key Classes/Functions:**
- `RedisQueueService.enqueueMain()` - Add to main queue
- `RedisQueueService.dequeueBatch()` - Dequeue batch for processing
- `RedisQueueService.enqueueRetry()` - Move to retry DLQ
- `RedisQueueService.enqueueBadPayload()` - Move to bad payload DLQ
- `RedisQueueService.getQueueStats()` - Get statistics

### **`src/lib/batch-worker.ts` - Batch Processing**
- Polls main queue at configured interval
- Dequeues batch of messages
- Sends to SFMC via SOAP
- Routes failed messages to retry DLQ

**Key Methods:**
- `start()` - Start polling
- `processBatch()` - Process single batch
- `sendBatchToSFMC()` - Send to SFMC and handle response

### **`src/lib/retry-worker.ts` - Retry Logic**
- Polls retry DLQ at configured interval
- Checks if messages are ready for retry (exponential backoff)
- Attempts to re-insert into SFMC
- Routes to bad payload DLQ after max retries

**Key Methods:**
- `start()` - Start polling
- `processRetryQueue()` - Process retry DLQ
- `calculateNextRetryTime()` - Exponential backoff calculation

### **`src/routes/webhook.ts` - Webhook Receiver**
- Receives POST requests for Interakt webhooks
- Verifies HMAC-SHA256 signature
- Validates payload structure
- Checks for duplicate processing (idempotency)
- Flattens nested data into 95 master fields
- Enqueues message

**Key Functions:**
- `verifySignature()` - HMAC validation
- `validateWebhookPayload()` - Payload schema validation
- `flattenWebhookData()` - Nested to flat mapping
- `handleInteraktWebhook()` - Main request handler

**Supported Webhook Types:**
```
MESSAGE_API_SENT
MESSAGE_API_DELIVERED
MESSAGE_API_READ
MESSAGE_API_FAILED
MESSAGE_API_CLICKED
MESSAGE_CAMPAIGN_SENT
MESSAGE_CAMPAIGN_DELIVERED
MESSAGE_CAMPAIGN_READ
MESSAGE_CAMPAIGN_FAILED
MESSAGE_RECEIVED
WORKFLOW_RESPONSE_UPDATE
ACCOUNT_ALERTS
ACCOUNT_UPDATE
ACCOUNT_REVIEW_UPDATE
BUSINESS_CAPABILITY_UPDATE
PHONE_NUMBER_QUALITY_UPDATE
TEMPLATE_PERFORMANCE_METRICS
MESSAGE_TEMPLATE_STATUS_UPDATE
```

### **`src/services/sfmcSoap.ts` - SFMC Integration**
- Handles OAuth token acquisition
- Caches tokens with automatic refresh
- Builds SOAP XML envelopes
- Executes SOAP API calls
- Parses SOAP responses
- Implements retry logic with exponential backoff

**Key Functions:**
- `getAccessToken()` - Get/refresh OAuth token (cached)
- `getSoapInstanceUrl()` - Get SFMC SOAP endpoint URL
- `insertToDataExtension()` - Insert single record
- `upsertToDataExtension()` - Insert or update record
- `executeSoapRequest()` - Execute SOAP call with retry

### **`src/utils/validator.ts` - Request Validation**
- Validates webhook payloads
- Validates event payloads
- Checks required fields
- Type checking

**Key Functions:**
- `validateWebhookPayload()` - Webhook validation
- `validateEventPayload()` - Event validation

### **`src/utils/soapBuilder.ts` - SOAP XML Generation**
- Builds SOAP envelope XML
- Converts JS objects to SOAP properties
- Handles XML escaping

**Key Functions:**
- `buildCreateSoapEnvelope()` - Create request XML
- `buildUpdateSoapEnvelope()` - Update request XML
- `objectToProperties()` - Convert to SOAP properties

### **`src/utils/soapParser.ts` - SOAP Response Parsing**
- Parses SOAP XML responses
- Extracts status codes and messages
- Classifies error types

**Key Functions:**
- `parseSoapResponse()` - Parse response XML
- `isDuplicateKeyError()` - Check for duplicate key errors

---

## Configuration

### **Environment Variables**

```bash
# Server
PORT=3000
NODE_ENV=development

# Redis Queue
REDIS_URL=redis://localhost:6379

# Salesforce Marketing Cloud (OAuth)
SFMC_CLIENT_ID=your_client_id
SFMC_CLIENT_SECRET=your_client_secret
SFMC_SUBDOMAIN=subdomain.rest.marketingcloudapis.com

# Interakt Webhook (signature verification)
INTERAKT_WEBHOOK_SECRET=your_webhook_secret

# Data Extensions (SFMC)
DATA_EXTENSION_MASTER=master_webhook_de_key
DATA_EXTENSION_EVENT=event_de_key

# Queue Configuration
QUEUE_BATCH_SIZE=30
QUEUE_BATCH_BYTES=1048576
QUEUE_BATCH_TIMEOUT=5000
QUEUE_MAX_RETRIES=5
QUEUE_RETRY_INITIAL_DELAY=5000
QUEUE_RETRY_MAX_DELAY=300000
QUEUE_RETRY_BACKOFF=2.0

# Workers
BATCH_WORKER_ENABLED=true
BATCH_WORKER_POLL_INTERVAL=2000
RETRY_WORKER_ENABLED=true
RETRY_POLL_INTERVAL=5000
RETRY_IDLE_THRESHOLD=5
RETRY_IDLE_DURATION=10000

# Logging
LOG_LEVEL=info
```

### **Configuration Schema** (`src/config.ts`)

The application validates all required config on startup:
- SFMC credentials (OAuth)
- Redis connection
- Data extension keys
- Port and environment

If any required config is missing, the server fails to start with a clear error message.

---

## Webhook Event Types

### **Message Status Events**

#### 1. **message_api_sent**
Fired when a message sent via API is marked as sent by Interakt.
```json
{
  "id": "evt_550e8400-e29b-41d4-a716-446655440000",
  "type": "message_api_sent",
  "version": "1.0",
  "timestamp": "2024-02-02T10:30:00Z",
  "data": {
    "customer": { ... },
    "message": {
      "id": "msg_123",
      "status": "sent",
      "message_sent_at_utc": "2024-02-02T10:30:00Z"
    }
  }
}
```

#### 2. **message_api_delivered**
Fired when message reaches recipient's phone.
```json
{
  "type": "message_api_delivered",
  "data": {
    "message": {
      "message_delivered_at_utc": "2024-02-02T10:31:00Z"
    }
  }
}
```

#### 3. **message_api_read**
Fired when recipient reads message.
```json
{
  "type": "message_api_read",
  "data": {
    "message": {
      "message_read_at_utc": "2024-02-02T10:32:00Z"
    }
  }
}
```

#### 4. **message_api_failed**
Fired when message fails to send.
```json
{
  "type": "message_api_failed",
  "data": {
    "message": {
      "status": "failed",
      "failure_reason": "Invalid phone number"
    }
  }
}
```

#### 5. **message_api_clicked**
Fired when recipient clicks QR code or CTA button.
```json
{
  "type": "message_api_clicked",
  "data": {
    "message": {
      "click_type": "QR",
      "clicked_at_utc": "2024-02-02T10:33:00Z"
    }
  }
}
```

### **Message Reception Events**

#### 6. **message_received**
Fired when customer sends inbound message to your business account.
```json
{
  "type": "message_received",
  "data": {
    "customer": { ... },
    "message": {
      "body": "Hello, I need help",
      "received_at_utc": "2024-02-02T10:35:00Z"
    }
  }
}
```

### **Workflow Events**

#### 7. **workflow_response_update**
Fired when customer interacts with automation workflow.
```json
{
  "type": "workflow_response_update",
  "data": {
    "workflow": {
      "workflow_id": "wf_123",
      "response": "selected_option_2"
    }
  }
}
```

### **Campaign Message Events**

#### 8-11. **message_campaign_sent/delivered/read/failed**
Similar to API message events but for campaign-based messages.

### **Account Events**

#### 12. **account_alerts**
System alerts about account (rate limits, etc.)

#### 13. **account_update**
Account settings changed.

#### 14. **account_review_update**
WhatsApp account review status changed.

#### 15. **business_capability_update**
Business capability changes (e.g., messaging tier).

#### 16. **phone_number_quality_update**
Phone number quality score changed.

### **Template Events**

#### 17. **template_performance_metrics**
Template performance data.

#### 18. **message_template_status_update**
Template approval status changed.

---

## SFMC Integration

### **OAuth Token Management**

The system implements **token caching and automatic refresh**:

1. **Initial Token Request:**
   - POST to `https://subdomain.auth.marketingcloudapis.com/v2/token`
   - Provide Client ID and Client Secret
   - Receive access token with expiry (usually 20 minutes)

2. **Token Caching:**
   - Token stored in memory with expiry time
   - Cache used for all subsequent API calls
   - No repeated auth calls within token lifetime

3. **Automatic Refresh:**
   - Before token expiry (60 seconds margin), system refreshes
   - New token fetched and cached
   - If refresh fails, retried on next request

4. **Concurrency Safety:**
   - Token refresh uses lock to prevent multiple simultaneous refreshes
   - Only first request triggers refresh, others wait

### **SOAP API Calls**

Messages are sent to SFMC using **SOAP API** (CreateRequest):

**Request:**
```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <fueloauth>YOUR_OAUTH_TOKEN</fueloauth>
  </soap:Header>
  <soap:Body>
    <CreateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <Options/>
      <Objects xsi:type="DataExtensionObject">
        <PartnerKey xsi:nil="true"/>
        <ObjectID xsi:nil="true"/>
        <CustomerKey>master_webhook_de_key</CustomerKey>
        <Properties>
          <Property>
            <Name>event_id</Name>
            <Value>evt_123</Value>
          </Property>
          <Property>
            <Name>type</Name>
            <Value>message_api_sent</Value>
          </Property>
          ... (more properties)
        </Properties>
      </Objects>
    </CreateRequest>
  </soap:Body>
</soap:Envelope>
```

**Response:**
```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope>
  <soap:Body>
    <CreateResponse xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <Result>
        <StatusCode>OK</StatusCode>
        <StatusMessage>Created DataExtensionObject</StatusMessage>
        <NewObjectID>1234567</NewObjectID>
      </Result>
      <RequestID>00001234-5678-1234-5678-123456789012</RequestID>
      <OverallStatus>OK</OverallStatus>
    </CreateResponse>
  </soap:Body>
</soap:Envelope>
```

### **Error Handling in SFMC**

Common SFMC errors and handling:

| Error Code | Meaning | Action |
|-----------|---------|--------|
| OK | Success | Delete from queue |
| Error | Validation/business logic error | Move to Bad Payload DLQ |
| 400 | Bad request syntax | Move to Bad Payload DLQ |
| 401 | Auth failed (token expired) | Refresh token and retry |
| 500 | Server error | Move to Retry DLQ |
| 503 | Service unavailable | Move to Retry DLQ |
| Network timeout | Connection issue | Move to Retry DLQ |

---

## Error Handling & Retries

### **Error Classification**

The system classifies errors into categories:

```typescript
enum ErrorType {
  VALIDATION_ERROR,      // Fix payload before retry
  AUTH_ERROR,            // Refresh token
  TRANSIENT_ERROR,       // Retry with backoff
  RATE_LIMIT_ERROR,      // Retry with longer backoff
  PERMANENT_ERROR,       // Don't retry
  UNKNOWN_ERROR          // Retry cautiously
}
```

**Classification Logic:**
1. Check error code and message
2. Determine if retryable (transient) or permanent
3. Route to appropriate DLQ (retry or bad payload)

### **Retry Strategy**

**Exponential Backoff Algorithm:**
```
next_retry_delay = initial_delay × (backoff_multiplier ^ attempt_number)
next_retry_delay = min(next_retry_delay, max_delay)
```

**Example with defaults:**
- Attempt 1: Fail immediately, queue for retry
- Attempt 2: Wait 5 seconds, retry
- Attempt 3: Wait 10 seconds, retry
- Attempt 4: Wait 20 seconds, retry
- Attempt 5: Wait 40 seconds, retry
- Attempt 6: Wait 80 seconds, retry
- After 5 attempts: Move to Bad Payload DLQ

**Configuration:**
```bash
QUEUE_MAX_RETRIES=5                    # Max 5 attempts
QUEUE_RETRY_INITIAL_DELAY=5000         # Start with 5 seconds
QUEUE_RETRY_MAX_DELAY=300000           # Cap at 5 minutes
QUEUE_RETRY_BACKOFF=2.0                # Double delay each time
```

### **Idempotency**

The webhook endpoint implements **idempotency checking** to prevent duplicate processing:

1. **Hash Generation:**
   - Create SHA-256 hash of entire webhook payload
   - Used as unique identifier

2. **Cache Storage:**
   - Store hash in in-memory cache
   - Cache key: `webhook:idempotency:{hash}`
   - Cache TTL: 24 hours (configurable)

3. **Duplicate Detection:**
   - Check cache before processing
   - If hash found: return 200 (already processed)
   - If new: process and add to cache

**Prevents:**
- Webhook retransmissions from Interakt
- Accidental duplicate submissions from testing
- Double-processing if webhook sent twice

---

## Deployment

### **Local Development**

**Option 1: With Node.js directly**
```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with local SFMC credentials

# Start development server (auto-reload)
npm run dev:ts

# Server runs on http://localhost:3000
```

**Option 2: With Docker**
```bash
# Build images
docker-compose build

# Start services (Express + Redis)
docker-compose up

# View logs
docker-compose logs -f webhook
```

### **Production Deployment**

#### **Option 1: Heroku**
```bash
# Install Heroku CLI
# Login to Heroku
heroku login

# Create app
heroku create your-app-name

# Set config vars
heroku config:set SFMC_CLIENT_ID=xxx
heroku config:set SFMC_CLIENT_SECRET=xxx
# ... set all required config

# Set up Redis add-on
heroku addons:create heroku-redis:premium-0

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

#### **Option 2: Docker on AWS/GCP/Azure**
```bash
# Build image
docker build -t webhook-service:v2.0 .

# Push to registry
docker push your-registry/webhook-service:v2.0

# Deploy with docker-compose or Kubernetes
# Set environment variables in deployment config
```

#### **Option 3: Traditional VPS/Server**
```bash
# SSH into server
ssh user@server.com

# Clone repo
git clone https://github.com/...

# Install Node.js 18+
# Install Redis

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run with PM2 (for process management)
npm install -g pm2
pm2 start dist/server.js --name webhook-service

# Set up reverse proxy (Nginx) in front
# Configure SSL/TLS certificates
```

### **Health Checks**

Configure health check endpoints in your deployment:

```bash
# Kubernetes
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
```

### **Monitoring**

Key metrics to monitor:

1. **Queue Size:** If continuously growing, batch worker may be falling behind
2. **Retry DLQ Size:** High retry count may indicate SFMC issues
3. **Bad Payload DLQ Size:** Indicates invalid payloads being sent
4. **Response Times:** Should be <500ms for 95th percentile
5. **Error Rate:** Should be <1% for healthy system
6. **Redis Memory:** Monitor for memory leaks

### **Logging**

Logs include structured data for monitoring:
- Request IDs for tracing
- Processing times
- Queue positions
- Error classification and details

**Log Levels:**
- `debug`: Development only
- `info`: Normal operations
- `warn`: Unexpected but recoverable issues
- `error`: Failures that need attention

---

## Summary

This webhook integration provides a **production-ready, scalable bridge** between Interakt and Salesforce Marketing Cloud. Key characteristics:

✅ **Reliable:** Queue-based with retries and error handling
✅ **Scalable:** Batch processing reduces SFMC API calls by 30x
✅ **Fast:** Async processing with 202 Accepted responses
✅ **Secure:** HMAC signature verification, OAuth tokens
✅ **Observable:** Comprehensive logging and statistics
✅ **Maintainable:** TypeScript codebase with clear separation of concerns

The system handles high-volume webhook events from Interakt, batches them efficiently, and reliably delivers them to SFMC Data Extensions for use in customer engagement campaigns.

