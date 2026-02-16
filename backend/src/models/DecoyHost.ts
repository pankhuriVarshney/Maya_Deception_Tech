import mongoose, { Schema, Document } from 'mongoose';

export interface IDecoyHost extends Document {
  hostId: string;
  hostname: string;
  ipAddress: string;
  segment: 'DMZ' | 'Internal' | 'Database' | 'Jump' | 'IoT';
  os: 'Windows' | 'Linux' | 'IoT';
  services: string[];
  status: 'Active' | 'Inactive' | 'Compromised' | 'Under Attack';
  deploymentType: 'VM' | 'Docker' | 'Bare Metal';
  interactions: number;
  lastInteraction?: Date;
  attackerIds: string[];
  mitreTechniques: string[];
}

const DecoyHostSchema: Schema = new Schema({
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

export default mongoose.model<IDecoyHost>('DecoyHost', DecoyHostSchema);