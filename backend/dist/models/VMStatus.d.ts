import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<IVMStatus, {}, {}, {}, mongoose.Document<unknown, {}, IVMStatus, {}, {}> & IVMStatus & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
