# Interakt SFMC Webhook Integration

Production-ready Node.js webhook receiver that integrates Interakt (WhatsApp messaging platform) with Salesforce Marketing Cloud (SFMC) Data Extensions.

## Features

✅ **Real-time Data Sync** - Webhook events streamed to SFMC immediately
✅ **15 Webhook Types** - Message status, interactions, account events, template events
✅ **Batch Processing** - Intelligent batching (1000 records, 3-second smart timeout)
✅ **Rate Limiting** - 2500 req/min, 50 concurrent with automatic backoff
✅ **Error Handling** - Automatic retry with exponential backoff (max 5 retries)
✅ **SFMC UPSERT** - Unique `event_id` prevents duplicates
✅ **Signature Verification** - HMAC-SHA256 validation on all webhooks
✅ **Comprehensive Logging** - Separate logs for requests, errors, and debugging
✅ **Health Monitoring** - Real-time health check endpoint
✅ **Connection Pooling** - HTTP Keep-Alive for performance

## Quick Start

### Prerequisites
- Node.js 14+
- npm or yarn
- SFMC account with REST API credentials
- Interakt account with webhook access

### Installation

```bash
git clone <repo-url>
cd interakt-sfmc-webhook
npm install
cp .env.example .env
# Edit .env with your credentials
nano .env
```

### Environment Variables

```bash
# SFMC
SFMC_AUTH_BASE_URL=https://your-instance.auth.marketingcloudapis.com
SFMC_REST_BASE_URL=https://your-instance.rest.marketingcloudapis.com
SFMC_CLIENT_ID=your_client_id
SFMC_CLIENT_SECRET=your_client_secret
SFMC_ACCOUNT_ID=your_account_id
SFMC_DE_CUSTOMER_KEY=your-data-extension-key

# Webhook Signatures (dev/prod)
LOCAL_INTERAKT_SECRET=your-dev-secret
PROD_INTERAKT_SECRET=your-prod-secret

# Server
PORT=1112
NODE_ENV=development
LOG_LEVEL=info
ENABLE_FILE_LOGGING=true
```

### Running

```bash
npm start                           # Production
NODE_ENV=development npm start      # Development
ENABLE_FILE_LOGGING=true npm start  # With logging
```

## API Endpoints

### Webhook Receiver
**POST** `/webhook/interakt`

Receives Interakt webhook events. Requires HMAC-SHA256 signature validation.

**Headers**: `Content-Type: application/json`, `x-interakt-signature: sha256=<signature>`

### Health Check
**GET** `/health`

Returns system health status and token validity.

### Admin Endpoints
- **POST** `/admin/logs/clear` - Clear all log files
- **GET** `/admin/logs/:type` - Get logs (combined, error, debug, debug-requests)
- **GET** `/admin/status` - Detailed system status

## Webhook Types

**Message Events**: `message_api_sent`, `message_api_delivered`, `message_api_read`, `message_api_failed`, `message_api_clicked`, `message_received`

**Workflow**: `workflow_response_update`

**Account Events**: `account_alerts`, `account_update`, `account_review_update`, `business_capability_update`, `phone_number_quality_update`

**Template Events**: `template_performance_metrics`, `message_template_status_update`

## Data Mapping

Each webhook is flattened into 100+ fields:
- **Core**: `event_id` (primary key), `timestamp`, `type`, `version`
- **Customer** (30+): Customer UUID, phone number, traits
- **Message** (40+): Message UUID, delivery status, metadata
- **Full Payload**: Complete webhook JSON

## Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| Batch Size | 1000 | Max records per batch |
| Smart Timeout | 3s | Wait for 2+ records |
| Fallback Timeout | 30s | Absolute timeout |
| Rate Limit | 2500 req/min | SFMC API limit |
| Max Concurrent | 50 | Concurrent requests |
| Max Retries | 5 | Exponential backoff |

## Logging

**Log Files**:
- `logs/combined.log` - All logs (recommended)
- `logs/error.log` - Errors only
- `logs/debug.log` - Debug messages
- `logs/debug-requests.log` - Full request/response bodies

**Log Rotation**: Automatic at 10MB with timestamped backups

## Testing

```bash
# Health check
curl http://localhost:1112/health

# Sample webhook (calculate signature)
curl -X POST http://localhost:1112/webhook/interakt \
  -H "Content-Type: application/json" \
  -H "x-interakt-signature: sha256=<signature>" \
  -d '{...}'

# View logs
tail -f logs/combined.log
tail -f logs/debug-requests.log
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook not received | Check webhook URL in Interakt console, verify PORT is accessible |
| Records not in SFMC | Verify SFMC credentials, check Data Extension key, review logs/error.log |
| High error rate | Check SFMC rate limit, verify network, review SFMC API status |
| Authentication errors | Verify CLIENT_ID, CLIENT_SECRET, ACCOUNT_ID are correct |

## Monitoring

**Health Endpoint**: `GET /health` - Token status, rate limiter status, uptime

**Metrics to Monitor**:
- Webhook success rate (target: >99%)
- Batch processing latency (target: <5s)
- SFMC API errors (target: 0)
- Rate limit usage (target: <80%)

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_LEVEL=warn` or `error`
- [ ] Enable `ENABLE_FILE_LOGGING=true`
- [ ] Configure both `LOCAL_` and `PROD_` secrets
- [ ] Test with sample webhooks
- [ ] Monitor for 24 hours
- [ ] Set up log rotation/archiving
- [ ] Configure alerting
- [ ] Rotate webhook signatures quarterly
- [ ] Use separate credentials for dev/prod

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Webhook Latency | <100ms |
| Batch Size | 1,000 records |
| Batch Time | 2-5 seconds |
| Rate Limit | 2,500 req/min |
| Concurrent Requests | 50 max |
| Token Refresh | Every 19 minutes |

## Architecture

See [APPLICATION_FLOW.md](APPLICATION_FLOW.md) for detailed architecture, data flow, and complete field mapping.

## File Structure

```
interakt-sfmc-webhook/
├── lib/                   # Core application
│   ├── sfmc-client.js    # SFMC API client
│   ├── webhook-handler.js # Webhook processing
│   ├── queue.js          # Queue management
│   └── *.js              # Other utilities
├── src/
│   ├── routes/           # Express routes
│   ├── services/         # Business logic
│   ├── utils/            # Logging, validation
│   └── config.ts         # Configuration
├── utils/                # Global utilities
│   └── logger.js         # Logging system
├── logs/                 # Log files (runtime)
├── package.json          # Dependencies
├── .env.example          # Environment template
├── README.md             # This file
└── APPLICATION_FLOW.md   # Detailed architecture
```

## Security

- HMAC-SHA256 signature verification on all requests
- Secure token caching with automatic refresh
- Environment-based credential separation
- Input validation on all requests
- Connection pooling with keep-alive
- Rate limiting and request queuing

## License

Proprietary - Pidilite

## Support

1. Check logs: `logs/debug-requests.log` for API calls, `logs/error.log` for errors
2. Review [APPLICATION_FLOW.md](APPLICATION_FLOW.md) for complete architecture
3. Verify SFMC credentials and Data Extension schema
4. Contact: Dr Fixit Team
