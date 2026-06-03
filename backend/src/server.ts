import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createServer } from 'http';
import cron from 'node-cron';

import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { CRDTSyncService } from './services/CRDTSyncService';
import { WebSocketHandler } from './websocket/WebSocketHandler';
import { RealSimulationService } from './services/RealSimulationService';
import { InfrastructureDiscoveryService } from './services/InfrastructureDiscoveryService';
import { MitreSyncService } from './services/MitreSyncService';
import { seedDatabase } from './utils/seedData';
import dashboardRoutes from './routes/dashboard';
import simulationRoutes from './routes/simulation';
import decoyRoutes from './routes/decoy';
import { Attacker, VMStatus } from './models';

dotenv.config();

const app = express();
const server = createServer(app);

const PORT = Number(process.env.PORT || 3001);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maya_deception';
const isSimulationMode = process.env.SIMULATION_MODE === 'true';
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:5173'];

cron.schedule('0 3 * * *', async () => {
  logger.info('[Scheduler] Starting daily MITRE sync...');
  const syncService = new MitreSyncService();
  await syncService.sync();
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use(compression());

const crdtSync = new CRDTSyncService();
const simulationService = new RealSimulationService();
const infrastructureDiscovery = new InfrastructureDiscoveryService();
const wsHandler = new WebSocketHandler(server, crdtSync, simulationService);

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/decoy', decoyRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    websocketClients: wsHandler.getClientCount(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/api/vms', async (_req, res) => {
  try {
    if (!isSimulationMode) {
      try {
        const discovered = await infrastructureDiscovery.discoverVMs();
        return res.json({
          vms: discovered,
          updatedAt: new Date().toISOString(),
          cached: false
        });
      } catch (error) {
        logger.warn('VM discovery failed, falling back to cached VM status:', error);
      }
    }

    const vms = await VMStatus.find().sort({ vmName: 1 }).lean();
    const formattedVMs = vms.map(vm => ({
      name: vm.vmName,
      status: vm.status,
      ip: vm.ip,
      lastSeen: vm.lastSeen,
      crdtState: vm.crdtState,
      dockerContainers: vm.dockerContainers || []
    }));

    res.json({
      vms: formattedVMs,
      updatedAt: new Date().toISOString(),
      cached: true
    });
  } catch (error) {
    logger.error('Failed to fetch VM status:', error);
    res.status(500).json({
      vms: [],
      updatedAt: new Date().toISOString(),
      cached: true,
      error: 'VM status error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/attackers/summary', async (_req, res) => {
  try {
    const attackers = await Attacker.find().sort({ lastSeen: -1 }).limit(100).lean();

    res.json({
      total: attackers.length,
      critical: attackers.filter(a => a.riskLevel === 'Critical').length,
      high: attackers.filter(a => a.riskLevel === 'High').length,
      medium: attackers.filter(a => a.riskLevel === 'Medium').length,
      low: attackers.filter(a => a.riskLevel === 'Low').length,
      attackers: attackers.map(a => ({
        id: a.attackerId,
        ip: a.ipAddress,
        riskLevel: a.riskLevel,
        firstSeen: a.firstSeen,
        lastSeen: a.lastSeen,
        dwellTime: a.dwellTime,
        status: a.status
      }))
    });
  } catch (error) {
    logger.error('Failed to fetch attacker summary:', error);
    res.status(500).json({ error: 'Failed to fetch attacker data' });
  }
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Maya Deception Fabric Dashboard API',
    version: '1.0.0',
    endpoints: {
      dashboard: '/api/dashboard',
      vms: '/api/vms',
      attackers: '/api/attackers/summary',
      health: '/health',
      websocket: `ws://localhost:${PORT}/ws`
    }
  });
});

app.use(errorHandler);

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('Connected to MongoDB');

    if (isSimulationMode) {
      await seedDatabase();
    }

    server.listen(PORT, () => {
      logger.info(`Maya Dashboard API running on http://localhost:${PORT}`);
      logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws`);

      const syncInterval = parseInt(process.env.CRDT_SYNC_INTERVAL || '10000', 10);
      crdtSync.startSyncLoop(syncInterval);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`);
  crdtSync.stopSyncLoop();

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await Promise.race([
        mongoose.connection.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('MongoDB close timeout')), 5000)
        )
      ]);
      logger.info('MongoDB connection closed');
      process.exit(0);
    } catch (err) {
      logger.error('Error closing MongoDB connection:', err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully exiting');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

void start();
