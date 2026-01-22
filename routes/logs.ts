/**
 * Logs Route
 * Provides endpoints to view and clear application logs
 *
 * Endpoints:
 * GET /logs/combined    - View all logs
 * GET /logs/error       - View error logs only
 * GET /logs/debug       - View debug logs only
 * POST /logs/clear      - Clear all log files
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';

const router = Router();

/**
 * GET /logs/combined
 * Returns all combined logs
 */
router.get('/combined', (req: Request, res: Response) => {
    try {
        const logsDir = logger.logsDir || path.join(__dirname, '../logs');
        const logFile = path.join(logsDir, 'combined.log');

        if (!fs.existsSync(logFile)) {
            return res.status(404).json({
                success: false,
                message: 'No logs found yet',
                logPath: logFile
            });
        }

        const logs = fs.readFileSync(logFile, 'utf8');
        const lines = logs.split('\n').filter(line => line.trim());

        res.status(200).json({
            success: true,
            totalLines: lines.length,
            logPath: logFile,
            logs: lines
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /logs/error
 * Returns error logs only
 */
router.get('/error', (req: Request, res: Response) => {
    try {
        const logsDir = logger.logsDir || path.join(__dirname, '../logs');
        const logFile = path.join(logsDir, 'error.log');

        if (!fs.existsSync(logFile)) {
            return res.status(404).json({
                success: false,
                message: 'No error logs found',
                logPath: logFile
            });
        }

        const logs = fs.readFileSync(logFile, 'utf8');
        const lines = logs.split('\n').filter(line => line.trim());

        res.status(200).json({
            success: true,
            totalLines: lines.length,
            logPath: logFile,
            logs: lines
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /logs/debug
 * Returns debug logs only
 */
router.get('/debug', (req: Request, res: Response) => {
    try {
        const logsDir = logger.logsDir || path.join(__dirname, '../logs');
        const logFile = path.join(logsDir, 'debug.log');

        if (!fs.existsSync(logFile)) {
            return res.status(404).json({
                success: false,
                message: 'No debug logs found',
                logPath: logFile
            });
        }

        const logs = fs.readFileSync(logFile, 'utf8');
        const lines = logs.split('\n').filter(line => line.trim());

        res.status(200).json({
            success: true,
            totalLines: lines.length,
            logPath: logFile,
            logs: lines
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /logs/last?count=100
 * Returns last N lines of combined logs
 */
router.get('/last', (req: Request, res: Response) => {
    try {
        const count = Math.min(parseInt(req.query.count as string) || 50, 1000);
        const logsDir = logger.logsDir || path.join(__dirname, '../logs');
        const logFile = path.join(logsDir, 'combined.log');

        if (!fs.existsSync(logFile)) {
            return res.status(404).json({
                success: false,
                message: 'No logs found yet'
            });
        }

        const logs = fs.readFileSync(logFile, 'utf8');
        const lines = logs.split('\n').filter(line => line.trim());
        const lastLines = lines.slice(-count);

        res.status(200).json({
            success: true,
            showing: lastLines.length,
            total: lines.length,
            logs: lastLines
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /logs/clear
 * Clears all log files
 */
router.post('/clear', (req: Request, res: Response) => {
    try {
        logger.clearLogs();
        res.status(200).json({
            success: true,
            message: 'All log files cleared successfully'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /logs/status
 * Returns log system status
 */
router.get('/status', (req: Request, res: Response) => {
    try {
        const logsDir = logger.logsDir || path.join(__dirname, '../logs');
        const combinedLog = path.join(logsDir, 'combined.log');
        const errorLog = path.join(logsDir, 'error.log');
        const debugLog = path.join(logsDir, 'debug.log');

        const getFileSize = (filePath: string) => {
            if (!fs.existsSync(filePath)) return 0;
            return fs.statSync(filePath).size;
        };

        res.status(200).json({
            success: true,
            enabled: logger.ENABLE_FILE_LOGGING,
            logsDirectory: logsDir,
            files: {
                combined: {
                    path: combinedLog,
                    exists: fs.existsSync(combinedLog),
                    sizeBytes: getFileSize(combinedLog),
                    sizeMB: (getFileSize(combinedLog) / 1024 / 1024).toFixed(2)
                },
                error: {
                    path: errorLog,
                    exists: fs.existsSync(errorLog),
                    sizeBytes: getFileSize(errorLog),
                    sizeMB: (getFileSize(errorLog) / 1024 / 1024).toFixed(2)
                },
                debug: {
                    path: debugLog,
                    exists: fs.existsSync(debugLog),
                    sizeBytes: getFileSize(debugLog),
                    sizeMB: (getFileSize(debugLog) / 1024 / 1024).toFixed(2)
                }
            }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
