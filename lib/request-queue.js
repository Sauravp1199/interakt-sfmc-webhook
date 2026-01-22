/**
 * Request Queue Middleware
 *
 * Buffers incoming webhook requests and processes them sequentially
 * This prevents 429 rate limit errors by queuing requests instead of rejecting them
 */

const logger = require('../utils/logger');

class RequestQueue {
    constructor(options = {}) {
        this.queue = [];
        this.processing = false;
        this.concurrentLimit = options.concurrentLimit || 5; // Allow 5 concurrent requests
        this.activeRequests = 0;
        this.maxQueueSize = options.maxQueueSize || 1000;
        this.stats = {
            totalQueued: 0,
            totalProcessed: 0,
            totalRejected: 0,
            peakQueueSize: 0,
            currentQueueSize: 0
        };

        logger.info('Request Queue initialized', {
            concurrentLimit: this.concurrentLimit,
            maxQueueSize: this.maxQueueSize
        });
    }

    /**
     * Express middleware for queuing requests
     */
    middleware() {
        return async (req, res, next) => {
            // Only queue POST requests to /webhook/interakt
            if (req.method !== 'POST' || !req.path.includes('/webhook/interakt')) {
                return next();
            }

            // Check if queue is full
            if (this.queue.length >= this.maxQueueSize) {
                this.stats.totalRejected++;
                logger.error('Request queue is full, rejecting request', {
                    queueSize: this.queue.length,
                    totalRejected: this.stats.totalRejected
                });
                return res.status(503).json({
                    error: 'Service temporarily unavailable - queue full',
                    queueSize: this.queue.length
                });
            }

            // Add request to queue
            this.stats.totalQueued++;
            this.queue.push({ req, res, next });
            this.stats.currentQueueSize = this.queue.length;

            if (this.queue.length > this.stats.peakQueueSize) {
                this.stats.peakQueueSize = this.queue.length;
            }

            logger.debug('Request queued', {
                queueLength: this.queue.length,
                activeRequests: this.activeRequests,
                totalQueued: this.stats.totalQueued
            });

            // Process queue
            this.processQueue();
        };
    }

    /**
     * Process queued requests concurrently
     */
    async processQueue() {
        if (this.processing) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0 && this.activeRequests < this.concurrentLimit) {
            const { req, res, next } = this.queue.shift();
            this.activeRequests++;
            this.stats.currentQueueSize = this.queue.length;

            // Process request asynchronously
            (async () => {
                try {
                    // Call next middleware
                    await new Promise((resolve) => {
                        // Wrap next to capture completion
                        const originalEnd = res.end;
                        res.end = function (...args) {
                            this.activeRequests--;
                            this.stats.totalProcessed++;
                            this.processQueue();
                            return originalEnd.apply(res, args);
                        }.bind(this);

                        next();
                    });
                } catch (error) {
                    logger.error('Error processing queued request', { error: error.message });
                    this.activeRequests--;
                    this.stats.totalProcessed++;
                    this.processQueue();
                }
            })();
        }

        this.processing = false;
    }

    /**
     * Get queue statistics
     */
    getStats() {
        return {
            ...this.stats,
            currentQueueSize: this.queue.length,
            activeRequests: this.activeRequests
        };
    }

    /**
     * Clear queue (for graceful shutdown)
     */
    clear() {
        this.queue = [];
        this.stats.currentQueueSize = 0;
    }
}

module.exports = RequestQueue;
