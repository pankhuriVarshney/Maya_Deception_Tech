import mongoose, { Schema, Document } from 'mongoose';

export interface ICredential extends Document {
  credentialId: string;
  username: string;
  password: string;
  hash?: string;
  domain?: string;
  source: string;
  attackerId: string;
  decoyHost: string;
  timestamp: Date;
  usageCount: number;
  lastUsed?: Date;
  status: 'Stolen' | 'Used' | 'Blocked' | 'Honeytoken';
  riskScore: number;
}

const CredentialSchema: Schema = new Schema({
  credentialId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  hash: String,
  domain: String,
  source: { type: String, required: true },
  attackerId: { type: String, required: true, ref: 'Attacker' },
  decoyHost: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  usageCount: { type: Number, default: 0 },
  lastUsed: Date,
  status: { type: String, enum: ['Stolen', 'Used', 'Blocked', 'Honeytoken'], default: 'Stolen' },
  riskScore: { type: Number, min: 0, max: 100, default: 50 }
}, { timestamps: true });

export default mongoose.model<ICredential>('Credential', CredentialSchema);