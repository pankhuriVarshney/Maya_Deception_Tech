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
const VMStatusSchema = new mongoose_1.Schema({
    vmName: { type: String, required: true, unique: true, index: true },
    hostname: { type: String, required: true },
    status: {
        type: String,
        enum: ['running', 'stopped', 'unknown', 'error'],
        default: 'unknown'
    },
    ip: String,
    lastSeen: { type: Date, default: Date.now },
    crdtState: {
        attackers: { type: Number, default: 0 },
        credentials: { type: Number, default: 0 },
        sessions: { type: Number, default: 0 },
        hash: String
    },
    dockerContainers: [{
            id: String,
            name: String,
            image: String,
            status: { type: String, enum: ['running', 'exited', 'paused'] },
            ports: [String],
            created: String
        }]
}, {
    timestamps: true,
    collection: 'vm_status'
});
// Index for fast queries
VMStatusSchema.index({ status: 1, updatedAt: -1 });
exports.default = mongoose_1.default.model('VMStatus', VMStatusSchema);
//# sourceMappingURL=VMStatus.js.map