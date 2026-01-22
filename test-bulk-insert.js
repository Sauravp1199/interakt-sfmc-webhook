#!/usr/bin/env node

/**
 * Bulk Insert Test Script
 *
 * This script generates test webhook data and sends it to your local/remote server
 * for testing 100K+ record inserts
 *
 * Usage:
 *   node test-bulk-insert.js [recordCount] [webhookType] [serverUrl]
 *
 * Examples:
 *   node test-bulk-insert.js 1000 MESSAGE_API_SENT http://localhost:1112
 *   node test-bulk-insert.js 100000 DELIVERED http://localhost:1112
 */

const axios = require('axios');
const crypto = require('crypto');

// Command-line arguments
const recordCount = parseInt(process.argv[2]) || 1000;
const webhookType = process.argv[3] || 'MESSAGE_API_SENT';
const serverUrl = process.argv[4] || 'http://localhost:1112';

// Configuration
const BATCH_SIZE = 100; // Send 100 records per webhook call
const REQUEST_DELAY = 10; // 10ms delay between requests (to avoid overwhelming server)

console.log('\n📊 BULK INSERT TEST SCRIPT');
console.log('='.repeat(60));
console.log(`Records to Insert: ${recordCount.toLocaleString()}`);
console.log(`Webhook Type: ${webhookType}`);
console.log(`Server URL: ${serverUrl}`);
console.log(`Batch Size: ${BATCH_SIZE} records per webhook`);
console.log(`Total Webhook Calls: ${Math.ceil(recordCount / BATCH_SIZE)}`);
console.log('='.repeat(60));

// Generate test phone number
function generatePhoneNumber() {
    return '+91' + Math.floor(Math.random() * 9000000000 + 1000000000);
}

// Generate test customer ID
function generateCustomerId() {
    return crypto.randomBytes(4).toString('hex');
}

// Generate test webhook payload
function generateWebhookRecord(index) {
    const customerId = generateCustomerId();
    const phoneNumber = generatePhoneNumber();

    const basePayload = {
        data_customer_id: `CUST_${customerId}_${index}`,
        phone_number: phoneNumber,
        message_id: `msg_${crypto.randomBytes(6).toString('hex')}_${index}`,
        timestamp: new Date().toISOString(),
        source: 'webhook_test',
        batch_index: index
    };

    // Add type-specific fields
    switch (webhookType) {
        case 'MESSAGE_API_SENT':
            return {
                ...basePayload,
                event_type: 'MESSAGE_API_SENT',
                status: 'sent',
                direction: 'outbound'
            };
        case 'DELIVERED':
            return {
                ...basePayload,
                event_type: 'DELIVERED',
                status: 'delivered',
                delivery_time: new Date().toISOString()
            };
        case 'READ':
            return {
                ...basePayload,
                event_type: 'READ',
                status: 'read',
                read_time: new Date().toISOString()
            };
        case 'FAILED':
            return {
                ...basePayload,
                event_type: 'FAILED',
                status: 'failed',
                failure_reason: 'Test failure',
                error_code: '400'
            };
        default:
            return basePayload;
    }
}

// Send webhook batch
async function sendWebhookBatch(startIndex, batchSize) {
    const records = [];
    for (let i = 0; i < batchSize; i++) {
        records.push(generateWebhookRecord(startIndex + i));
    }

    const payload = {
        event_type: webhookType,
        records: records,
        timestamp: new Date().toISOString()
    };

    try {
        const response = await axios.post(
            `${serverUrl}/webhook/interakt`,
            payload,
            { timeout: 30000 }
        );

        return {
            success: true,
            recordsSent: records.length,
            statusCode: response.status,
            response: response.data
        };
    } catch (error) {
        return {
            success: false,
            recordsSent: records.length,
            error: error.message,
            statusCode: error.response?.status
        };
    }
}

// Main execution
async function runBulkInsertTest() {
    const startTime = Date.now();
    let totalSent = 0;
    let totalSuccess = 0;
    let totalErrors = 0;

    const totalBatches = Math.ceil(recordCount / BATCH_SIZE);

    console.log('\n🚀 Starting bulk insert test...\n');

    for (let batch = 0; batch < totalBatches; batch++) {
        const startIndex = batch * BATCH_SIZE;
        const remainingRecords = recordCount - startIndex;
        const currentBatchSize = Math.min(BATCH_SIZE, remainingRecords);

        const result = await sendWebhookBatch(startIndex, currentBatchSize);

        totalSent += result.recordsSent;

        if (result.success) {
            totalSuccess += currentBatchSize;
            const progress = ((totalSent / recordCount) * 100).toFixed(1);
            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const recordsPerSecond = (totalSent / elapsedTime).toFixed(0);

            console.log(
                `✓ Batch ${batch + 1}/${totalBatches} | ` +
                `Sent: ${totalSent.toLocaleString()}/${recordCount.toLocaleString()} | ` +
                `Progress: ${progress}% | ` +
                `Rate: ${recordsPerSecond} rec/sec`
            );
        } else {
            totalErrors++;
            console.log(
                `✗ Batch ${batch + 1}/${totalBatches} | ` +
                `Error: ${result.error} (${result.statusCode})`
            );
        }

        // Delay to avoid overwhelming the server
        if (batch < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
        }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgThroughput = (recordCount / totalTime).toFixed(0);

    console.log('\n' + '='.repeat(60));
    console.log('📈 TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Records Sent: ${totalSent.toLocaleString()}`);
    console.log(`Successful Batches: ${totalSuccess / BATCH_SIZE}`);
    console.log(`Failed Batches: ${totalErrors}`);
    console.log(`Total Time: ${totalTime} seconds`);
    console.log(`Average Throughput: ${avgThroughput} records/second`);
    console.log(`\nExpected insert time: ~${(recordCount / 3000).toFixed(1)} minutes (with optimized config)`);
    console.log('='.repeat(60));

    // Next steps
    console.log('\n📋 NEXT STEPS:');
    console.log('1. Monitor logs: tail -f logs/combined.log');
    console.log('2. Check queue status: curl http://localhost:1112/logs/status');
    console.log('3. Verify records in SFMC data extension');
    console.log('4. Monitor CPU/Memory usage during processing');
}

// Run the test
runBulkInsertTest().catch(error => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
});
