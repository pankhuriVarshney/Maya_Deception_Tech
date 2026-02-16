import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<IDecoyHost, {}, {}, {}, mongoose.Document<unknown, {}, IDecoyHost, {}, {}> & IDecoyHost & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
