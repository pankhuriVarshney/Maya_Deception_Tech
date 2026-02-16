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
const mongoose_1 = __importStar(require("mongoose"));
const AttackEventSchema = new mongoose_1.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    attackerId: { type: String, required: true, ref: 'Attacker', index: true },
    type: {
        type: String,
        enum: ['Initial Access', 'Credential Theft', 'Lateral Movement', 'Command Execution',
            'Data Exfiltration', 'Privilege Escalation', 'Discovery', 'Persistence', 'Defense Evasion'],
        required: true
    },
    technique: { type: String, required: true },
    tactic: { type: String, required: true },
    description: { type: String, required: true },
    sourceHost: { type: String, required: true },
    targetHost: { type: String, required: true },
    command: String,
    severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], required: true },
    status: { type: String, enum: ['Detected', 'In Progress', 'Blocked', 'Contained'], default: 'Detected' },
    metadata: {
        processName: String,
        pid: Number,
        filePath: String,
        hash: String
    }
}, { timestamps: true });
AttackEventSchema.index({ timestamp: -1, attackerId: 1 });
exports.default = mongoose_1.default.model('AttackEvent', AttackEventSchema);
//# sourceMappingURL=AttackEvent.js.map