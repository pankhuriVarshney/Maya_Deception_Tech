"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketHandler = void 0;
const ws_1 = require("ws");
const DashboardService_1 = require("../services/DashboardService");
const logger_1 = require("../utils/logger");
class WebSocketHandler {
    constructor(server, crdtSync) {
        this.clients = new Set();
        this.wss = new ws_1.WebSocketServer({ server, path: '/ws' });
        this.crdtSync = crdtSync;
        this.dashboardService = new DashboardService_1.DashboardService();
        this.setupWebSocket();
        this.setupEventListeners();
    }
    setupWebSocket() {
        this.wss.on('connection', async (ws) => {
            logger_1.logger.info('New WebSocket client connected');
            this.clients.add(ws);
            try {
                // Fetch all data for initial state
                const [stats, activeAttackers] = await Promise.all([
                    this.dashboardService.getDashboardStats(),
                    this.getActiveAttackers()
                ]);
                // Send INITIAL_STATE with data
                ws.send(JSON.stringify({
                    type: 'INITIAL_STATE',
                    data: {
                        stats,
                        activeAttackers,
                        // Include other data as needed
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            catch (error) {
                logger_1.logger.error('Error sending initial state:', error);
            }
            try {
                const [stats, activeAttackers, timeline, mitreMatrix, lateralMovement, commands, behavior, incidents] = await Promise.all([
                    this.dashboardService.getDashboardStats(),
                    this.getActiveAttackers(),
                    this.dashboardService.getAttackTimeline(undefined, 24),
                    this.dashboardService.getMitreMatrix(),
                    this.dashboardService.getLateralMovementGraph(),
                    this.dashboardService.getCommandActivity(undefined, 10),
                    this.dashboardService.getAttackerBehaviorAnalysis(),
                    this.dashboardService.getIncidentSummary()
                ]);
                ws.send(JSON.stringify({
                    type: 'INITIAL_STATE',
                    data: { stats, activeAttackers, timeline, mitreMatrix, lateralMovement, commands, behavior, incidents },
                    timestamp: new Date().toISOString()
                }));
            }
            catch (error) {
                logger_1.logger.error('Error sending initial state:', error);
            }
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    await this.handleMessage(ws, data);
                }
                catch (error) {
                    logger_1.logger.error('WebSocket message error:', error);
                }
            });
            ws.on('close', () => {
                logger_1.logger.info('WebSocket client disconnected');
                this.clients.delete(ws);
            });
            ws.on('error', (error) => {
                logger_1.logger.error('WebSocket error:', error);
                this.clients.delete(ws);
            });
        });
    }
    setupEventListeners() {
        this.crdtSync.on('newEvent', async (event) => {
            logger_1.logger.info(`WebSocket broadcasting NEW_EVENT: ${event.eventId}`);
            this.broadcast({ type: 'NEW_EVENT', data: event, timestamp: new Date().toISOString() });
        });
        this.crdtSync.on('attackerUpdated', async (attacker) => {
            logger_1.logger.info(`WebSocket broadcasting ATTACKER_UPDATED: ${attacker.attackerId}`);
            this.broadcast({ type: 'ATTACKER_UPDATED', data: attacker, timestamp: new Date().toISOString() });
            // Also broadcast updated stats
            const stats = await this.dashboardService.getDashboardStats();
            this.broadcast({ type: 'STATS_UPDATED', data: stats, timestamp: new Date().toISOString() });
        });
        this.crdtSync.on('syncComplete', async (syncData) => {
            try {
                logger_1.logger.info(`WebSocket broadcasting SYNC_COMPLETE: ${JSON.stringify(syncData)}`);
                const [stats, activeAttackers] = await Promise.all([
                    this.dashboardService.getDashboardStats(),
                    this.getActiveAttackers()
                ]);
                this.broadcast({
                    type: 'SYNC_COMPLETE',
                    data: {
                        stats,
                        activeAttackers,
                        syncData
                    },
                    timestamp: new Date().toISOString()
                });
            }
            catch (error) {
                logger_1.logger.error('Error broadcasting sync complete:', error);
            }
        });
    }
    async handleMessage(ws, data) {
        switch (data.action) {
            case 'GET_ATTACKER_PROFILE':
                const profile = await this.dashboardService.getAttackerProfile(data.attackerId);
                ws.send(JSON.stringify({ type: 'ATTACKER_PROFILE', data: profile, timestamp: new Date().toISOString() }));
                break;
            case 'GET_TIMELINE':
                const timeline = await this.dashboardService.getAttackTimeline(data.attackerId, data.hours || 24);
                ws.send(JSON.stringify({ type: 'TIMELINE_UPDATED', data: timeline, timestamp: new Date().toISOString() }));
                break;
            case 'GET_MITRE_MATRIX':
                const matrix = await this.dashboardService.getMitreMatrix(data.attackerId);
                ws.send(JSON.stringify({ type: 'MITRE_MATRIX_UPDATED', data: matrix, timestamp: new Date().toISOString() }));
                break;
            case 'TRIGGER_SYNC':
                await this.crdtSync.performSync();
                ws.send(JSON.stringify({ type: 'SYNC_TRIGGERED', message: 'Manual sync completed', timestamp: new Date().toISOString() }));
                break;
            default:
                ws.send(JSON.stringify({ type: 'ERROR', message: `Unknown action: ${data.action}`, timestamp: new Date().toISOString() }));
        }
    }
    async getActiveAttackers() {
        const { Attacker } = require('../models');
        return await Attacker.find({ status: 'Active' }).sort({ lastSeen: -1 }).limit(20).lean();
    }
    broadcast(message) {
        const messageStr = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }
    getClientCount() {
        return this.clients.size;
    }
}
exports.WebSocketHandler = WebSocketHandler;
//# sourceMappingURL=WebSocketHandler.js.map