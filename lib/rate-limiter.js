/**
 * Rate Limiter - Token Bucket Algorithm
 *
 * Implements Salesforce Marketing Cloud API rate limiting:
 * - 2,500 requests per minute (41.67 requests/second)
 * - 100 concurrent connections
 * - Respects Retry-After headers
 *
 * Uses token bucket algorithm for smooth rate limiting
 */

const logger = require('../utils/logger');

class RateLimiter {
    /**
     * Initialize rate limiter
     * @param {Object} options - Configuration
     * @param {number} options.requestsPerMinute - Requests per minute limit (default: 2500)
     * @param {number} options.maxConcurrent - Max concurrent requests (default: 50)
     * @param {number} options.rateLimitBuffer - Start throttling at this % of limit (default: 0.8)
     */
    constructor(options = {}) {
        this.requestsPerMinute = options.requestsPerMinute || 2500;
        this.maxConcurrent = options.maxConcurrent || 50;
        this.rateLimitBuffer = options.rateLimitBuffer || 0.8;

        // Token bucket parameters
        this.tokensPerSecond = this.requestsPerMinute / 60; // ~41.67 tokens/sec
        this.tokens = this.tokensPerSecond; // Start with full bucket
        this.maxTokens = this.tokensPerSecond * 60; // Max 60 seconds worth
        this.lastRefillTime = Date.now();

        // Concurrent request tracking
        this.currentConcurrent = 0;
        this.concurrentQueue = [];

        // Rate limit info for monitoring
        this.rateLimitInfo = {
            requestsThisMinute: 0,
            windowStart: Date.now(),
            retryAfterTime: null,
        };

        // Start token refill interval
        this.refillInterval = setInterval(() => this.refillTokens(), 100);

        logger.info('Rate Limiter initialized', {
            requestsPerMinute: this.requestsPerMinute,
            tokensPerSecond: this.tokensPerSecond.toFixed(2),
            maxConcurrent: this.maxConcurrent,
            rateLimitBuffer: (this.rateLimitBuffer * 100).toFixed(0) + '%',
        });
    }

    /**
     * Refill tokens based on elapsed time
     */
    refillTokens() {
        const now = Date.now();
        const elapsedSeconds = (now - this.lastRefillTime) / 1000;
        const tokensToAdd = elapsedSeconds * this.tokensPerSecond;

        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefillTime = now;

        // Reset minute counter every 60 seconds
        if (now - this.rateLimitInfo.windowStart >= 60000) {
            this.rateLimitInfo.requestsThisMinute = 0;
            this.rateLimitInfo.windowStart = now;
        }
    }

    /**
     * Calculate wait time needed before making a request
     * @returns {number} - Milliseconds to wait (0 if can proceed immediately)
     */
    calculateWaitTime() {
        // Check if we're in rate-limit retry period
        if (this.rateLimitInfo.retryAfterTime) {
            const now = Date.now();
            if (now < this.rateLimitInfo.retryAfterTime) {
                return this.rateLimitInfo.retryAfterTime - now;
            }
            this.rateLimitInfo.retryAfterTime = null;
        }

        // Check if at concurrent limit
        if (this.currentConcurrent >= this.maxConcurrent) {
            return 500; // Wait 500ms if at concurrent limit
        }

        // Check tokens
        if (this.tokens < 1) {
            // How long until we have 1 token?
            const tokensNeeded = 1 - this.tokens;
            const waitSeconds = tokensNeeded / this.tokensPerSecond;
            return Math.ceil(waitSeconds * 1000);
        }

        // Check if approaching rate limit (use buffer threshold)
        const limitThreshold = this.maxTokens * this.rateLimitBuffer;
        if (this.tokens < limitThreshold) {
            // Apply gentle throttling as we approach limit
            const utilizationPercent = 1 - (this.tokens / this.maxTokens);
            const throttleMs = utilizationPercent * 100; // 0-100ms throttle
            return Math.ceil(throttleMs);
        }

        return 0; // Can proceed immediately
    }

