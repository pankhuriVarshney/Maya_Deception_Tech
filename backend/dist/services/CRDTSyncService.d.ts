import { EventEmitter } from 'events';
export declare class CRDTSyncService extends EventEmitter {
    private syncInterval?;
    private vagrantDir;
    private isSyncing;
    constructor();
    startSyncLoop(intervalMs?: number): void;
    private updateVMStatusInDB;
    stopSyncLoop(): void;
    performSync(): Promise<void>;
    private processState;
    private updateAttacker;
    private addVisitEvent;
    private addActionEvent;
    private addCredential;
    private addSessionEvent;
    private detectCampaign;
    private inferPrivilege;
    private inferMethod;
    private getTacticFromType;
    private calculateCredentialRisk;
}
