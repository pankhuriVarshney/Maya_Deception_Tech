import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { CRDTSyncService } from '../services/CRDTSyncService';
import { DashboardService } from '../services/DashboardService';
import { logger } from '../utils/logger';

export class WebSocketHandler {
  private wss: WebSocketServer;
  private crdtSync: CRDTSyncService;
  private dashboardService: DashboardService;
  private clients: Set<WebSocket> = new Set();

  constructor(server: Server, crdtSync: CRDTSyncService) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.crdtSync = crdtSync;
    this.dashboardService = new DashboardService();
    this.setupWebSocket();
    this.setupEventListeners();
  }

  private setupWebSocket() {
    this.wss.on('connection', async (ws: WebSocket) => {
      logger.info('New WebSocket client connected');
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
      } catch (error) {
        logger.error('Error sending initial state:', error);
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
      } catch (error) {
        logger.error('Error sending initial state:', error);
      }

      ws.on('message', async (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          await this.handleMessage(ws, data);
        } catch (error) {
          logger.error('WebSocket message error:', error);
        }
      });

      ws.on('close', () => {
        logger.info('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  private setupEventListeners() {
    this.crdtSync.on('newEvent', async (event) => {
      logger.info(`WebSocket broadcasting NEW_EVENT: ${event.eventId}`);
      this.broadcast({ type: 'NEW_EVENT', data: event, timestamp: new Date().toISOString() });
    });

    this.crdtSync.on('attackerUpdated', async (attacker) => {
      logger.info(`WebSocket broadcasting ATTACKER_UPDATED: ${attacker.attackerId}`);
      this.broadcast({ type: 'ATTACKER_UPDATED', data: attacker, timestamp: new Date().toISOString() });
      
      // Also broadcast updated stats
      const stats = await this.dashboardService.getDashboardStats();
      this.broadcast({ type: 'STATS_UPDATED', data: stats, timestamp: new Date().toISOString() });
    });

    this.crdtSync.on('syncComplete', async (syncData) => {
      try {
        logger.info(`WebSocket broadcasting SYNC_COMPLETE: ${JSON.stringify(syncData)}`);
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
      } catch (error) {
        logger.error('Error broadcasting sync complete:', error);
      }
    });
  }

  private async handleMessage(ws: WebSocket, data: any) {
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

  private async getActiveAttackers() {
    const { Attacker } = require('../models');
    return await Attacker.find({ status: 'Active' }).sort({ lastSeen: -1 }).limit(20).lean();
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  public getClientCount(): number {
    return this.clients.size;
  }
}