    /**
     * Wait until rate limit allows request
     * @returns {Promise<void>}
     */
    async waitIfNeeded() {
        const waitTime = this.calculateWaitTime();
        if (waitTime > 0) {
            logger.debug('Rate limit: waiting', {
                waitMs: waitTime,
                tokens: this.tokens.toFixed(2),
                concurrent: this.currentConcurrent,
            });
            await this.sleep(waitTime);
        }
    }

    /**
     * Acquire rate limit slot and track concurrent request
     * @returns {Promise<void>}
     */
    async acquire() {
        await this.waitIfNeeded();

        // Consume token
        if (this.tokens > 0) {
            this.tokens--;
        }

        this.currentConcurrent++;
        this.rateLimitInfo.requestsThisMinute++;

        logger.debug('Rate limit acquired', {
            tokens: this.tokens.toFixed(2),
            concurrent: this.currentConcurrent,
            requestsThisMinute: this.rateLimitInfo.requestsThisMinute,
        });
    }

    /**
     * Release rate limit slot
     * @param {Object} options - Additional options
     * @param {number} options.retryAfterSeconds - Seconds to wait before next request
     */
    release(options = {}) {
        this.currentConcurrent = Math.max(0, this.currentConcurrent - 1);

        // Handle Retry-After header
        if (options.retryAfterSeconds) {
            this.rateLimitInfo.retryAfterTime = Date.now() + options.retryAfterSeconds * 1000;
            logger.warn('Rate limit: Retry-After received', {
                retryAfterSeconds: options.retryAfterSeconds,
                concurrent: this.currentConcurrent,
            });
        }

        logger.debug('Rate limit released', {
            concurrent: this.currentConcurrent,
        });
    }

    /**
     * Check if rate-limited based on response
     * @param {Object} response - Axios response object
     * @returns {Object} - { isRateLimited: boolean, retryAfterSeconds: number }
     */
    checkRateLimitResponse(response) {
        const isRateLimited = response.status === 429;

        if (isRateLimited) {
            // Try to extract Retry-After header
            let retryAfterSeconds = 60; // Default 60 seconds

            const retryAfterHeader = response.headers['retry-after'];
            if (retryAfterHeader) {
                // Can be seconds or HTTP date
                const parsed = parseInt(retryAfterHeader, 10);
                if (!isNaN(parsed)) {
                    retryAfterSeconds = parsed;
                }
            }

            logger.warn('Rate limit detected (429)', {
                retryAfterSeconds,
                url: response.config?.url,
            });

            this.rateLimitInfo.retryAfterTime = Date.now() + retryAfterSeconds * 1000;

            return {
                isRateLimited: true,
                retryAfterSeconds,
            };
        }

        return {
            isRateLimited: false,
            retryAfterSeconds: 0,
        };
    }

    /**
     * Get current rate limit status
     * @returns {Object} - Status info
     */
    getStatus() {
        const utilizationPercent = ((this.maxTokens - this.tokens) / this.maxTokens) * 100;

        return {
            tokens: this.tokens.toFixed(2),
            maxTokens: this.maxTokens.toFixed(2),
            tokensPerSecond: this.tokensPerSecond.toFixed(2),
            utilizationPercent: utilizationPercent.toFixed(1),
            currentConcurrent: this.currentConcurrent,
            maxConcurrent: this.maxConcurrent,
            requestsThisMinute: this.rateLimitInfo.requestsThisMinute,
            retryAfterTime: this.rateLimitInfo.retryAfterTime
                ? new Date(this.rateLimitInfo.retryAfterTime).toISOString()
                : null,
        };
    }

    /**
     * Sleep utility
     * @param {number} ms - Milliseconds
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Destroy the rate limiter (clear intervals)
     */
    destroy() {
        if (this.refillInterval) {
            clearInterval(this.refillInterval);
            this.refillInterval = null;
        }
        logger.info('Rate Limiter destroyed');
    }
}

// Export singleton instance
let instance = null;

function getInstance(options) {
    if (!instance) {
        instance = new RateLimiter(options);
    }
    return instance;
}

function resetInstance() {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}

module.exports = {
    RateLimiter,
    getInstance,
    resetInstance,
};
