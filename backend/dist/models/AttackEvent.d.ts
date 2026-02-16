import mongoose, { Document } from 'mongoose';
export interface IAttackEvent extends Document {
    eventId: string;
    timestamp: Date;
    attackerId: string;
    type: 'Initial Access' | 'Credential Theft' | 'Lateral Movement' | 'Command Execution' | 'Data Exfiltration' | 'Privilege Escalation' | 'Discovery' | 'Persistence' | 'Defense Evasion';
    technique: string;
    tactic: string;
    description: string;
    sourceHost: string;
    targetHost: string;
    command?: string;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    status: 'Detected' | 'In Progress' | 'Blocked' | 'Contained';
    metadata?: {
        processName?: string;
        pid?: number;
        filePath?: string;
        hash?: string;
    };
}
declare const _default: mongoose.Model<IAttackEvent, {}, {}, {}, mongoose.Document<unknown, {}, IAttackEvent, {}, {}> & IAttackEvent & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
