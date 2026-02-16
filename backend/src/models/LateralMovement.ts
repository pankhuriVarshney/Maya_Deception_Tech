import mongoose, { Schema, Document } from 'mongoose';

export interface ILateralMovement extends Document {
  movementId: string;
  attackerId: string;
  timestamp: Date;
  sourceHost: string;
  targetHost: string;
  technique: string;
  method: 'SSH' | 'RDP' | 'SMB' | 'WinRM' | 'WMI' | 'PSExec' | 'Other';
  successful: boolean;
  credentialsUsed?: string;
}

const LateralMovementSchema: Schema = new Schema({
  movementId: { type: String, required: true, unique: true },
  attackerId: { type: String, required: true, ref: 'Attacker' },
  timestamp: { type: Date, default: Date.now },
  sourceHost: { type: String, required: true },
  targetHost: { type: String, required: true },
  technique: { type: String, required: true },
  method: { type: String, enum: ['SSH', 'RDP', 'SMB', 'WinRM', 'WMI', 'PSExec', 'Other'], required: true },
  successful: { type: Boolean, default: false },
  credentialsUsed: String
}, { timestamps: true });

export default mongoose.model<ILateralMovement>('LateralMovement', LateralMovementSchema);