"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRDTSyncService = void 0;
const events_1 = require("events");
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
const uuid_1 = require("uuid");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const models_2 = require("../models");
class CRDTSyncService extends events_1.EventEmitter {
    constructor() {
        super();
        this.isSyncing = false;
        this.vagrantDir = process.env.VAGRANT_DIR || '../simulations/fake';
    }
    startSyncLoop(intervalMs = 10000) {
        // Existing CRDT sync
        this.syncInterval = setInterval(() => {
            if (!this.isSyncing) {
                this.performSync().catch(err => logger_1.logger.error('CRDT sync error:', err));
            }
        }, intervalMs);
        // NEW: VM status updates every 30 seconds
        setInterval(() => {
            this.updateVMStatusInDB().catch(err => logger_1.logger.error('VM status update error:', err));
        }, 30000);
        // Initial VM status update
        this.updateVMStatusInDB().catch(err => logger_1.logger.error('Initial VM status error:', err));
        logger_1.logger.info(`Started CRDT sync loop with ${intervalMs}ms interval`);
    }
    // Converted to a proper class method
    async updateVMStatusInDB() {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);
        const fs = require('fs');
        const path = require('path');
        const vagrantDir = process.env.VAGRANT_DIR || '../simulations/fake';
        if (!fs.existsSync(vagrantDir)) {
            logger_1.logger.warn('Vagrant directory not found');
            return;
        }
        const entries = fs.readdirSync(vagrantDir, { withFileTypes: true });
        const vmDirs = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => name.startsWith('fake-') || name === 'gateway-vm');
        for (const vmName of vmDirs) {
            const vmPath = path.join(vagrantDir, vmName);
            // Skip if no Vagrantfile
            if (!fs.existsSync(path.join(vmPath, 'Vagrantfile'))) {
                continue;
            }
            try {
                // Get status with timeout
                const { stdout: statusOutput } = await execAsync(`cd ${vmPath} && timeout 5 vagrant status --machine-readable 2>/dev/null || echo ""`, { timeout: 6000 });
                const statusLine = statusOutput.split('\n').find((line) => line.includes(',state,'));
                const vagrantStatus = statusLine ? statusLine.split(',')[3] : 'unknown';
                const isRunning = vagrantStatus === 'running';
                const updateData = {
                    vmName,
                    hostname: vmName,
                    status: isRunning ? 'running' : (vagrantStatus === 'unknown' ? 'unknown' : 'stopped'),
                    lastSeen: new Date(),
                };
                // If running, get more details
                if (isRunning) {
                    try {
                        // Get IP
                        const { stdout: ipOutput } = await execAsync(`cd ${vmPath} && timeout 3 vagrant ssh -c "hostname -I | head -1" 2>/dev/null || echo ""`, { timeout: 4000 });
                        updateData.ip = ipOutput.trim() || undefined;
                        // Get CRDT stats
                        const { stdout: statsOutput } = await execAsync(`cd ${vmPath} && timeout 3 vagrant ssh -c "sudo syslogd-helper stats 2>/dev/null || echo 'ERROR'" 2>/dev/null`, { timeout: 4000 });
                        if (statsOutput.includes('Node:')) {
                            const lines = statsOutput.split('\n');
                            const attackers = parseInt(lines.find((l) => l.includes('Attackers:'))?.split(':')[1] || '0');
                            const credentials = parseInt(lines.find((l) => l.includes('Credentials:'))?.split(':')[1] || '0');
                            const sessions = parseInt(lines.find((l) => l.includes('Sessions:'))?.split(':')[1] || '0');
                            const hash = lines.find((l) => l.includes('State hash:'))?.split(':')[1]?.trim() || '';
                            updateData.crdtState = { attackers, credentials, sessions, hash };
                        }
                        // Get Docker containers
                        const { stdout: dockerOutput } = await execAsync(`cd ${vmPath} && timeout 3 vagrant ssh -c "sudo docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}' 2>/dev/null || echo ''" 2>/dev/null`, { timeout: 4000 });
                        if (dockerOutput.trim()) {
                            updateData.dockerContainers = dockerOutput.split('\n')
                                .filter((line) => line.includes('|'))
                                .map((line) => {
                                const [id, name, image, containerStatus, ports, created] = line.split('|');
                                return {
                                    id: id.substring(0, 12),
                                    name,
                                    image,
                                    status: containerStatus.includes('Up') ? 'running' : 'exited',
                                    ports: ports ? ports.split(', ') : [],
                                    created
                                };
                            });
                        }
                    }
                    catch (detailError) {
                        logger_1.logger.warn(`Failed to get details for ${vmName}:`, detailError);
                    }
                }
                // Upsert to MongoDB
                await models_2.VMStatus.findOneAndUpdate({ vmName }, updateData, { upsert: true, new: true });
                logger_1.logger.info(`Updated VM status for ${vmName}: ${updateData.status}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to update VM status for ${vmName}:`, error);
                // Mark as error in DB
                await models_2.VMStatus.findOneAndUpdate({ vmName }, {
                    vmName,
                    hostname: vmName,
                    status: 'error',
                    lastSeen: new Date()
                }, { upsert: true });
            }
        }
    }
    stopSyncLoop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = undefined;
        }
    }
    async performSync() {
        this.isSyncing = true;
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            const vmDirs = fs.readdirSync(this.vagrantDir)
                .filter(dir => fs.statSync(path.join(this.vagrantDir, dir)).isDirectory())
                .filter(dir => dir.startsWith('fake-') || dir === 'gateway-vm');
            for (const vm of vmDirs) {
                try {
                    const vmPath = path.join(this.vagrantDir, vm);
                    const { stdout: statusOutput } = await execAsync(`cd ${vmPath} && vagrant status --machine-readable`, { timeout: 5000 });
                    if (!statusOutput.includes('state-running,running')) {
                        continue;
                    }
                    const { stdout } = await execAsync(`cd ${vmPath} && vagrant ssh -c "sudo cat /var/lib/.syscache 2>/dev/null || echo '{}'"`, { timeout: 10000 });
                    if (stdout && stdout.trim() !== '{}' && stdout.trim() !== '') {
                        const state = JSON.parse(stdout);
                        await this.processState(state, vm);
                    }
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to sync with ${vm}:`, error.message);
                }
            }
            this.emit('syncComplete');
        }
        catch (error) {
            logger_1.logger.error('CRDT sync failed:', error);
            this.emit('syncError', error);
        }
        finally {
            this.isSyncing = false;
        }
    }
    async processState(state, sourceHost) {
        const nodeId = state.node_id || sourceHost;
        if (state.attackers) {
            for (const [attackerIp, attackerState] of Object.entries(state.attackers)) {
                await this.updateAttacker(attackerIp, attackerState, sourceHost);
            }
        }
        if (state.stolen_creds?.adds) {
            for (const [cred, tags] of Object.entries(state.stolen_creds.adds)) {
                for (const [node, timestamp] of tags) {
                    await this.addCredential(cred, nodeId, attackerIpFromTags(tags));
                }
            }
        }
        if (state.active_sessions?.entries) {
            for (const [host, [sessionId, ts, node]] of Object.entries(state.active_sessions.entries)) {
                await this.addSessionEvent(sessionId, host, node, ts);
            }
        }
    }
    async updateAttacker(attackerIp, state, sourceHost) {
        const attackerId = `APT-${attackerIp.replace(/\./g, '-')}`;
        let attacker = await models_1.Attacker.findOne({ attackerId });
        if (!attacker) {
            attacker = new models_1.Attacker({
                attackerId,
                ipAddress: attackerIp,
                entryPoint: sourceHost,
                currentPrivilege: 'User',
                riskLevel: 'Medium',
                campaign: this.detectCampaign(state),
                firstSeen: new Date(),
                lastSeen: new Date(),
                dwellTime: 0,
                status: 'Active'
            });
        }
        else {
            attacker.lastSeen = new Date();
            const dwellMs = attacker.lastSeen.getTime() - attacker.firstSeen.getTime();
            attacker.dwellTime = Math.floor(dwellMs / 60000);
            const visitedCount = state.visited_decoys?.elements?.length || 0;
            if (visitedCount > 5)
                attacker.riskLevel = 'Critical';
            else if (visitedCount > 3)
                attacker.riskLevel = 'High';
            else if (visitedCount > 1)
                attacker.riskLevel = 'Medium';
        }
        await attacker.save();
        if (state.visited_decoys?.elements) {
            for (const decoy of state.visited_decoys.elements) {
                await this.addVisitEvent(attackerId, decoy, sourceHost);
            }
        }
        if (state.actions_per_decoy?.entries) {
            for (const [decoy, [action, ts, node]] of Object.entries(state.actions_per_decoy.entries)) {
                await this.addActionEvent(attackerId, decoy, action, ts, node);
            }
        }
        if (state.location?.value) {
            attacker.currentPrivilege = this.inferPrivilege(state.location.value);
            await attacker.save();
        }
        this.emit('attackerUpdated', attacker);
    }
    async addVisitEvent(attackerId, decoy, sourceHost) {
        const eventId = `evt-${(0, uuid_1.v4)()}`;
        const existing = await models_1.AttackEvent.findOne({
            attackerId,
            description: `Attacker visited ${decoy}`,
            timestamp: { $gte: new Date(Date.now() - 60000) }
        });
        if (existing)
            return;
        const event = new models_1.AttackEvent({
            eventId,
            attackerId,
            type: 'Discovery',
            technique: 'T1083',
            tactic: 'Discovery',
            description: `Attacker visited ${decoy}`,
            sourceHost: attackerId.split('-').slice(1).join('.'),
            targetHost: decoy,
            severity: 'Low',
            status: 'Detected'
        });
        await event.save();
        this.emit('newEvent', event);
        await models_1.DecoyHost.findOneAndUpdate({ hostname: decoy }, {
            $inc: { interactions: 1 },
            $set: { lastInteraction: new Date() },
            $addToSet: { attackerIds: attackerId }
        }, { upsert: true });
    }
    async addActionEvent(attackerId, decoy, action, ts, node) {
        const eventId = `evt-${(0, uuid_1.v4)()}`;
        const actionLower = action.toLowerCase();
        let type = 'Command Execution';
        let technique = 'T1059';
        let severity = 'Medium';
        if (actionLower.includes('mimikatz') || actionLower.includes('credential')) {
            type = 'Credential Theft';
            technique = 'T1003';
            severity = 'Critical';
        }
        else if (actionLower.includes('lateral') || actionLower.includes('ssh') || actionLower.includes('rdp')) {
            type = 'Lateral Movement';
            technique = 'T1021';
            severity = 'High';
        }
        else if (actionLower.includes('exfil') || actionLower.includes('download')) {
            type = 'Data Exfiltration';
            technique = 'T1041';
            severity = 'Critical';
        }
        else if (actionLower.includes('privilege') || actionLower.includes('sudo') || actionLower.includes('admin')) {
            type = 'Privilege Escalation';
            technique = 'T1078';
            severity = 'High';
        }
        const event = new models_1.AttackEvent({
            eventId,
            timestamp: new Date(ts * 1000),
            attackerId,
            type,
            technique,
            tactic: this.getTacticFromType(type),
            description: action,
            sourceHost: node,
            targetHost: decoy,
            command: action,
            severity,
            status: 'Detected'
        });
        await event.save();
        this.emit('newEvent', event);
        if (type === 'Lateral Movement') {
            await models_1.LateralMovement.create({
                movementId: `mov-${(0, uuid_1.v4)()}`,
                attackerId,
                sourceHost: node,
                targetHost: decoy,
                technique,
                method: this.inferMethod(action),
                successful: true
            });
        }
    }
    async addCredential(cred, sourceHost, attackerIp) {
        const [username, password] = cred.split(':');
        if (!username || !password)
            return;
        const credentialId = `cred-${(0, uuid_1.v4)()}`;
        const attackerId = attackerIp ? `APT-${attackerIp.replace(/\./g, '-')}` : 'unknown';
        const existing = await models_1.Credential.findOne({ username, password, attackerId });
        if (existing) {
            existing.usageCount++;
            existing.lastUsed = new Date();
            await existing.save();
            return;
        }
        await models_1.Credential.create({
            credentialId,
            username,
            password,
            source: sourceHost,
            attackerId,
            decoyHost: sourceHost,
            status: 'Stolen',
            riskScore: this.calculateCredentialRisk(username, password)
        });
        await models_1.AttackEvent.create({
            eventId: `evt-${(0, uuid_1.v4)()}`,
            attackerId,
            type: 'Credential Theft',
            technique: 'T1003',
            tactic: 'Credential Access',
            description: `Credential stolen: ${username}`,
            sourceHost: attackerIp || 'unknown',
            targetHost: sourceHost,
            severity: 'Critical',
            status: 'Detected'
        });
    }
    async addSessionEvent(sessionId, host, node, ts) {
        const eventId = `evt-${(0, uuid_1.v4)()}`;
        await models_1.AttackEvent.findOneAndUpdate({ eventId }, {
            eventId,
            timestamp: new Date(ts * 1000),
            attackerId: `APT-${node.replace(/\./g, '-')}`,
            type: 'Initial Access',
            technique: 'T1078',
            tactic: 'Initial Access',
            description: `Active session established on ${host}`,
            sourceHost: node,
            targetHost: host,
            severity: 'High',
            status: 'In Progress'
        }, { upsert: true });
    }
    detectCampaign(state) {
        const actions = Object.keys(state.actions_per_decoy?.entries || {});
        const actionStr = JSON.stringify(actions).toLowerCase();
        if (actionStr.includes('mimikatz') || actionStr.includes('lsass'))
            return 'Shadow Hydra';
        if (actionStr.includes('ransomware') || actionStr.includes('encrypt'))
            return 'CryptoLock';
        if (actionStr.includes('apt') || actionStr.includes('nation'))
            return 'Silent Tiger';
        return 'Opportunistic';
    }
    inferPrivilege(location) {
        if (location.includes('admin') || location.includes('root') || location.includes('system'))
            return 'Admin';
        if (location.includes('db') || location.includes('sql'))
            return 'DB Admin';
        return 'User';
    }
    inferMethod(action) {
        const lower = action.toLowerCase();
        if (lower.includes('ssh'))
            return 'SSH';
        if (lower.includes('rdp'))
            return 'RDP';
        if (lower.includes('smb'))
            return 'SMB';
        if (lower.includes('winrm'))
            return 'WinRM';
        if (lower.includes('wmi'))
            return 'WMI';
        if (lower.includes('psexec'))
            return 'PSExec';
        return 'Other';
    }
    getTacticFromType(type) {
        const tacticMap = {
            'Initial Access': 'Initial Access',
            'Credential Theft': 'Credential Access',
            'Lateral Movement': 'Lateral Movement',
            'Command Execution': 'Execution',
            'Data Exfiltration': 'Exfiltration',
            'Privilege Escalation': 'Privilege Escalation',
            'Discovery': 'Discovery',
            'Persistence': 'Persistence',
            'Defense Evasion': 'Defense Evasion'
        };
        return tacticMap[type] || 'Unknown';
    }
    calculateCredentialRisk(username, password) {
        let score = 50;
        if (username.includes('admin'))
            score += 20;
        if (username.includes('root'))
            score += 25;
        if (password.length < 8)
            score += 15;
        if (password.toLowerCase().includes('password'))
            score += 10;
        return Math.min(score, 100);
    }
}
exports.CRDTSyncService = CRDTSyncService;
function attackerIpFromTags(tags) {
    return undefined;
}
//# sourceMappingURL=CRDTSyncService.js.map