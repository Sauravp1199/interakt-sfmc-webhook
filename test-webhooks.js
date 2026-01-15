#!/usr/bin/env node
/**
 * Integration test script for webhook signature validation
 * 
 * Tests all edge cases and error scenarios
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const BASE_URL = 'http://localhost:1112';
const SECRET = 'local_interakt_secret_2026';

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function generateSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(JSON.stringify(payload)).digest('hex');
    return digest;
}

async function makeRequest(path, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const tests = [
    {
        name: 'Health Check',
        async run() {
            const response = await makeRequest('/health');
            return response.status === 200 && response.data.status === 'healthy';
        }
    },
    {
        name: 'Valid Webhook with Signature',
        async run() {
            const payload = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                type: 'message_api_sent',
                data: {
                    customer: { id: 'test_valid_sig', channel_phone_number: '919876543210' },
                    message: { id: 'msg_valid_' + Date.now(), message_status: 'Sent' }
                }
            };
            const signature = generateSignature(payload, SECRET);
            const response = await makeRequest('/webhook/interakt', 'POST', payload, {
                'x-interakt-signature': signature
            });
            return response.status === 200 && response.data.success === true;
        }
    },
    {
        name: 'Invalid Signature',
        async run() {
            const payload = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                type: 'message_api_sent',
                data: {
                    customer: { id: 'test_invalid_sig' },
                    message: { id: 'msg_invalid_' + Date.now() }
                }
            };
            const response = await makeRequest('/webhook/interakt', 'POST', payload, {
                'x-interakt-signature': 'invalid_signature_12345'
            });
            return response.status === 401 && response.data.error.toLowerCase().includes('signature');
        }
    },
    {
        name: 'Missing Type Field',
        async run() {
            const payload = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                data: { customer: { id: 'test' } }
            };
            const response = await makeRequest('/webhook/interakt', 'POST', payload);
            return response.status === 400 && response.data.details?.type === 'missing';
        }
    },
    {
        name: 'Missing Data Field',
        async run() {
            const payload = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                type: 'message_api_sent'
            };
            const response = await makeRequest('/webhook/interakt', 'POST', payload);
            return response.status === 400 && response.data.details?.data === 'missing';
        }
    },
    {
        name: 'Webhook without Signature (Dev Mode)',
        async run() {
            const payload = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                type: 'message_api_sent',
                data: {
                    customer: { id: 'test_no_sig' },
                    message: { id: 'msg_no_sig_' + Date.now() }
                }
            };
            const response = await makeRequest('/webhook/interakt', 'POST', payload);
            // In dev mode, should succeed (200 OK)
            // Accept either first-time success or already processed
            if (response.status !== 200) return false;
            return response.data.success === true || response.data.message === 'Already processed';
        }
    },
    {
        name: 'Valid Webhook with Boolean Trait',
        async run() {
            const payload = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                type: 'message_received',
                data: {
                    customer: {
                        id: 'test_bool_' + Date.now(),
                        traits: { whatsapp_opted_in: true }
                    },
                    message: { id: 'msg_bool_' + Date.now() }
                }
            };
            const signature = generateSignature(payload, SECRET);
            const response = await makeRequest('/webhook/interakt', 'POST', payload, {
                'x-interakt-signature': signature
            });
            return response.status === 200 && response.data.success === true;
        }
    }
];

async function runTests() {
    log('\n' + '='.repeat(70), colors.blue);
    log('  Webhook Signature Validation - Integration Tests', colors.blue);
    log('='.repeat(70) + '\n', colors.blue);

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            process.stdout.write(`Testing: ${test.name}... `);
            const result = await test.run();
            if (result) {
                log('✓ PASS', colors.green);
                passed++;
            } else {
                log('✗ FAIL', colors.red);
                failed++;
            }
        } catch (error) {
            log(`✗ ERROR: ${error.message}`, colors.red);
            failed++;
        }
    }

    log('\n' + '='.repeat(70), colors.blue);
    log(`Results: ${passed} passed, ${failed} failed`, passed === tests.length ? colors.green : colors.yellow);
    log('='.repeat(70) + '\n', colors.blue);

    process.exit(failed > 0 ? 1 : 0);
}

// Check if server is running
async function checkServer() {
    try {
        const response = await makeRequest('/health');
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

async function main() {
    const serverRunning = await checkServer();
    if (!serverRunning) {
        log('Error: Server is not running on ' + BASE_URL, colors.red);
        log('Start the server with: node server.js', colors.yellow);
        process.exit(1);
    }

    await runTests();
}

if (require.main === module) {
    main();
}

module.exports = { runTests, makeRequest, generateSignature };
