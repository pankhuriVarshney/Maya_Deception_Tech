import mongoose, { Schema, Document } from 'mongoose';

export interface IVMStatus extends Document {
  vmName: string;
  hostname: string;
  status: 'running' | 'stopped' | 'unknown' | 'error';
  ip?: string;
  lastSeen: Date;
  crdtState?: {
    attackers: number;
    credentials: number;
    sessions: number;
    hash: string;
  };
  dockerContainers?: Array<{
    id: string;
    name: string;
    image: string;
    status: 'running' | 'exited' | 'paused';
    ports: string[];
    created: string;
  }>;
  updatedAt: Date;
}

const VMStatusSchema: Schema = new Schema({
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

export default mongoose.model<IVMStatus>('VMStatus', VMStatusSchema);