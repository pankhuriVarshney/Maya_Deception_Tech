import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<IAttacker, {}, {}, {}, mongoose.Document<unknown, {}, IAttacker, {}, {}> & IAttacker & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
