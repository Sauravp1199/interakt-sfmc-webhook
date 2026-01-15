# Changelog

## [Unreleased] - 2026-01-15

### Fixed
- Fixed "Invalid signature" errors in webhook endpoint POST /webhook/interakt
- Improved error messages for signature validation failures
- Enhanced validation for missing or malformed request headers and payloads

### Added
- **New**: Signature generation utility (`utils/generate-signature.js`) for testing
- **New**: Integration test suite (`test-webhooks.js`) with 7 comprehensive test cases
- **New**: Payload structure validation function in webhook handler
- **New**: Comprehensive testing documentation (`TESTING.md`)
- **New**: Implementation summary (`IMPLEMENTATION_SUMMARY.md`)
- **New**: Edge case test scenarios in Postman collection
- **New**: Pre-request script in Postman collection for automatic signature generation
- **New**: Test scripts in package.json (`npm test`)

### Changed
- Enhanced `verifySignature()` function with detailed, actionable error logging
- Improved webhook endpoint error responses with diagnostic details
- Updated Postman collection with automatic signature generation
- Enhanced `.gitignore` to exclude backup files

### Security
- All changes passed CodeQL security analysis (0 vulnerabilities)
- Signature verification remains mandatory in production mode
- Input validation strengthened to prevent malformed data processing

### Testing
- All 7 integration tests passing ✓
- Manual verification completed ✓
- Code review feedback addressed ✓
- Security scan passed ✓

### Documentation
- Added comprehensive testing guide with examples
- Documented signature generation process
- Added troubleshooting section for common errors
- Included cURL and Postman usage examples

### Breaking Changes
None - all changes are backward compatible

### Migration Notes
No migration required. The changes enhance existing functionality without breaking existing integrations.

---

## How to Use New Features

### Generate Signatures for Testing
```bash
node utils/generate-signature.js local_interakt_secret_2026 samples/webhook-message-sent.json
```

### Run Integration Tests
```bash
npm test
```

### Import Updated Postman Collection
The collection now includes automatic signature generation and edge case tests in the "Edge Cases & Error Scenarios" folder.

### See Complete Documentation
- [TESTING.md](TESTING.md) - Comprehensive testing guide
- [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - Full implementation details

