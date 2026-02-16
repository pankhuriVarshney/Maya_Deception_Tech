export declare class DashboardService {
    getDashboardStats(): Promise<{
        activeAttackers: number;
        deceptionEngagement: {
            rate: number;
            level: string;
        };
        dwellTime: {
            hours: number;
            minutes: number;
            average: number;
        };
        realAssetsProtected: number;
        metrics: {
            totalEvents: number;
            stolenCredentials: number;
            compromisedHosts: number;
            blockedAttacks: number;
            falsePositives: number;
        };
    }>;
    getMappedActiveAttackers(): Promise<any[]>;
    getAttackerDashboard(attackerId: string): Promise<{
        id: string;
        attackerId: string;
        generatedAt: string;
        dashboard: any;
    } | null>;
    getAttackerProfile(attackerId: string): Promise<{
        attackerId: string;
        ipAddress: string;
        entryPoint: string;
        currentPrivilege: string;
        riskLevel: "Low" | "Medium" | "High" | "Critical";
        campaign: string;
        firstSeen: Date;
        lastSeen: Date;
        dwellTime: string;
        status: "Active" | "Inactive" | "Contained";
        geolocation: import("mongoose").FlattenMaps<{
            country: string;
            city: string;
            coordinates: [number, number];
        }> | undefined;
        fingerprint: import("mongoose").FlattenMaps<{
            userAgent: string;
            os: string;
            tools: string[];
        }> | undefined;
        credentials: {
            username: string;
            source: string;
            timestamp: Date;
            riskScore: number;
        }[];
        recentEvents: {
            type: "Initial Access" | "Credential Theft" | "Lateral Movement" | "Command Execution" | "Data Exfiltration" | "Privilege Escalation" | "Discovery" | "Persistence" | "Defense Evasion";
            timestamp: Date;
            description: string;
        }[];
        lateralMovement: {
            from: string;
            to: string;
            method: "SSH" | "RDP" | "SMB" | "WinRM" | "WMI" | "PSExec" | "Other";
            successful: boolean;
        }[];
    } | null>;
    getAttackTimeline(attackerId?: string, hours?: number): Promise<{
        time: string;
        type: "Initial Access" | "Credential Theft" | "Lateral Movement" | "Command Execution" | "Data Exfiltration" | "Privilege Escalation" | "Discovery" | "Persistence" | "Defense Evasion";
        technique: string;
        description: string;
        severity: "Low" | "Medium" | "High" | "Critical";
        status: "Contained" | "Detected" | "In Progress" | "Blocked";
    }[]>;
    getMitreMatrix(attackerId?: string): Promise<any>;
    getLateralMovementGraph(attackerId?: string): Promise<{
        nodes: {
            id: string;
            label: string;
            type: "DMZ" | "Internal" | "Database" | "Jump" | "IoT";
            status: "Active" | "Inactive" | "Compromised" | "Under Attack";
            os: "IoT" | "Windows" | "Linux";
        }[];
        edges: {
            from: string;
            to: string;
            label: "SSH" | "RDP" | "SMB" | "WinRM" | "WMI" | "PSExec" | "Other";
            successful: boolean;
        }[];
    }>;
    getCommandActivity(attackerId?: string, limit?: number): Promise<{
        command: string;
        timestamp: Date;
        target: string;
        technique: string;
    }[]>;
    getDeceptionMetrics(): Promise<any>;
    getActiveAttackers(): Promise<any>;
    getAttackerBehaviorAnalysis(attackerId?: string): Promise<{
        behaviors: {
            privilegeEscalation: boolean;
            credentialDumping: boolean;
            lateralMovement: boolean;
            dataExfiltration: boolean;
            persistence: boolean;
            defenseEvasion: boolean;
        };
        threatConfidence: string;
    }>;
    getIncidentSummary(): Promise<{
        dataExfiltrationAttempt: {
            count: number;
            percentage: number;
        };
        lateralMovement: {
            count: number;
            percentage: number;
        };
        credentialTheft: {
            count: number;
            percentage: number;
        };
        privilegeEscalation: {
            count: number;
            percentage: number;
        };
    }>;
    private calculateAverageDwellTime;
    private calculateTotalDwellTime;
    private formatDwellTime;
}
