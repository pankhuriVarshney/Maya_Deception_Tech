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
const DecoyHostSchema = new mongoose_1.Schema({
    hostId: { type: String, required: true, unique: true },
    hostname: { type: String, required: true },
    ipAddress: { type: String, required: true },
    segment: { type: String, enum: ['DMZ', 'Internal', 'Database', 'Jump', 'IoT'], required: true },
    os: { type: String, enum: ['Windows', 'Linux', 'IoT'], required: true },
    services: [String],
    status: { type: String, enum: ['Active', 'Inactive', 'Compromised', 'Under Attack'], default: 'Active' },
    deploymentType: { type: String, enum: ['VM', 'Docker', 'Bare Metal'], required: true },
    interactions: { type: Number, default: 0 },
    lastInteraction: Date,
    attackerIds: [{ type: String, ref: 'Attacker' }],
    mitreTechniques: [String]
}, { timestamps: true });
exports.default = mongoose_1.default.model('DecoyHost', DecoyHostSchema);
//# sourceMappingURL=DecoyHost.js.map