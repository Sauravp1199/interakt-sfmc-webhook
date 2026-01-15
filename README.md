# Interakt to Salesforce Marketing Cloud Webhook Integration

A production-ready **TypeScript** webhook service that bridges **Interakt** (WhatsApp Business Platform) with **Salesforce Marketing Cloud (SFMC)**. This service receives real-time webhooks from Interakt and event payloads, transforming and forwarding the data directly to SFMC Data Extensions via SOAP API.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Testing with cURL](#testing-with-curl)
- [SFMC Data Extensions Setup](#sfmc-data-extensions-setup)
- [Webhook Events](#webhook-events)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Features

- **TypeScript**: Fully typed codebase for better maintainability
- **Direct SFMC Integration**: No local database - transforms and forwards data directly to SFMC
- **Dual Endpoints**:
  - `/event` - For direct API event payloads
  - `/webhook/interakt` - For Interakt webhook events
- **SFMC SOAP API**: Uses CreateRequest DataExtensionObject for data insertion
- **Token Caching**: OAuth tokens cached with automatic refresh (60 seconds before expiry)
- **Concurrency Safe**: Token refresh lock prevents multiple simultaneous refreshes
- **Retry Logic**: Exponential backoff retry (max 2 retries) for SOAP calls
- **Request Validation**: Validates all required fields before processing
- **Security**: HMAC-SHA256 signature verification, Helmet headers, rate limiting
- **Comprehensive Logging**: Structured logging with configurable levels

## Architecture

```
+------------------+                      +----------------------------------+
|   Your Service   |   POST /event        |                                  |
|  (API Response)  | ------------------> |   Interakt-SFMC Webhook Server   |
+------------------+                      |                                  |
                                          |   1. Validate Request            |
+------------------+   POST /webhook      |   2. Verify Signature (webhook)  |
|    Interakt      | ------------------> |   3. Get/Refresh SFMC Token      |
|   (WhatsApp)     |                      |   4. Build SOAP XML              |
+------------------+                      |   5. Send to SFMC (with retry)   |
                                          |   6. Parse Response              |
                                          |   7. Return Result               |
                                          +----------------+-----------------+
                                                           |
                                                           | SOAP API
                                                           v
                                          +----------------------------------+
                                          |  Salesforce Marketing Cloud      |
                                          |                                  |
                                          |  Data Extensions:                |
                                          |  - Event DE (for /event)         |
                                          |  - Messages DE                   |
                                          |  - Button Clicks DE              |
                                          |  - Incoming Messages DE          |
                                          |  - Workflow Responses DE         |
                                          +----------------------------------+
```

## Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.0.0 or higher
- **Salesforce Marketing Cloud** account with:
  - API Integration (Server-to-Server)
  - Data Extensions created
- **Interakt Account** (optional, for webhook integration)

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd interakt-sfmc-webhook
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

### 4. Build and start

```bash
# Development (with auto-reload)
npm run dev

# Production build
npm run build
npm start
```

The server starts on `http://localhost:1112` (or the port specified in PORT env var).

## Configuration

Create a `.env` file with the following variables:

```bash
# Server Configuration
NODE_ENV=production
PORT=1112

# Interakt Configuration (for webhook signature verification)
INTERAKT_SECRET=your_webhook_secret_key_here

# Salesforce Marketing Cloud Configuration
SFMC_AUTH_BASE_URL=https://mc72wv4hqz48m1slvbncl40nnlv4.auth.marketingcloudapis.com
SFMC_SOAP_BASE_URL=https://mc72wv4hqz48m1slvbncl40nnlv4.soap.marketingcloudapis.com
SFMC_CLIENT_ID=your_client_id
SFMC_CLIENT_SECRET=your_client_secret
SFMC_ACCOUNT_ID=your_account_id

# Data Extension Customer Keys
SFMC_DE_CUSTOMER_KEY=402A0395-7B93-4866-AF97-530424622A9F  # For /event endpoint
DE_MESSAGES=YOUR_MESSAGES_DE_CUSTOMER_KEY
DE_BUTTON_CLICKS=YOUR_BUTTON_CLICKS_DE_CUSTOMER_KEY
DE_INCOMING_MESSAGES=YOUR_INCOMING_MESSAGES_DE_CUSTOMER_KEY
DE_WORKFLOW_RESPONSES=YOUR_WORKFLOW_RESPONSES_DE_CUSTOMER_KEY

# Admin Configuration (Optional)
ADMIN_KEY=your_secure_random_admin_key

# Logging (ERROR, WARN, INFO, DEBUG)
LOG_LEVEL=info
```

## API Endpoints

| Method | Endpoint              | Description                          | Authentication    |
|--------|-----------------------|--------------------------------------|-------------------|
| GET    | `/`                   | Service info and available endpoints | None              |
| GET    | `/health`             | Health check with system metrics     | None              |
| GET    | `/stats`              | Request statistics                   | None              |
| POST   | `/event`              | Direct event payload receiver        | None              |
| POST   | `/webhook/interakt`   | Interakt webhook receiver            | HMAC Signature    |
| POST   | `/admin/clear-cache`  | Clear SFMC token cache               | Admin Key Header  |
| GET    | `/admin/config`       | View non-sensitive config            | Admin Key Header  |

### POST /event

Receives event payloads and inserts them into SFMC Data Extension.

**Request Body:**
```json
{
  "result": false,
  "message": "Test done",
  "id": "36353-uyw7827",
  "apiType": "no_header",
  "timestamp": "2026-01-06T13:57:26.950Z",
  "phoneNumber": "7211111111",
  "templateName": "send_templates_noheader_test"
}
```

**Success Response (200):**
```json
{
  "status": "OK",
  "statusMessage": "Created DataExtensionObject",
  "requestId": "79200f7f-046a-4a6e-9041-4baa222e9919",
  "overallStatus": "OK",
  "processingTime": 234
}
```

**Error Response (400/500):**
```json
{
  "status": "ERROR",
  "statusMessage": "Missing required field: id",
  "field": "id",
  "code": "VALIDATION_ERROR",
  "processingTime": 5
}
```

## Testing with cURL

### Test /event endpoint

```bash
curl -X POST http://localhost:1112/event \
  -H "Content-Type: application/json" \
  -d '{
    "result": false,
    "message": "Test done",
    "id": "36353-uyw7827",
    "apiType": "no_header",
    "timestamp": "2026-01-06T13:57:26.950Z",
    "phoneNumber": "7211111111",
    "templateName": "send_templates_noheader_test"
  }'
```

### Test Health Check

```bash
curl http://localhost:1112/health
```

### Test Webhook (without signature)

```bash
curl -X POST http://localhost:1112/webhook/interakt \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message_api_sent",
    "timestamp": "2026-01-13T10:30:00.000Z",
    "data": {
      "customer": {
        "id": "cust_12345",
        "phone_number": "919876543210",
        "traits": { "name": "John Doe" }
      },
      "message": {
        "id": "msg_abc123",
        "received_at_utc": "2026-01-13T10:30:00.000Z",
        "campaign_id": "camp_001"
      }
    }
  }'
```

### Clear Token Cache (Admin)

```bash
curl -X POST http://localhost:1112/admin/clear-cache \
  -H "x-admin-key: your_secure_random_admin_key"
```

## SFMC Data Extensions Setup

### Event Data Extension (for /event endpoint)

**Customer Key:** `402A0395-7B93-4866-AF97-530424622A9F` (or your custom key)

| Field Name    | Data Type | Length | Primary Key | Required |
|---------------|-----------|--------|-------------|----------|
| id            | Text      | 100    | Yes         | Yes      |
| result        | Text      | 10     | No          | No       |
| message       | Text      | 500    | No          | No       |
| apiType       | Text      | 50     | No          | No       |
| timestamp     | Text      | 50     | No          | No       |
| phoneNumber   | Text      | 20     | No          | No       |
| templateName  | Text      | 255    | No          | No       |

### Messages Data Extension

| Field Name     | Data Type | Length | Primary Key | Required |
|----------------|-----------|--------|-------------|----------|
| MessageId      | Text      | 100    | Yes         | Yes      |
| CustomerId     | Text      | 100    | No          | Yes      |
| PhoneNumber    | Text      | 20     | No          | No       |
| CustomerName   | Text      | 255    | No          | No       |
| MessageStatus  | Text      | 20     | No          | Yes      |
| ReceivedAt     | Text      | 50     | No          | No       |
| DeliveredAt    | Text      | 50     | No          | No       |
| SeenAt         | Text      | 50     | No          | No       |
| CampaignId     | Text      | 100    | No          | No       |
| TemplateName   | Text      | 255    | No          | No       |
| CallbackData   | Text      | 500    | No          | No       |
| MessageCost    | Text      | 20     | No          | No       |
| FailureReason  | Text      | 500    | No          | No       |
| ErrorCode      | Text      | 50     | No          | No       |
| ProcessedAt    | Text      | 50     | No          | No       |

### Button Clicks Data Extension

| Field Name     | Data Type | Length | Primary Key | Required |
|----------------|-----------|--------|-------------|----------|
| MessageId      | Text      | 100    | Yes         | Yes      |
| CustomerId     | Text      | 100    | No          | Yes      |
| PhoneNumber    | Text      | 20     | No          | No       |
| CustomerName   | Text      | 255    | No          | No       |
| ClickType      | Text      | 10     | No          | No       |
| ButtonText     | Text      | 255    | No          | No       |
| ButtonLink     | Text      | 500    | No          | No       |
| ClickedAt      | Text      | 50     | No          | No       |
| CallbackData   | Text      | 500    | No          | No       |
| ProcessedAt    | Text      | 50     | No          | No       |

### Incoming Messages Data Extension

| Field Name     | Data Type | Length | Primary Key | Required |
|----------------|-----------|--------|-------------|----------|
| MessageId      | Text      | 100    | Yes         | Yes      |
| CustomerId     | Text      | 100    | No          | Yes      |
| PhoneNumber    | Text      | 20     | No          | No       |
| CustomerName   | Text      | 255    | No          | No       |
| MessageType    | Text      | 50     | No          | No       |
| MessageText    | Text      | 4000   | No          | No       |
| MediaUrl       | Text      | 500    | No          | No       |
| ReceivedAt     | Text      | 50     | No          | No       |
| ProcessedAt    | Text      | 50     | No          | No       |

### Workflow Responses Data Extension

| Field Name     | Data Type | Length | Primary Key | Required |
|----------------|-----------|--------|-------------|----------|
| WorkflowId     | Text      | 100    | Yes         | Yes      |
| CustomerId     | Text      | 100    | Yes         | Yes      |
| StepNumber     | Text      | 10     | Yes         | Yes      |
| PhoneNumber    | Text      | 20     | No          | No       |
| CustomerName   | Text      | 255    | No          | No       |
| Question       | Text      | 1000   | No          | No       |
| Answer         | Text      | 1000   | No          | No       |
| TraitName      | Text      | 100    | No          | No       |
| AnsweredAt     | Text      | 50     | No          | No       |
| ProcessedAt    | Text      | 50     | No          | No       |

## Webhook Events

The service handles the following Interakt webhook event types:

| Event Type                  | Status     | Description                    | Target DE         |
|-----------------------------|------------|--------------------------------|-------------------|
| `message_api_sent`          | Sent       | API message sent               | Messages          |
| `message_api_delivered`     | Delivered  | API message delivered          | Messages          |
| `message_api_read`          | Read       | API message read               | Messages          |
| `message_api_failed`        | Failed     | API message failed             | Messages          |
| `message_campaign_sent`     | Sent       | Campaign message sent          | Messages          |
| `message_campaign_delivered`| Delivered  | Campaign message delivered     | Messages          |
| `message_campaign_read`     | Read       | Campaign message read          | Messages          |
| `message_campaign_failed`   | Failed     | Campaign message failed        | Messages          |
| `message_api_clicked`       | -          | Button click (QR or CTA)       | Button Clicks     |
| `message_received`          | -          | Incoming customer message      | Incoming Messages |
| `workflow_response_update`  | -          | Workflow Q&A response          | Workflow Responses|

## Deployment

### Heroku Deployment

```bash
# Create app
heroku create your-app-name

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set SFMC_CLIENT_ID=your_client_id
heroku config:set SFMC_CLIENT_SECRET=your_client_secret
heroku config:set SFMC_ACCOUNT_ID=your_account_id
heroku config:set SFMC_DE_CUSTOMER_KEY=your_de_key
# ... set other variables

# Deploy
git push heroku main
```

### Configure Interakt Webhook

1. Go to **Interakt Dashboard** > **Settings** > **Developer Settings**
2. Set **Webhook URL**: `https://your-app.herokuapp.com/webhook/interakt`
3. Set **Secret Key**: Same as `INTERAKT_SECRET` in your .env
4. Enable desired webhook events

## Project Structure

```
interakt-sfmc-webhook/
|-- src/
|   |-- server.ts              # Express server entry point
|   |-- config.ts              # Configuration loader
|   |-- routes/
|   |   |-- event.ts           # POST /event handler
|   |   |-- webhook.ts         # POST /webhook/interakt handler
|   |   |-- health.ts          # Health & stats endpoints
|   |   +-- admin.ts           # Admin endpoints
|   |-- services/
|   |   |-- sfmcAuth.ts        # SFMC OAuth with token caching
|   |   +-- sfmcSoap.ts        # SFMC SOAP API client
|   +-- utils/
|       |-- logger.ts          # Logging utility
|       |-- validator.ts       # Request validation
|       |-- soapBuilder.ts     # SOAP XML builder
|       +-- soapParser.ts      # SOAP response parser
|-- samples/                   # Sample payload files
|-- postman/                   # Postman collection
|-- dist/                      # Compiled JavaScript (after build)
|-- package.json
|-- tsconfig.json
|-- .env.example
+-- README.md
```

## Security

| Feature | Description |
|---------|-------------|
| HMAC-SHA256 Signature | Verifies Interakt webhook authenticity |
| Helmet.js | Sets secure HTTP headers |
| Rate Limiting | 100-200 requests/min per IP |
| Token Caching | Secure in-memory token storage |
| XML Escaping | Prevents XML injection in SOAP payloads |
| Input Validation | Validates all required fields |
| Timing-Safe Comparison | Prevents timing attacks on signature verification |

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Token refresh failing | Check SFMC credentials (client_id, client_secret, account_id) |
| SOAP errors | Verify Data Extension customer key and field names |
| Validation errors | Check request body has all required fields |
| Signature verification failed | Ensure INTERAKT_SECRET matches Interakt dashboard |
| Rate limit exceeded | Reduce request frequency or increase limit |

### Debug Mode

```bash
LOG_LEVEL=DEBUG npm run dev
```

### View SFMC Token Status

```bash
curl http://localhost:1112/health
```

Check the `sfmcToken` section in the response.

## Dependencies

| Package             | Purpose                              |
|---------------------|--------------------------------------|
| express             | Web framework                        |
| axios               | HTTP client for SFMC API             |
| helmet              | Security headers                     |
| express-rate-limit  | Rate limiting                        |
| xml2js              | XML parsing                          |
| dotenv              | Environment variables                |
| typescript          | TypeScript compiler                  |
| ts-node-dev         | Development server with hot reload   |

## License

ISC

## References

- [Interakt Webhooks Documentation](https://www.interakt.shop/resource-center/interakts-webhooks/)
- [SFMC SOAP API Documentation](https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/web-service-guide.html)
