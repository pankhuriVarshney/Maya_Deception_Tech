import mongoose, { Schema, Document } from 'mongoose';

export interface IAttacker extends Document {
  attackerId: string;
  ipAddress: string;
  entryPoint: string;
  currentPrivilege: string;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  campaign: string;
  firstSeen: Date;
  lastSeen: Date;
  dwellTime: number;
  status: 'Active' | 'Inactive' | 'Contained';
  geolocation?: {
    country: string;
    city: string;
    coordinates: [number, number];
  };
  fingerprint?: {
    userAgent: string;
    os: string;
    tools: string[];
  };
}

const AttackerSchema: Schema = new Schema({
  attackerId: { type: String, required: true, unique: true, index: true },
  ipAddress: { type: String, required: true },
  entryPoint: { type: String, required: true },
  currentPrivilege: { type: String, default: 'User' },
  riskLevel: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
  campaign: { type: String, default: 'Unknown' },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  dwellTime: { type: Number, default: 0 },
  status: { type: String, enum: ['Active', 'Inactive', 'Contained'], default: 'Active' },
  geolocation: {
    country: String,
    city: String,
    coordinates: [Number]
  },
  fingerprint: {
    userAgent: String,
    os: String,
    tools: [String]
  }
}, { timestamps: true });

export default mongoose.model<IAttacker>('Attacker', AttackerSchema);