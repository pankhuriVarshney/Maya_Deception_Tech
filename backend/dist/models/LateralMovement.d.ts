import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<ILateralMovement, {}, {}, {}, mongoose.Document<unknown, {}, ILateralMovement, {}, {}> & ILateralMovement & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
