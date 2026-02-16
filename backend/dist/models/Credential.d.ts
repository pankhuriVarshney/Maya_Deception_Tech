import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<ICredential, {}, {}, {}, mongoose.Document<unknown, {}, ICredential, {}, {}> & ICredential & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
