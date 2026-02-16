"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const http_1 = require("http");
const errorHandler_1 = require("./middleware/errorHandler");
const logger_1 = require("./utils/logger");
const CRDTSyncService_1 = require("./services/CRDTSyncService");
const WebSocketHandler_1 = require("./websocket/WebSocketHandler");
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const VMStatus_1 = __importDefault(require("./models/VMStatus")); // FIXED: Import default export
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maya_deception';
// Security middleware
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
}));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
// Body parsing and logging
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)('combined', { stream: { write: msg => logger_1.logger.info(msg.trim()) } }));
app.use((0, compression_1.default)());
// MongoDB Connection
mongoose_1.default.connect(MONGODB_URI)
    .then(() => logger_1.logger.info('Connected to MongoDB'))
    .catch(err => {
    logger_1.logger.error('MongoDB connection error:', err);
    process.exit(1);
});
// Initialize services
const crdtSync = new CRDTSyncService_1.CRDTSyncService();
const wsHandler = new WebSocketHandler_1.WebSocketHandler(server, crdtSync);
// API Routes
app.use('/api/dashboard', dashboard_1.default);
// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        websocketClients: wsHandler.getClientCount(),
        mongodb: mongoose_1.default.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});
// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Maya Deception Fabric Dashboard API',
        version: '1.0.0',
        endpoints: {
            dashboard: '/api/dashboard',
            health: '/health',
            websocket: 'ws://localhost:' + PORT + '/ws'
        }
    });
});
// FIXED: VM Status endpoint with proper error handling and logging
app.get('/api/vms', async (req, res) => {
    try {
        logger_1.logger.info('Fetching VM status from database...');
        const vms = await VMStatus_1.default.find().sort({ vmName: 1 }).lean();
        logger_1.logger.info(`Found ${vms.length} VMs in database`);
        if (!vms || vms.length === 0) {
            logger_1.logger.warn('No VMs found in database');
        }
        // Transform to expected format - match frontend expectations exactly
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
            cached: false
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to fetch VM status from DB:', error);
        res.status(500).json({
            vms: [],
            updatedAt: new Date().toISOString(),
            cached: false,
            error: 'Database error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Error handling
app.use(errorHandler_1.errorHandler);
// Start server
server.listen(PORT, () => {
    logger_1.logger.info(`🚀 Maya Dashboard API running on http://localhost:${PORT}`);
    logger_1.logger.info(`📊 WebSocket endpoint: ws://localhost:${PORT}/ws`);
    // Start CRDT sync loop
    const syncInterval = parseInt(process.env.CRDT_SYNC_INTERVAL || '10000');
    crdtSync.startSyncLoop(syncInterval);
});
// Graceful shutdown
process.on('SIGTERM', () => {
    logger_1.logger.info('SIGTERM received, shutting down gracefully');
    crdtSync.stopSyncLoop();
    server.close(() => {
        mongoose_1.default.connection.close()
            .then(() => {
            logger_1.logger.info('Server closed');
            process.exit(0);
        })
            .catch((err) => {
            logger_1.logger.error('Error closing MongoDB connection:', err);
            process.exit(1);
        });
    });
});
process.on('SIGINT', () => {
    logger_1.logger.info('SIGINT received, shutting down gracefully');
    crdtSync.stopSyncLoop();
    server.close(() => {
        mongoose_1.default.connection.close()
            .then(() => {
            logger_1.logger.info('Server closed');
            process.exit(0);
        })
            .catch((err) => {
            logger_1.logger.error('Error closing MongoDB connection:', err);
            process.exit(1);
        });
    });
});
//# sourceMappingURL=server.js.map