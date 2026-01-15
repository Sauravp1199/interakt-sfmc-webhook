#!/usr/bin/env node
/**
 * Utility to generate HMAC-SHA256 signatures for Interakt webhook testing
 * 
 * Usage:
 *   node utils/generate-signature.js <secret> <json-file-path>
 *   node utils/generate-signature.js local_interakt_secret_2026 samples/webhook-message-sent.json
 * 
 * Or pass JSON directly:
 *   echo '{"type":"test","data":{}}' | node utils/generate-signature.js local_interakt_secret_2026
 */

const crypto = require('crypto');
const fs = require('fs');

function generateSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(JSON.stringify(payload)).digest('hex');
    return digest;
}

function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Error: Missing secret argument');
        console.error('');
        console.error('Usage:');
        console.error('  node utils/generate-signature.js <secret> [json-file-path]');
        console.error('');
        console.error('Examples:');
        console.error('  node utils/generate-signature.js local_interakt_secret_2026 samples/webhook-message-sent.json');
        console.error('  echo \'{"type":"test","data":{}}\' | node utils/generate-signature.js local_interakt_secret_2026');
        process.exit(1);
    }

    const secret = args[0];
    let payload;

    if (args.length >= 2) {
        // Read from file
        const filePath = args[1];
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            payload = JSON.parse(fileContent);
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error.message);
            process.exit(1);
        }
    } else {
        // Read from stdin asynchronously
        try {
            // Check if stdin is available (not a TTY)
            if (process.stdin.isTTY) {
                console.error('Error: No input provided');
                console.error('Provide JSON via stdin or as a file path argument');
                process.exit(1);
            }
            
            const stdinBuffer = fs.readFileSync(0, 'utf-8');
            if (!stdinBuffer.trim()) {
                console.error('Error: No input provided');
                console.error('Provide JSON via stdin or as a file path argument');
                process.exit(1);
            }
            payload = JSON.parse(stdinBuffer);
        } catch (error) {
            if (error.code === 'EAGAIN' || error.message.includes('stdin')) {
                console.error('Error: Failed to read from stdin');
                console.error('Provide JSON via stdin or as a file path argument');
            } else {
                console.error('Error parsing JSON from stdin:', error.message);
            }
            process.exit(1);
        }
    }

    const signature = generateSignature(payload, secret);
    
    console.log('');
    console.log('='.repeat(70));
    console.log('  HMAC-SHA256 Signature Generator for Interakt Webhooks');
    console.log('='.repeat(70));
    console.log('');
    console.log('Secret:    ', secret);
    console.log('Payload:   ', JSON.stringify(payload, null, 2).substring(0, 100) + '...');
    console.log('');
    console.log('Generated Signature:');
    console.log('  ', signature);
    console.log('');
    console.log('With sha256= prefix:');
    console.log('  ', 'sha256=' + signature);
    console.log('');
    console.log('Use this signature in the "x-interakt-signature" header');
    console.log('='.repeat(70));
    console.log('');
}

if (require.main === module) {
    main();
}

module.exports = { generateSignature };
