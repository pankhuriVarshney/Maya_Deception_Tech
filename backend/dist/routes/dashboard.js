"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const DashboardService_1 = require("../services/DashboardService");
const errorHandler_1 = require("../middleware/errorHandler");
const router = (0, express_1.Router)();
const dashboardService = new DashboardService_1.DashboardService();
// Root dashboard endpoint (matches frontend /api/dashboard)
router.get('/', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const [stats, activeAttackers, timeline, mitreMatrix, lateralMovement, commands, behavior, incidents] = await Promise.all([
        dashboardService.getDashboardStats(),
        dashboardService.getActiveAttackers(), // You'll need to add this method
        dashboardService.getAttackTimeline(undefined, 24),
        dashboardService.getMitreMatrix(),
        dashboardService.getLateralMovementGraph(),
        dashboardService.getCommandActivity(undefined, 10),
        dashboardService.getAttackerBehaviorAnalysis(),
        dashboardService.getIncidentSummary()
    ]);
    res.json({
        success: true,
        data: {
            stats,
            activeAttackers,
            timeline,
            mitreMatrix,
            lateralMovement,
            commands,
            behavior,
            incidents
        },
        timestamp: new Date().toISOString()
    });
}));
// GET /api/dashboard/attackers (alias for active-attackers)
router.get('/attackers', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const attackers = await dashboardService.getMappedActiveAttackers();
    res.json({
        success: true,
        data: attackers,
        count: attackers.length,
        timestamp: new Date().toISOString()
    });
}));
// GET /api/dashboard/attacker/:id (matches frontend /api/attacker/:id)
router.get('/attacker/:id', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const data = await dashboardService.getAttackerDashboard(id);
    if (!data) {
        return res.status(404).json({
            success: false,
            error: `Attacker ${id} not found`,
            timestamp: new Date().toISOString()
        });
    }
    res.json({
        success: true,
        data,
        timestamp: new Date().toISOString()
    });
}));
// Keep all your existing routes too...
router.get('/stats', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const stats = await dashboardService.getDashboardStats();
    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
}));
router.get('/timeline', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { attackerId, hours = 24 } = req.query;
    const timeline = await dashboardService.getAttackTimeline(attackerId, parseInt(hours));
    res.json({ success: true, data: timeline, count: timeline.length, timestamp: new Date().toISOString() });
}));
router.get('/mitre-matrix', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { attackerId } = req.query;
    const matrix = await dashboardService.getMitreMatrix(attackerId);
    res.json({ success: true, data: matrix, timestamp: new Date().toISOString() });
}));
router.get('/lateral-movement', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { attackerId } = req.query;
    const graph = await dashboardService.getLateralMovementGraph(attackerId);
    res.json({ success: true, data: graph, timestamp: new Date().toISOString() });
}));
router.get('/commands', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { attackerId, limit = 10 } = req.query;
    const commands = await dashboardService.getCommandActivity(attackerId, parseInt(limit));
    res.json({ success: true, data: commands, timestamp: new Date().toISOString() });
}));
router.get('/metrics', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const metrics = await dashboardService.getDeceptionMetrics();
    res.json({ success: true, data: metrics, timestamp: new Date().toISOString() });
}));
router.get('/behavior', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { attackerId } = req.query;
    const analysis = await dashboardService.getAttackerBehaviorAnalysis(attackerId);
    res.json({ success: true, data: analysis, timestamp: new Date().toISOString() });
}));
router.get('/incidents', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const summary = await dashboardService.getIncidentSummary();
    res.json({ success: true, data: summary, timestamp: new Date().toISOString() });
}));
router.get('/active-attackers', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const attackers = await dashboardService.getMappedActiveAttackers();
    res.json({
        success: true,
        data: attackers,
        count: attackers.length,
        timestamp: new Date().toISOString()
    });
}));
exports.default = router;
//# sourceMappingURL=dashboard.js.map