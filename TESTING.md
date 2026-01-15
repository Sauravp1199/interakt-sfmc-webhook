# Webhook Signature Testing Guide

This guide explains how to test the Interakt webhook integration with proper signature validation.

## Overview

The webhook endpoint `/webhook/interakt` requires HMAC-SHA256 signature verification for security. The signature must be sent in the `x-interakt-signature` header.

## How Signatures Work

1. **Generate Signature**: Create an HMAC-SHA256 hash of the JSON request body using your webhook secret
2. **Send Header**: Include the signature in the `x-interakt-signature` header
3. **Verification**: The server verifies the signature matches before processing the webhook

## Signature Generation

### Using the Utility Script

We provide a utility script to generate signatures for testing:

```bash
# Generate signature for a sample file
node utils/generate-signature.js <secret> <json-file-path>

# Example:
node utils/generate-signature.js local_interakt_secret_2026 samples/webhook-message-sent.json

# Or pipe JSON directly:
echo '{"type":"test","data":{}}' | node utils/generate-signature.js local_interakt_secret_2026
```

### Manual Signature Generation

If you need to generate signatures programmatically:

```javascript
const crypto = require('crypto');

function generateSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(JSON.stringify(payload)).digest('hex');
    return digest;
}

// Example usage
const payload = { type: 'message_api_sent', data: { ... } };
const secret = 'local_interakt_secret_2026';
const signature = generateSignature(payload, secret);

// Use in request header
// x-interakt-signature: <signature>
```

## Testing with cURL

### Test with Valid Signature

```bash
# Generate signature
SIGNATURE=$(node utils/generate-signature.js local_interakt_secret_2026 samples/webhook-message-sent.json 2>&1 | grep "Generated Signature:" -A1 | tail -1 | xargs)

# Send request with signature
curl -X POST http://localhost:1112/webhook/interakt \
  -H "Content-Type: application/json" \
  -H "x-interakt-signature: $SIGNATURE" \
  -d @samples/webhook-message-sent.json
```

### Test with Invalid Signature

```bash
curl -X POST http://localhost:1112/webhook/interakt \
  -H "Content-Type: application/json" \
  -H "x-interakt-signature: invalid_signature_12345" \
  -d @samples/webhook-message-sent.json
```

Expected response (401):
```json
{
  "success": false,
  "error": "Invalid signature",
  "details": "Signature verification failed. Ensure INTERAKT_SECRET is correctly configured.",
  "requestId": "req_..."
}
```

### Test without Signature (Dev Mode)

In development mode, requests without signatures are allowed:

```bash
curl -X POST http://localhost:1112/webhook/interakt \
  -H "Content-Type: application/json" \
  -d @samples/webhook-message-sent.json
```

## Testing with Postman

The Postman collection includes automatic signature generation:

1. **Import Collection**: Import `postman/Interakt-SFMC-Webhook.postman_collection.json`
2. **Set Variables**: 
   - `base_url`: http://localhost:1112
   - `webhook_secret`: local_interakt_secret_2026
3. **Run Requests**: The collection automatically generates signatures for webhook requests

### Test Folders

- **Webhooks - Message Status**: Valid webhook examples
- **Webhooks - Interactions**: Button clicks, incoming messages, workflows
- **Webhooks - Account Events**: Account-level notifications
- **Webhooks - Template Events**: Template-related events
- **Edge Cases & Error Scenarios**: Test error handling

## Environment Modes

### Development Mode
- `NODE_ENV=development` or `NODE_ENV=local` or not set
- Allows requests without signatures
- Uses `LOCAL_INTERAKT_SECRET` if set

### Production Mode
- `NODE_ENV=production`
- Requires valid signatures
- Uses `INTERAKT_SECRET`

## Common Error Scenarios

### Missing Signature Header (Production)
```json
{
  "success": false,
  "error": "Missing signature",
  "details": "x-interakt-signature header is required",
  "requestId": "req_..."
}
```

### Invalid Signature
```json
{
  "success": false,
  "error": "Invalid signature",
  "details": "Signature verification failed...",
  "requestId": "req_..."
}
```

### Missing Required Fields
```json
{
  "success": false,
  "error": "Invalid payload: missing required fields",
  "details": {
    "type": "missing",
    "data": "present"
  },
  "requestId": "req_..."
}
```

### Malformed JSON
```json
{
  "error": "Internal server error"
}
```

## Validation Rules

The webhook handler validates:

1. **Required Fields**:
   - `type`: Must be a non-empty string
   - `data`: Must be an object

2. **Data Types**:
   - `data.customer.traits.whatsapp_opted_in`: Must be boolean if present
   - `timestamp`: Must be valid ISO 8601 date if present

3. **Signature**:
   - Must be valid HMAC-SHA256 of the request body
   - Can include optional `sha256=` prefix

## Troubleshooting

### Signature Mismatch

If you get signature validation errors:

1. **Check Secret**: Ensure `LOCAL_INTERAKT_SECRET` or `INTERAKT_SECRET` matches
2. **Check JSON**: The signature is computed on the exact JSON string (whitespace matters)
3. **Check Encoding**: Use UTF-8 encoding
4. **Check Order**: JSON keys order might matter - use `JSON.stringify()`

### Debug Mode

Set `LOG_LEVEL=DEBUG` in `.env` to see detailed signature verification logs:

```bash
LOG_LEVEL=DEBUG node server.js
```

## Example Webhook Payloads

See the `samples/` directory for example payloads:

- `webhook-message-sent.json` - Message sent event
- `webhook-message-delivered.json` - Message delivered event
- `webhook-message-failed.json` - Message failed event
- `webhook-incoming-message.json` - Incoming customer message
- `webhook-button-click.json` - Button click event
- `webhook-workflow-response.json` - Workflow response event

## Security Best Practices

1. **Never commit secrets** to version control
2. **Use environment variables** for secrets
3. **Rotate secrets regularly** in production
4. **Verify signatures** on all webhook endpoints
5. **Use HTTPS** in production
6. **Rate limit** webhook endpoints
7. **Validate all input** before processing

## Additional Resources

- [Interakt Webhook Documentation](https://developers.interakt.ai/)
- [HMAC-SHA256 RFC](https://tools.ietf.org/html/rfc2104)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
