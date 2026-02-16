import mongoose, { Schema, Document } from 'mongoose';

export interface IAttackEvent extends Document {
  eventId: string;
  timestamp: Date;
  attackerId: string;
  type: 'Initial Access' | 'Credential Theft' | 'Lateral Movement' | 'Command Execution' | 
        'Data Exfiltration' | 'Privilege Escalation' | 'Discovery' | 'Persistence' | 'Defense Evasion';
  technique: string;
  tactic: string;
  description: string;
  sourceHost: string;
  targetHost: string;
  command?: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  status: 'Detected' | 'In Progress' | 'Blocked' | 'Contained';
  metadata?: {
    processName?: string;
    pid?: number;
    filePath?: string;
    hash?: string;
  };
}

const AttackEventSchema: Schema = new Schema({
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

export default mongoose.model<IAttackEvent>('AttackEvent', AttackEventSchema);