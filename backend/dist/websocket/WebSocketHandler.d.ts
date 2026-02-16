import { Server } from 'http';
import { CRDTSyncService } from '../services/CRDTSyncService';
export declare class WebSocketHandler {
    private wss;
    private crdtSync;
    private dashboardService;
    private clients;
    constructor(server: Server, crdtSync: CRDTSyncService);
    private setupWebSocket;
    private setupEventListeners;
    private handleMessage;
    private getActiveAttackers;
    private broadcast;
    getClientCount(): number;
}
