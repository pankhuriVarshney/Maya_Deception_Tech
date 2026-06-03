import { exec } from 'child_process';
import * as https from 'https';
import * as path from 'path';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface DecoyGenerationInput {
  industry: string;
  companySize: number;
  region: string;
}

export type VmRole =
  | 'web'
  | 'auth'
  | 'db'
  | 'payments'
  | 'api'
  | 'worker'
  | 'cache'
  | 'ehr'
  | 'backup'
  | 'fileserver'
  | 'jump';

export interface CompanyBlueprint {
  companyName: string;
  industry: string;
  profile: 'fintech' | 'healthcare' | 'saas' | 'enterprise';
  employees: {
    name: string;
    role: string;
    department: string;
    username: string;
  }[];
  services: string[];
  techStack: string[];
  internalServers: {
    name: string;
    type: VmRole;
  }[];
  documents: {
    filename: string;
    content: string;
  }[];
}

interface BlueprintTemplateProfile {
  id: 'fintech' | 'healthcare' | 'saas' | 'enterprise';
  industry: 'FinTech' | 'Healthcare' | 'SaaS' | 'Enterprise';
  companyName: string;
  documents: string[];
  services: string[];
  serverRoles: VmRole[];
  rolePool: Array<{ role: string; department: string }>;
}

interface IndustryProfile {
  normalized: string;
  namePrefixes: string[];
  rolePool: Array<{ role: string; department: string }>;
  techStack: string[];
  internalServers: Array<{ name: string; type: 'web' | 'db' | 'fileserver' | 'jump' }>;
}

export interface BlueprintDeploymentResult {
  vmName: string;
  usersCreated: number;
  documentsDeployed: number;
  servicesMarked: number;
  warnings: string[];
}

export interface DecoyVmProvisionResult {
  vmName: string;
  templateVmName: string;
  vmPath: string;
  ipAddress: string;
  created: boolean;
}

export interface CreateAndApplyResult {
  vm: DecoyVmProvisionResult;
  deployment: BlueprintDeploymentResult;
}

interface VmCommandOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

const FIRST_NAMES = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Sophia', 'Elijah', 'Ava', 'James', 'Isabella', 'Lucas',
  'Mia', 'Mason', 'Charlotte', 'Ethan', 'Amelia', 'Logan', 'Harper', 'Benjamin', 'Evelyn', 'Jacob',
  'Abigail', 'Michael', 'Emily', 'Daniel', 'Ella', 'Henry', 'Madison', 'Jackson', 'Scarlett', 'Sebastian',
  'Aria', 'Alexander', 'Luna', 'Jack', 'Chloe', 'Wyatt', 'Grace', 'Levi', 'Zoey', 'Samuel'
];

const LAST_NAMES = [
  'Anderson', 'Bennett', 'Carter', 'Diaz', 'Ellis', 'Foster', 'Garcia', 'Hughes', 'Irwin', 'Jenkins',
  'Khan', 'Lee', 'Mitchell', 'Nolan', 'Owens', 'Patel', 'Quinn', 'Reed', 'Sullivan', 'Turner',
  'Underwood', 'Vasquez', 'Walker', 'Xu', 'Young', 'Zimmerman', 'Brooks', 'Cook', 'Davis', 'Evans',
  'Flores', 'Graham', 'Howard', 'Ingram', 'Jones', 'Kim', 'Lewis', 'Morgan', 'Nguyen', 'Parker'
];

const SUPPORTED_VM_ROLES: Set<VmRole> = new Set([
  'web', 'auth', 'db', 'payments', 'api', 'worker', 'cache', 'ehr', 'backup', 'fileserver', 'jump'
]);

const BLUEPRINT_TEMPLATE_LIBRARY: BlueprintTemplateProfile[] = [
  {
    id: 'fintech',
    industry: 'FinTech',
    companyName: 'Nova Systems',
    documents: ['settlement_schedule.txt', 'payroll.csv', 'trading_accounts.csv'],
    services: ['payment-api', 'auth-server'],
    serverRoles: ['web', 'auth', 'payments', 'db'],
    rolePool: [
      { role: 'Payments Engineer', department: 'Engineering' },
      { role: 'Fraud Analyst', department: 'Risk' },
      { role: 'Treasury Analyst', department: 'Finance' },
      { role: 'Compliance Manager', department: 'Compliance' },
      { role: 'Security Engineer', department: 'Security' }
    ]
  },
  {
    id: 'healthcare',
    industry: 'Healthcare',
    companyName: 'MedCore Health',
    documents: ['patient_records.xlsx', 'insurance_claims.csv', 'surgery_schedule.docx'],
    services: ['ehr-server', 'patient-portal'],
    serverRoles: ['web', 'ehr', 'db', 'backup'],
    rolePool: [
      { role: 'Clinical Systems Analyst', department: 'Clinical Ops' },
      { role: 'EHR Administrator', department: 'IT' },
      { role: 'Revenue Cycle Specialist', department: 'Finance' },
      { role: 'Compliance Officer', department: 'Compliance' },
      { role: 'Security Analyst', department: 'Security' }
    ]
  },
  {
    id: 'saas',
    industry: 'SaaS',
    companyName: 'Atlas Cloud',
    documents: ['api_keys.txt', 'customer_list.csv', 'billing_records.csv'],
    services: ['api-gateway', 'redis', 'worker-node'],
    serverRoles: ['web', 'api', 'worker', 'cache', 'db'],
    rolePool: [
      { role: 'Backend Engineer', department: 'Engineering' },
      { role: 'Platform Engineer', department: 'Infrastructure' },
      { role: 'Customer Success Manager', department: 'Customer Success' },
      { role: 'Billing Analyst', department: 'Finance' },
      { role: 'Security Engineer', department: 'Security' }
    ]
  },
  {
    id: 'enterprise',
    industry: 'Enterprise',
    companyName: 'Stratus Enterprise',
    documents: ['board_minutes.txt', 'employee_access_matrix.csv', 'vendor_contracts.pdf'],
    services: ['identity-gateway', 'sap-integration', 'backup-orchestrator'],
    serverRoles: ['web', 'auth', 'api', 'db', 'backup'],
    rolePool: [
      { role: 'Enterprise Architect', department: 'Architecture' },
      { role: 'Identity Engineer', department: 'Security' },
      { role: 'Platform Engineer', department: 'Infrastructure' },
      { role: 'Procurement Manager', department: 'Operations' },
      { role: 'Finance Controller', department: 'Finance' }
    ]
  }
];

const INDUSTRY_ALIASES: Record<string, string> = {
  fintech: 'fintech',
  finance: 'fintech',
  banking: 'fintech',
  healthcare: 'healthcare',
  health: 'healthcare',
  retail: 'retail',
  ecommerce: 'retail',
  'e-commerce': 'retail',
  saas: 'saas',
  software: 'saas',
  manufacturing: 'manufacturing',
  industrial: 'manufacturing'
};

export class DecoyGenerationService {
  private readonly vagrantDirPromise: Promise<string | null>;
  private readonly vmOperationLocks: Map<string, Promise<void>> = new Map();

  constructor() {
    this.vagrantDirPromise = this.resolveVagrantDir();
  }

  async generateCompanyBlueprint(input: DecoyGenerationInput): Promise<CompanyBlueprint> {
    const normalizedInput = this.normalizeInput(input);
    const generated = this.generateDeterministicBlueprint(normalizedInput);
    logger.info(`Generated template blueprint profile=${generated.profile} company=${generated.companyName}`);
    return generated;
  }

  async applyBlueprintToVM(
    blueprint: CompanyBlueprint,
    vmName: string = 'fake-web-01'
  ): Promise<BlueprintDeploymentResult> {
    const sanitizedBlueprint = this.sanitizeBlueprint(blueprint);
    const warnings: string[] = [];
    let vmReady = true;

    try {
      await this.waitForVmReadiness(vmName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`VM readiness probe failed for ${vmName}: ${message}`);
      logger.warn(`Proceeding with best-effort decoy apply despite readiness probe failure for ${vmName}`, {
        vmName,
        error: message
      });
      vmReady = false;
    }

    if (!vmReady) {
      return {
        vmName,
        usersCreated: 0,
        documentsDeployed: 0,
        servicesMarked: 0,
        warnings
      };
    }

    let usersCreated = 0;
    let documentsDeployed = 0;
    let servicesMarked = 0;

    for (const employee of sanitizedBlueprint.employees) {
      const password = this.generateDecoyPassword(employee.username);
      const homeDir = `/home/${employee.username}`;
      const historyLines = this.buildBashHistory(employee, sanitizedBlueprint.industry);
      const historyCommands = historyLines.map(
        (line) => `echo ${this.shellQuote(line)} | sudo tee -a ${this.shellQuote(`${homeDir}/.bash_history`)} >/dev/null`
      );

      const command = [
        `id -u ${this.shellQuote(employee.username)} >/dev/null 2>&1 || sudo useradd -m -s /bin/bash ${this.shellQuote(employee.username)}`,
        `echo ${this.shellQuote(`${employee.username}:${password}`)} | sudo chpasswd`,
        `sudo mkdir -p ${this.shellQuote(homeDir)}`,
        `sudo touch ${this.shellQuote(`${homeDir}/.bash_history`)}`,
        ...historyCommands,
        `sudo chown -R ${this.shellQuote(`${employee.username}:${employee.username}`)} ${this.shellQuote(homeDir)}`
      ].join(' && ');

      try {
        await this.executeOnVm(vmName, command, { maxAttempts: 2, retryDelayMs: 1500 });
        usersCreated += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to provision user ${employee.username}: ${message}`);
      }
    }

    const docOwners = sanitizedBlueprint.employees.length > 0
      ? sanitizedBlueprint.employees
      : [{ username: 'vagrant' } as { username: string }];

    for (let i = 0; i < sanitizedBlueprint.documents.length; i += 1) {
      const document = sanitizedBlueprint.documents[i];
      const owner = docOwners[i % docOwners.length];
      const filePath = `/home/${owner.username}/${document.filename}`;
      const encodedContent = Buffer.from(document.content, 'utf8').toString('base64');

      const command = [
        `sudo mkdir -p ${this.shellQuote(`/home/${owner.username}`)}`,
        `echo ${this.shellQuote(encodedContent)} | base64 -d | sudo tee ${this.shellQuote(filePath)} >/dev/null`,
        `sudo chown ${this.shellQuote(`${owner.username}:${owner.username}`)} ${this.shellQuote(filePath)}`,
        `sudo chmod 640 ${this.shellQuote(filePath)}`
      ].join(' && ');

      try {
        await this.executeOnVm(vmName, command, { maxAttempts: 2, retryDelayMs: 1500 });
        documentsDeployed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to deploy document ${document.filename}: ${message}`);
      }
    }

    for (const server of sanitizedBlueprint.internalServers) {
      const serverDir = `/opt/decoy/internal-servers/${this.sanitizePathSegment(server.name)}`;
      const command = [
        `sudo mkdir -p ${this.shellQuote(serverDir)}`,
        `echo ${this.shellQuote(server.type)} | sudo tee ${this.shellQuote(`${serverDir}/service.type`)} >/dev/null`,
        `echo ${this.shellQuote(sanitizedBlueprint.companyName)} | sudo tee ${this.shellQuote(`${serverDir}/company.name`)} >/dev/null`,
        `echo ${this.shellQuote(new Date().toISOString())} | sudo tee ${this.shellQuote(`${serverDir}/provisioned.at`)} >/dev/null`
      ].join(' && ');

      try {
        await this.executeOnVm(vmName, command, { maxAttempts: 2, retryDelayMs: 1500 });
        servicesMarked += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to mark internal server ${server.name}: ${message}`);
      }
    }

    for (const service of sanitizedBlueprint.services) {
      const serviceDir = `/opt/decoy/services/${this.sanitizePathSegment(service)}`;
      const command = [
        `sudo mkdir -p ${this.shellQuote(serviceDir)}`,
        `echo ${this.shellQuote(service)} | sudo tee ${this.shellQuote(`${serviceDir}/service.name`)} >/dev/null`,
        `echo ${this.shellQuote(sanitizedBlueprint.companyName)} | sudo tee ${this.shellQuote(`${serviceDir}/company.name`)} >/dev/null`
      ].join(' && ');

      try {
        await this.executeOnVm(vmName, command, { maxAttempts: 2, retryDelayMs: 1500 });
        servicesMarked += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to mark service ${service}: ${message}`);
      }
    }

    logger.info(`Applied blueprint "${sanitizedBlueprint.companyName}" to ${vmName}`, {
      usersCreated,
      documentsDeployed,
      servicesMarked,
      warnings: warnings.length
    });

    return {
      vmName,
      usersCreated,
      documentsDeployed,
      servicesMarked,
      warnings
    };
  }

  async createDecoyFromTemplateAndApply(
    blueprint: CompanyBlueprint,
    options: { templateVmName?: string; vmName?: string } = {}
  ): Promise<CreateAndApplyResult> {
    const generatedVmName = options.vmName
      ? this.sanitizeVmName(options.vmName)
      : await this.getSuggestedVmName(blueprint);
    const vm = await this.createDecoyVmFromTemplate({
      ...options,
      vmName: generatedVmName
    });
    const deployment = await this.applyBlueprintToVM(blueprint, vm.vmName);
    return { vm, deployment };
  }

  async getSuggestedVmName(blueprint: CompanyBlueprint): Promise<string> {
    return this.generateVmName(blueprint.companyName, this.pickPrimaryRole(blueprint));
  }

  async createDecoyVmFromTemplate(
    options: { templateVmName?: string; vmName?: string } = {}
  ): Promise<DecoyVmProvisionResult> {
    const requestedVmName = options.vmName
      ? this.sanitizeVmName(options.vmName)
      : this.generateDecoyVmName();

    return this.withVmOperationLock(requestedVmName, async () => {
      const vagrantDir = await this.vagrantDirPromise;
      if (!vagrantDir) {
        logger.warn('Skipping Vagrant operation — simulation mode or directory not found');
        return {
          vmName: requestedVmName,
          templateVmName: this.sanitizeVmName(options.templateVmName || 'fake-web-01'),
          vmPath: '',
          ipAddress: '',
          created: false
        };
      }

      const templateVmName = this.sanitizeVmName(options.templateVmName || 'fake-web-01');
      const templatePath = path.join(vagrantDir, templateVmName);
      const targetVmPath = path.join(vagrantDir, requestedVmName);

      const templateStat = await this.safeStat(templatePath);
      if (!templateStat || !templateStat.isDirectory()) {
        throw new Error(`Template VM "${templateVmName}" was not found in ${vagrantDir}`);
      }

      const templateVagrantfile = path.join(templatePath, 'Vagrantfile');
      const templateVagrantfileStat = await this.safeStat(templateVagrantfile);
      if (!templateVagrantfileStat) {
        throw new Error(`Template VM "${templateVmName}" does not contain a Vagrantfile`);
      }

      let created = false;
      let ipAddress = '';
      const existingLibvirtVm = await this.vmExists(requestedVmName);

      const targetStat = await this.safeStat(targetVmPath);
      if (existingLibvirtVm) {
        logger.info(`[DEPLOY] VM already exists: ${requestedVmName}, reusing`, {
          vmName: requestedVmName,
          vmPath: targetVmPath
        });

        if (!targetStat) {
          // Rebuild local Vagrant workspace if user deleted folder manually.
          ipAddress = '10.20.20.199';
          await fs.cp(templatePath, targetVmPath, {
            recursive: true,
            force: false,
            filter: (source: string) => !source.includes(`${path.sep}.vagrant${path.sep}`) && path.basename(source) !== '.vagrant'
          });

          const targetVagrantfile = path.join(targetVmPath, 'Vagrantfile');
          const vagrantContent = await fs.readFile(targetVagrantfile, 'utf8');
          const rewritten = this.rewriteTemplateVagrantfile(vagrantContent, requestedVmName, ipAddress);
          await fs.writeFile(targetVagrantfile, rewritten, 'utf8');
        } else if (!targetStat.isDirectory()) {
          throw new Error(`Target VM path exists but is not a directory: ${targetVmPath}`);
        } else {
          const existingVagrantfile = path.join(targetVmPath, 'Vagrantfile');
          const currentContent = await fs.readFile(existingVagrantfile, 'utf8');
          const existingIpMatch = currentContent.match(/ip:\s*"10\.20\.20\.(\d{1,3})"/);
          ipAddress = existingIpMatch ? `10.20.20.${existingIpMatch[1]}` : '10.20.20.199';
        }
      } else if (!targetStat) {
        created = true;
        ipAddress = await this.allocatePrivateIp(vagrantDir);
        await fs.cp(templatePath, targetVmPath, {
          recursive: true,
          force: false,
          filter: (source: string) => !source.includes(`${path.sep}.vagrant${path.sep}`) && path.basename(source) !== '.vagrant'
        });

        const targetVagrantfile = path.join(targetVmPath, 'Vagrantfile');
        const vagrantContent = await fs.readFile(targetVagrantfile, 'utf8');
        const rewritten = this.rewriteTemplateVagrantfile(vagrantContent, requestedVmName, ipAddress);
        await fs.writeFile(targetVagrantfile, rewritten, 'utf8');
      } else if (!targetStat.isDirectory()) {
        throw new Error(`Target VM path exists but is not a directory: ${targetVmPath}`);
      } else {
        const existingVagrantfile = path.join(targetVmPath, 'Vagrantfile');
        const currentContent = await fs.readFile(existingVagrantfile, 'utf8');
        const existingIpMatch = currentContent.match(/ip:\s*"10\.20\.20\.(\d{1,3})"/);
        ipAddress = existingIpMatch ? `10.20.20.${existingIpMatch[1]}` : '10.20.20.199';
      }

      await this.ensureVmRunning(targetVmPath);

      logger.info(`Prepared decoy VM ${requestedVmName} from template ${templateVmName}`, {
        created,
        ipAddress
      });

      return {
        vmName: requestedVmName,
        templateVmName,
        vmPath: targetVmPath,
        ipAddress,
        created
      };
    });
  }

  async vmExists(vmName: string): Promise<boolean> {
    return (await this.resolveExistingDomainName(vmName)) !== null;
  }

  private normalizeInput(input: DecoyGenerationInput): DecoyGenerationInput {
    const industry = String(input.industry || 'Technology').trim();
    const region = String(input.region || 'US').trim();
    const companySizeRaw = Number.isFinite(input.companySize) ? input.companySize : Number(input.companySize);

    return {
      industry: industry || 'Technology',
      companySize: Math.max(10, Math.min(5000, Number.isFinite(companySizeRaw) ? Math.round(companySizeRaw) : 120)),
      region: region || 'US'
    };
  }

  private sanitizeBlueprint(blueprint: CompanyBlueprint): CompanyBlueprint {
    const industry = (blueprint.industry || 'Enterprise').trim() || 'Enterprise';
    const profile = this.normalizeProfile(blueprint.profile, industry);
    const companyName = (blueprint.companyName || 'Maya Holdings').trim() || 'Maya Holdings';

    const seenUsernames = new Set<string>();
    const employees = (Array.isArray(blueprint.employees) ? blueprint.employees : [])
      .slice(0, 60)
      .map((employee, index) => {
        const safeName = (employee?.name || `Employee ${index + 1}`).trim();
        const baseUsername = this.sanitizeUsername(employee?.username || safeName, index);
        let username = baseUsername;
        let suffix = 1;
        while (seenUsernames.has(username)) {
          username = `${baseUsername}${suffix}`;
          suffix += 1;
        }
        seenUsernames.add(username);

        return {
          name: safeName,
          role: (employee?.role || 'Operations Specialist').trim(),
          department: (employee?.department || 'Operations').trim(),
          username
        };
      });

    const techStack = Array.from(
      new Set((Array.isArray(blueprint.techStack) ? blueprint.techStack : []).map((item) => String(item).trim()).filter(Boolean))
    ).slice(0, 20);

    const services = Array.from(
      new Set((Array.isArray(blueprint.services) ? blueprint.services : []).map((item) => String(item).trim()).filter(Boolean))
    ).slice(0, 20);

    const internalServers = (Array.isArray(blueprint.internalServers) ? blueprint.internalServers : [])
      .slice(0, 20)
      .map((server, index) => ({
        name: this.sanitizePathSegment(server?.name || `server-${index + 1}`),
        type: this.normalizeServerType(server?.type)
      }));

    const documents = (Array.isArray(blueprint.documents) ? blueprint.documents : [])
      .slice(0, 60)
      .map((doc, index) => ({
        filename: this.sanitizeFilename(doc?.filename || `document-${index + 1}.txt`, index),
        content: String(doc?.content || '').slice(0, 12000)
      }))
      .filter((doc) => doc.content.trim().length > 0);

    return {
      companyName: companyName.slice(0, 120),
      industry: industry.slice(0, 80),
      profile,
      employees,
      services,
      techStack,
      internalServers,
      documents
    };
  }

  private normalizeServerType(value: unknown): VmRole {
    const candidate = String(value || '').toLowerCase().trim() as VmRole;
    if (SUPPORTED_VM_ROLES.has(candidate)) {
      return candidate;
    }
    return 'web';
  }

  private generateDeterministicBlueprint(input: DecoyGenerationInput): CompanyBlueprint {
    const seed = this.hashSeed(`${Date.now()}|${Math.random()}|${input.industry}|${input.region}`);
    const rng = this.mulberry32(seed);
    const profile = this.pickRandomProfile(rng);
    const companyName = profile.companyName;
    const employeeCount = this.calculateEmployeeCount(input.companySize);
    const employees = this.generateEmployeesFromProfile(profile, employeeCount, rng);
    const techStack = this.generateTechStackFromServices(profile.services, rng);
    const internalServers = profile.serverRoles.map((role, index) => ({
      name: this.buildServerName(companyName, role, index + 1),
      type: role
    }));
    const documents = this.generateDocumentsFromTemplate(profile, companyName, employees, rng);

    return {
      companyName,
      industry: profile.industry,
      profile: profile.id,
      employees,
      services: profile.services,
      techStack,
      internalServers,
      documents
    };
  }

  private normalizeProfile(profile: unknown, industry: string): CompanyBlueprint['profile'] {
    const lowerProfile = String(profile || '').toLowerCase();
    if (lowerProfile === 'fintech' || lowerProfile === 'healthcare' || lowerProfile === 'saas' || lowerProfile === 'enterprise') {
      return lowerProfile;
    }

    const lowerIndustry = industry.toLowerCase();
    if (lowerIndustry.includes('fin')) return 'fintech';
    if (lowerIndustry.includes('health')) return 'healthcare';
    if (lowerIndustry.includes('saas') || lowerIndustry.includes('software')) return 'saas';
    return 'enterprise';
  }

  private pickRandomProfile(rng: () => number): BlueprintTemplateProfile {
    const index = Math.floor(rng() * BLUEPRINT_TEMPLATE_LIBRARY.length);
    return BLUEPRINT_TEMPLATE_LIBRARY[index] || BLUEPRINT_TEMPLATE_LIBRARY[0];
  }

  private generateEmployeesFromProfile(
    profile: BlueprintTemplateProfile,
    count: number,
    rng: () => number
  ): CompanyBlueprint['employees'] {
    const usedUsernames = new Set<string>();
    const employees: CompanyBlueprint['employees'] = [];

    for (let i = 0; i < count; i += 1) {
      const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      const roleSelection = profile.rolePool[Math.floor(rng() * profile.rolePool.length)] || {
        role: 'Operations Analyst',
        department: 'Operations'
      };

      let baseUsername = `${first[0]}${last}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!baseUsername) baseUsername = `user${i + 1}`;
      let username = baseUsername;
      let suffix = 1;
      while (usedUsernames.has(username)) {
        username = `${baseUsername}${suffix}`;
        suffix += 1;
      }
      usedUsernames.add(username);

      employees.push({
        name: `${first} ${last}`,
        role: roleSelection.role,
        department: roleSelection.department,
        username
      });
    }

    return employees;
  }

  private generateTechStackFromServices(services: string[], rng: () => number): string[] {
    const core = ['Linux', 'PostgreSQL', 'Redis', 'Nginx', 'Docker', 'Terraform'];
    const serviceHints = services.map((service) => {
      const lower = service.toLowerCase();
      if (lower.includes('redis')) return 'Redis';
      if (lower.includes('api')) return 'Node.js';
      if (lower.includes('ehr')) return 'FastAPI';
      if (lower.includes('auth') || lower.includes('identity')) return 'Keycloak';
      if (lower.includes('worker')) return 'RabbitMQ';
      if (lower.includes('backup')) return 'Velero';
      return 'TypeScript';
    });
    const extras = ['Grafana', 'Prometheus', 'Vault', 'Kafka', 'GitLab'];
    const stack = [...core, ...serviceHints];
    stack.push(extras[Math.floor(rng() * extras.length)] || 'Grafana');
    stack.push(extras[Math.floor(rng() * extras.length)] || 'Prometheus');
    return Array.from(new Set(stack)).slice(0, 12);
  }

  private generateDocumentsFromTemplate(
    profile: BlueprintTemplateProfile,
    companyName: string,
    employees: CompanyBlueprint['employees'],
    rng: () => number
  ): CompanyBlueprint['documents'] {
    const owner = employees[Math.floor(rng() * Math.max(1, employees.length))] || {
      name: 'Security Team',
      username: 'secops'
    };
    return profile.documents.map((filename, index) => {
      const content = [
        `${companyName} - ${filename}`,
        `Generated: ${new Date().toISOString()}`,
        `Profile: ${profile.industry}`,
        '',
        `Owner: ${owner.name}`,
        `Contact: ${owner.username}@${this.sanitizeCompanySlug(companyName)}.local`,
        '',
        `Record-${index + 1}: ${Math.floor(rng() * 90000) + 10000}`
      ].join('\n');

      return {
        filename: this.sanitizeFilename(filename, index),
        content
      };
    });
  }

  private buildServerName(companyName: string, role: VmRole, index: number): string {
    const companySlug = this.sanitizeCompanySlug(companyName);
    const padded = String(Math.max(1, index)).padStart(2, '0');
    return `${companySlug}-${role}-${padded}`;
  }

  private getIndustryProfile(industry: string): IndustryProfile {
    const normalized = INDUSTRY_ALIASES[industry.toLowerCase()] || 'saas';

    if (normalized === 'fintech') {
      return {
        normalized,
        namePrefixes: ['Ledger', 'Nova', 'Summit', 'Vector', 'Pinnacle', 'Aurora'],
        rolePool: [
          { role: 'Fraud Analyst', department: 'Risk' },
          { role: 'Compliance Officer', department: 'Compliance' },
          { role: 'Treasury Analyst', department: 'Finance' },
          { role: 'Backend Engineer', department: 'Engineering' },
          { role: 'SRE Engineer', department: 'Infrastructure' },
          { role: 'Security Engineer', department: 'Security' },
          { role: 'Customer Operations Specialist', department: 'Operations' }
        ],
        techStack: ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis', 'Kafka', 'Nginx', 'Vault', 'Terraform'],
        internalServers: [
          { name: 'payments-web-01', type: 'web' },
          { name: 'ledger-db-01', type: 'db' },
          { name: 'compliance-fs-01', type: 'fileserver' },
          { name: 'ops-jump-01', type: 'jump' }
        ]
      };
    }

    if (normalized === 'healthcare') {
      return {
        normalized,
        namePrefixes: ['Care', 'Vital', 'Helix', 'NorthStar', 'Harbor', 'Atlas'],
        rolePool: [
          { role: 'Clinical Data Analyst', department: 'Clinical Ops' },
          { role: 'HIPAA Compliance Specialist', department: 'Compliance' },
          { role: 'Platform Engineer', department: 'Engineering' },
          { role: 'IT Support Specialist', department: 'IT' },
          { role: 'Security Analyst', department: 'Security' },
          { role: 'Billing Coordinator', department: 'Revenue Cycle' },
          { role: 'Network Engineer', department: 'Infrastructure' }
        ],
        techStack: ['Python', 'FastAPI', 'PostgreSQL', 'Redis', 'Nginx', 'Prometheus', 'Grafana', 'SFTP'],
        internalServers: [
          { name: 'patient-portal-web-01', type: 'web' },
          { name: 'ehr-db-01', type: 'db' },
          { name: 'records-fs-01', type: 'fileserver' },
          { name: 'it-jump-01', type: 'jump' }
        ]
      };
    }

    if (normalized === 'manufacturing') {
      return {
        normalized,
        namePrefixes: ['Forge', 'Summit', 'Ironwood', 'Delta', 'Prime', 'Cobalt'],
        rolePool: [
          { role: 'Plant Operations Analyst', department: 'Operations' },
          { role: 'ERP Administrator', department: 'IT' },
          { role: 'Procurement Manager', department: 'Supply Chain' },
          { role: 'Quality Engineer', department: 'Quality' },
          { role: 'Security Engineer', department: 'Security' },
          { role: 'Data Engineer', department: 'Analytics' },
          { role: 'Infrastructure Engineer', department: 'Infrastructure' }
        ],
        techStack: ['Java', 'Spring Boot', 'PostgreSQL', 'RabbitMQ', 'Redis', 'Nginx', 'Ansible', 'Docker'],
        internalServers: [
          { name: 'ops-web-01', type: 'web' },
          { name: 'erp-db-01', type: 'db' },
          { name: 'drawings-fs-01', type: 'fileserver' },
          { name: 'ot-jump-01', type: 'jump' }
        ]
      };
    }

    if (normalized === 'retail') {
      return {
        normalized,
        namePrefixes: ['Mercury', 'Market', 'NorthBay', 'Cornerstone', 'BlueLine', 'Peak'],
        rolePool: [
          { role: 'eCommerce Manager', department: 'Digital' },
          { role: 'Inventory Planner', department: 'Supply Chain' },
          { role: 'Frontend Engineer', department: 'Engineering' },
          { role: 'Data Analyst', department: 'Analytics' },
          { role: 'Security Analyst', department: 'Security' },
          { role: 'Finance Associate', department: 'Finance' },
          { role: 'IT Administrator', department: 'IT' }
        ],
        techStack: ['Node.js', 'React', 'PostgreSQL', 'Redis', 'Elasticsearch', 'Nginx', 'Kubernetes', 'Docker'],
        internalServers: [
          { name: 'storefront-web-01', type: 'web' },
          { name: 'orders-db-01', type: 'db' },
          { name: 'finance-fs-01', type: 'fileserver' },
          { name: 'ops-jump-01', type: 'jump' }
        ]
      };
    }

    return {
      normalized: 'saas',
      namePrefixes: ['Nimbus', 'Vertex', 'Axiom', 'Northstar', 'Brightline', 'Pulse'],
      rolePool: [
        { role: 'Product Manager', department: 'Product' },
        { role: 'Backend Engineer', department: 'Engineering' },
        { role: 'Frontend Engineer', department: 'Engineering' },
        { role: 'SRE Engineer', department: 'Infrastructure' },
        { role: 'Security Engineer', department: 'Security' },
        { role: 'Customer Success Manager', department: 'Customer Success' },
        { role: 'Finance Analyst', department: 'Finance' }
      ],
      techStack: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'Nginx', 'Docker', 'Terraform', 'Grafana'],
      internalServers: [
        { name: 'app-web-01', type: 'web' },
        { name: 'primary-db-01', type: 'db' },
        { name: 'shared-fs-01', type: 'fileserver' },
        { name: 'eng-jump-01', type: 'jump' }
      ]
    };
  }

  private generateCompanyName(profile: IndustryProfile, region: string, rng: () => number): string {
    const suffixByRegion = this.getRegionSuffix(region);
    const prefix = profile.namePrefixes[Math.floor(rng() * profile.namePrefixes.length)];
    const endings = ['Systems', 'Holdings', 'Group', 'Partners', 'Dynamics', 'Networks'];
    const ending = endings[Math.floor(rng() * endings.length)];
    return `${prefix} ${ending} ${suffixByRegion}`.trim();
  }

  private generateEmployees(
    profile: IndustryProfile,
    count: number,
    rng: () => number
  ): CompanyBlueprint['employees'] {
    const usedUsernames = new Set<string>();
    const employees: CompanyBlueprint['employees'] = [];

    for (let i = 0; i < count; i += 1) {
      const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      const roleSelection = profile.rolePool[Math.floor(rng() * profile.rolePool.length)];
      const name = `${first} ${last}`;

      let baseUsername = `${first[0]}${last}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!baseUsername) baseUsername = `user${i + 1}`;

      let username = baseUsername;
      let counter = 1;
      while (usedUsernames.has(username)) {
        username = `${baseUsername}${counter}`;
        counter += 1;
      }
      usedUsernames.add(username);

      employees.push({
        name,
        role: roleSelection.role,
        department: roleSelection.department,
        username
      });
    }

    return employees;
  }

  private generateTechStack(profile: IndustryProfile, rng: () => number): string[] {
    const globalTools = ['GitLab', 'Jenkins', 'Datadog', 'OpenVPN', 'Okta', 'Prometheus'];
    const techStack = [...profile.techStack];
    const extras = 2 + Math.floor(rng() * 2);

    for (let i = 0; i < extras; i += 1) {
      techStack.push(globalTools[Math.floor(rng() * globalTools.length)]);
    }

    return Array.from(new Set(techStack)).slice(0, 12);
  }

  private generateInternalServers(
    profile: IndustryProfile,
    rng: () => number
  ): CompanyBlueprint['internalServers'] {
    const servers = [...profile.internalServers];
    if (rng() > 0.5) {
      servers.push({ name: 'analytics-web-01', type: 'web' });
    }
    return servers.slice(0, 8);
  }

  private generateDocuments(
    normalizedIndustry: string,
    companyName: string,
    employees: CompanyBlueprint['employees'],
    rng: () => number
  ): CompanyBlueprint['documents'] {
    const financeContact = employees.find((employee) => employee.department.toLowerCase().includes('finance')) || employees[0];
    const securityContact = employees.find((employee) => employee.department.toLowerCase().includes('security')) || employees[0];

    const documents: CompanyBlueprint['documents'] = [
      {
        filename: 'employee_directory.csv',
        content: [
          'name,role,department,username',
          ...employees.slice(0, 20).map((employee) =>
            `${employee.name},${employee.role},${employee.department},${employee.username}`
          )
        ].join('\n')
      },
      {
        filename: 'vpn_access_requests.txt',
        content: [
          `${companyName} - VPN Access Queue`,
          `Approver: ${securityContact?.name || 'Security Team'}`,
          '',
          ...employees.slice(0, 8).map((employee) => `- ${employee.username} | ${employee.department}`)
        ].join('\n')
      }
    ];

    if (normalizedIndustry === 'fintech') {
      documents.push(
        {
          filename: 'pci_dss_readiness.md',
          content: [
            `# ${companyName} PCI-DSS Readiness`,
            '',
            '1. Database encryption at rest: enabled',
            '2. Redis auth token rotated weekly',
            '3. SSH access limited via jump host',
            '4. Quarterly penetration test scheduled',
            '',
            `Owner: ${securityContact?.name || 'Security Team'}`
          ].join('\n')
        },
        {
          filename: 'q4_salary_reconciliation.csv',
          content: [
            'employee,department,base_salary,bonus',
            ...employees.slice(0, 12).map((employee, index) =>
              `${employee.name},${employee.department},${86000 + index * 2750},${2500 + Math.floor(rng() * 4000)}`
            )
          ].join('\n')
        },
        {
          filename: 'bank_settlement_schedule.txt',
          content: [
            'Settlement windows:',
            '- ACH: 09:00 UTC / 17:00 UTC',
            '- Card rails: every 2 hours',
            '- High-value transfers: manual approval required',
            '',
            `Treasury contact: ${financeContact?.name || 'Finance Operations'}`
          ].join('\n')
        }
      );
    } else if (normalizedIndustry === 'healthcare') {
      documents.push(
        {
          filename: 'hipaa_audit_checklist.md',
          content: [
            '# HIPAA Security Rule Checklist',
            '- Access controls reviewed weekly',
            '- PHI backups validated',
            '- Incident response playbook tested',
            '',
            `Security lead: ${securityContact?.name || 'Security Team'}`
          ].join('\n')
        },
        {
          filename: 'patient_billing_samples.csv',
          content: [
            'invoice_id,department,amount,status',
            'HB-2026-0193,Cardiology,1290.00,Pending',
            'HB-2026-0211,Oncology,8740.00,Paid',
            'HB-2026-0222,Neurology,3200.00,Pending'
          ].join('\n')
        }
      );
    } else if (normalizedIndustry === 'manufacturing') {
      documents.push(
        {
          filename: 'vendor_procurement_sheet.csv',
          content: [
            'vendor,component,lead_time_days,contact',
            'Summit Steel,Alloy Plates,18,procurement@summitsteel.example',
            'Delta Motion,Servo Motor,25,sales@deltamotion.example',
            'Blue Harbor,Industrial Sensors,14,ops@blueharbor.example'
          ].join('\n')
        },
        {
          filename: 'plant_patch_schedule.txt',
          content: [
            'Plant OT patch cadence:',
            '- PLC segments: every Sunday 02:00 local',
            '- Historian nodes: every Wednesday 01:00 local',
            '- Jump host patching: weekly',
            '',
            `Approver: ${securityContact?.name || 'Security Team'}`
          ].join('\n')
        }
      );
    } else if (normalizedIndustry === 'retail') {
      documents.push(
        {
          filename: 'pricing_strategy_q2.txt',
          content: [
            'Q2 pricing actions:',
            '- Bundle discount for top 20 SKUs',
            '- Loyalty coupon pipeline refresh',
            '- Clearance markdown events every Friday'
          ].join('\n')
        },
        {
          filename: 'inventory_replenishment.csv',
          content: [
            'sku,warehouse,current_stock,reorder_point',
            'SKU-1044,WH-EAST,211,175',
            'SKU-2281,WH-WEST,93,140',
            'SKU-3312,WH-CENTRAL,160,120'
          ].join('\n')
        }
      );
    } else {
      documents.push(
        {
          filename: 'oncall_rotation.txt',
          content: [
            `${companyName} On-Call Rotation`,
            '',
            ...employees.slice(0, 7).map((employee, index) => `Week ${index + 1}: ${employee.name} (${employee.role})`)
          ].join('\n')
        },
        {
          filename: 'quarterly_board_summary.md',
          content: [
            '# Quarterly Board Summary',
            '- ARR growth: 8.2%',
            '- Gross retention: 94%',
            '- Critical incidents: 1',
            '- Security backlog closed: 17 tickets'
          ].join('\n')
        }
      );
    }

    return documents.map((doc, index) => ({
      filename: this.sanitizeFilename(doc.filename, index),
      content: doc.content
    }));
  }

  private calculateEmployeeCount(companySize: number): number {
    const scaled = Math.round(companySize * 0.16);
    return Math.max(8, Math.min(40, scaled));
  }

  private getRegionSuffix(region: string): string {
    const normalized = region.toLowerCase();
    if (normalized.includes('us') || normalized.includes('north america')) return 'USA';
    if (normalized.includes('europe') || normalized.includes('eu')) return 'EU';
    if (normalized.includes('apac') || normalized.includes('asia')) return 'APAC';
    if (normalized.includes('middle east')) return 'MEA';
    return region.replace(/[^a-z0-9 ]/gi, '').toUpperCase() || 'GLOBAL';
  }

  private buildBashHistory(
    employee: CompanyBlueprint['employees'][number],
    industry: string
  ): string[] {
    const generic = [
      'ls -la',
      'cd ~/Documents',
      'cat employee_directory.csv | head -n 5',
      'ssh -J ops-jump-01 internal-db-01',
      'tail -n 50 /var/log/auth.log',
      'vim notes.txt'
    ];

    const lowerIndustry = industry.toLowerCase();
    if (lowerIndustry.includes('fin')) {
      generic.push('psql -h ledger-db-01 -U reporting readonly_ledger');
      generic.push('redis-cli -h cache.internal INFO');
    } else if (lowerIndustry.includes('health')) {
      generic.push('grep -R "audit" /opt/compliance/reports');
      generic.push('sftp records@records-fs-01:/dropbox/claims');
    } else if (lowerIndustry.includes('manufactur')) {
      generic.push('scp patch_bundle.tar.gz ot-jump-01:/tmp');
      generic.push('ssh ot-jump-01 "systemctl status telemetry-agent"');
    } else if (lowerIndustry.includes('retail') || lowerIndustry.includes('commerce')) {
      generic.push('curl -s http://storefront-web-01/healthz');
      generic.push('python3 scripts/reconcile_inventory.py --region=us-east');
    }

    generic.push(`echo "Updated by ${employee.username}" >> ~/notes.txt`);
    return generic.slice(0, 9);
  }

  private generateDecoyPassword(username: string): string {
    const seed = this.hashSeed(username);
    const fragment = (seed % 9000 + 1000).toString();
    return `${username[0].toUpperCase()}${username.slice(1)}!${fragment}`;
  }

  private async tryGenerateWithOpenAI(input: DecoyGenerationInput): Promise<CompanyBlueprint | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const prompt = [
      'Generate one realistic cybersecurity deception company blueprint.',
      'Return strict JSON with these keys only:',
      'companyName, industry, profile, employees, services, techStack, internalServers, documents',
      'profile must be one of: fintech, healthcare, saas, enterprise',
      'employees[] keys: name, role, department, username',
      'internalServers[].type must be one of: web, auth, db, payments, api, worker, cache, ehr, backup, fileserver, jump',
      'documents[] keys: filename, content',
      `Industry: ${input.industry}`,
      `Company size (headcount): ${input.companySize}`,
      `Region: ${input.region}`,
      'Focus on realism for decoy infrastructure and believable internal artifacts.'
    ].join('\n');

    try {
      const raw = await this.callOpenAI(apiKey, prompt);
      const parsed = JSON.parse(this.extractJson(raw)) as unknown;

      if (!this.isBlueprintShape(parsed)) {
        logger.warn('OpenAI returned invalid blueprint JSON shape, using deterministic fallback');
        return null;
      }

      const blueprint = this.sanitizeBlueprint({
        ...parsed,
        industry: input.industry
      });

      if (blueprint.employees.length === 0 || blueprint.internalServers.length === 0) {
        logger.warn('OpenAI blueprint missing core fields, using deterministic fallback');
        return null;
      }

      return blueprint;
    } catch (error) {
      logger.warn(`OpenAI blueprint generation failed, falling back to deterministic mode: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // Optional LLM path: direct HTTPS call keeps this service dependency-light.
  private async callOpenAI(apiKey: string, prompt: string): Promise<string> {
    const payload = JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You generate realistic enterprise decoy environments for cybersecurity deception. Return valid JSON only.'
        },
        { role: 'user', content: prompt }
      ]
    });

    return new Promise<string>((resolve, reject) => {
      const request = https.request(
        {
          hostname: 'api.openai.com',
          port: 443,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () => {
            const statusCode = response.statusCode || 500;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`OpenAI API request failed with status ${statusCode}: ${body.slice(0, 300)}`));
              return;
            }

            try {
              const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
              const content = parsed.choices?.[0]?.message?.content;
              if (!content) {
                reject(new Error('OpenAI API response missing assistant content'));
                return;
              }
              resolve(content);
            } catch (error) {
              reject(new Error(`Invalid OpenAI API response: ${error instanceof Error ? error.message : String(error)}`));
            }
          });
        }
      );

      request.setTimeout(18000, () => {
        request.destroy(new Error('OpenAI API request timed out'));
      });

      request.on('error', (error) => reject(error));
      request.write(payload);
      request.end();
    });
  }

  private isBlueprintShape(value: unknown): value is CompanyBlueprint {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<CompanyBlueprint>;
    if (typeof candidate.companyName !== 'string' || typeof candidate.industry !== 'string') return false;
    if (!Array.isArray(candidate.employees) || !Array.isArray(candidate.techStack)) return false;
    if (!Array.isArray(candidate.internalServers) || !Array.isArray(candidate.documents)) return false;
    if (candidate.services && !Array.isArray(candidate.services)) return false;
    return true;
  }

  private extractJson(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('OpenAI response did not include JSON');
    }
    return match[0];
  }

  private async resolveVagrantDir(): Promise<string | null> {
    if (process.env.SIMULATION_MODE === 'true') {
      return null;
    }

    const candidates = [
      process.env.VAGRANT_DIR ? path.resolve(process.env.VAGRANT_DIR) : undefined,
      path.resolve(process.cwd(), '../simulations/fake'),
      path.resolve(process.cwd(), 'simulations/fake'),
      path.resolve(__dirname, '../../../simulations/fake')
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue candidate search.
      }
    }

    return null;
  }

  private async safeStat(targetPath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
    try {
      return await fs.stat(targetPath);
    } catch {
      return null;
    }
  }

  private async allocatePrivateIp(vagrantDir: string): Promise<string> {
    const used = new Set<number>();
    const entries = await fs.readdir(vagrantDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const vagrantfilePath = path.join(vagrantDir, entry.name, 'Vagrantfile');
      const stat = await this.safeStat(vagrantfilePath);
      if (!stat) continue;

      const content = await fs.readFile(vagrantfilePath, 'utf8');
      const match = content.match(/ip:\s*"10\.20\.20\.(\d{1,3})"/);
      if (match) {
        const octet = Number(match[1]);
        if (Number.isInteger(octet)) used.add(octet);
      }
    }

    for (let octet = 150; octet <= 240; octet += 1) {
      if (!used.has(octet)) return `10.20.20.${octet}`;
    }

    throw new Error('No available IP address found in 10.20.20.150-240 for new decoy VM');
  }

  private rewriteTemplateVagrantfile(content: string, vmName: string, ipAddress: string): string {
    let updated = content;

    if (/config\.vm\.hostname\s*=\s*"[^"]*"/.test(updated)) {
      updated = updated.replace(/config\.vm\.hostname\s*=\s*"[^"]*"/, `config.vm.hostname = "${vmName}"`);
    } else {
      throw new Error('Template Vagrantfile is missing config.vm.hostname');
    }

    if (/ip:\s*"\d+\.\d+\.\d+\.\d+"/.test(updated)) {
      updated = updated.replace(/ip:\s*"\d+\.\d+\.\d+\.\d+"/, `ip: "${ipAddress}"`);
    } else {
      throw new Error('Template Vagrantfile is missing private network IP configuration');
    }

    return updated;
  }

  private async ensureVmRunning(vmPath: string): Promise<void> {
    const vmName = path.basename(vmPath);
    const initialLibvirtState = await this.getLibvirtVmState(vmName);
    if (initialLibvirtState === 'running') {
      return;
    }

    if (initialLibvirtState === 'stopped') {
      const started = await this.tryStartLibvirtVm(vmName);
      if (started) {
        return;
      }
    }

    const initialState = await this.getVagrantMachineState(vmPath);
    if (initialState === 'running') {
      return;
    }

    logger.info(`[DEPLOY] VM startup required`, { vmPath, state: initialState });

    const startAttempts = [
      {
        label: 'Fast start',
        command: 'timeout 900 vagrant up --provider=libvirt --no-provision',
        timeoutMs: 930000
      },
      {
        label: 'Full start',
        command: 'timeout 1200 vagrant up --provider=libvirt',
        timeoutMs: 1230000
      }
    ] as const;

    let lastError = 'unknown VM startup failure';

    for (const mode of startAttempts) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const cmd = [
          `cd ${this.shellQuote(vmPath)}`,
          mode.command
        ].join(' && ');

        try {
          await execAsync(cmd, { timeout: mode.timeoutMs, maxBuffer: 1024 * 1024 * 8 });
          if (await this.isVmRunning(vmPath) || await this.isLibvirtVmRunning(vmName)) {
            return;
          }
          lastError = `${mode.label} completed but VM did not report running state`;
        } catch (error) {
          const formattedError = this.formatExecError(error);
          lastError = `${mode.label} attempt ${attempt}: ${formattedError}`;

          if (await this.isVmRunning(vmPath) || await this.isLibvirtVmRunning(vmName)) {
            return;
          }

          if (this.isDomainNameTakenError(formattedError)) {
            logger.warn(`Detected libvirt domain name conflict for ${vmPath}; attempting recovery`, {
              vmPath,
              attempt,
              mode: mode.label
            });
            await this.recoverDomainNameConflict(vmPath);
            await this.sleep(2500);
            continue;
          }

          if (this.isVolumeConflictError(formattedError)) {
            logger.warn(`Detected libvirt volume conflict for ${vmPath}; attempting recovery`, {
              vmPath,
              attempt,
              mode: mode.label
            });
            await this.recoverStorageVolumeConflict(vmPath);
            await this.sleep(2500);
            continue;
          }

          const retryable = this.isTransientVmCommandError(lastError);
          if (!retryable || attempt >= 3) {
            break;
          }

          const delayMs = 3000 * attempt;
          logger.warn(`Transient VM startup failure at ${vmPath}; retrying ${mode.label} in ${delayMs}ms`, {
            vmPath,
            attempt,
            mode: mode.label
          });
          await this.sleep(delayMs);
        }
      }
    }

    if (await this.isLibvirtVmRunning(vmName)) {
      return;
    }

    throw new Error(`Failed to start VM in ${vmPath}. ${lastError}`);
  }

  private isDomainNameTakenError(message: string): boolean {
    const lower = String(message || '').toLowerCase();
    return (
      lower.includes('name `') &&
      lower.includes('of domain about to create is already taken')
    ) || lower.includes('domain about to create is already taken');
  }

  private isVolumeConflictError(message: string): boolean {
    const lower = String(message || '').toLowerCase();
    return (
      lower.includes('volume for domain is already created') ||
      (lower.includes('volume') && lower.includes('already created'))
    );
  }

  private async recoverDomainNameConflict(vmPath: string): Promise<void> {
    const vmName = path.basename(vmPath);
    const domainNames = [vmName, `${vmName}_default`];

    const destroyCmd = [
      `cd ${this.shellQuote(vmPath)}`,
      'timeout 120 vagrant destroy -f'
    ].join(' && ');
    await this.execIgnoreFailure(destroyCmd, 130000);

    for (const domainName of domainNames) {
      const hardCleanupCommands = [
        `timeout 30 virsh -c qemu:///system destroy ${this.shellQuote(domainName)}`,
        `timeout 30 virsh -c qemu:///system undefine ${this.shellQuote(domainName)} --nvram`,
        `timeout 30 virsh -c qemu:///system undefine ${this.shellQuote(domainName)}`
      ];

      for (const cmd of hardCleanupCommands) {
        await this.execIgnoreFailure(cmd, 35000);
      }
    }

    await fs.rm(path.join(vmPath, '.vagrant', 'machines', 'default', 'libvirt'), { recursive: true, force: true });
  }

  private async recoverStorageVolumeConflict(vmPath: string): Promise<void> {
    const vmName = path.basename(vmPath);
    await this.recoverDomainNameConflict(vmPath);

    const cleanVolumesCmd = [
      `vm_name=${this.shellQuote(vmName)}`,
      'for pool in $(virsh -c qemu:///system pool-list --name 2>/dev/null | sed \'/^$/d\'); do',
      '  for vol in $(virsh -c qemu:///system vol-list "$pool" --name 2>/dev/null | sed \'/^$/d\' | grep -F "$vm_name" || true); do',
      '    timeout 25 virsh -c qemu:///system vol-delete --pool "$pool" "$vol" >/dev/null 2>&1 || true',
      '  done',
      'done'
    ].join(' ; ');

    await this.execIgnoreFailure(cleanVolumesCmd, 90000);
  }

  private async execIgnoreFailure(command: string, timeoutMs: number): Promise<void> {
    try {
      await execAsync(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4 });
    } catch {
      // Best-effort cleanup only.
    }
  }

  private async isVmRunning(vmPath: string): Promise<boolean> {
    const state = await this.getVagrantMachineState(vmPath);
    return state === 'running';
  }

  private async getVagrantMachineState(vmPath: string): Promise<'running' | 'poweroff' | 'not_created' | 'unknown'> {
    const statusCmd = [
      `cd ${this.shellQuote(vmPath)}`,
      'timeout 12 vagrant status --machine-readable 2>/dev/null || echo ""'
    ].join(' && ');

    try {
      const { stdout } = await execAsync(statusCmd, { timeout: 15000, maxBuffer: 1024 * 1024 });
      const statusLine = stdout
        .split('\n')
        .filter((line) => line.includes(',state,'))
        .pop();

      const rawState = statusLine ? statusLine.split(',')[3] : '';
      const normalized = String(rawState || '').trim().toLowerCase();
      if (normalized === 'running') return 'running';
      if (normalized === 'poweroff' || normalized === 'shutoff' || normalized === 'saved') return 'poweroff';
      if (normalized === 'aborted' || normalized === 'inaccessible') return 'poweroff';
      if (normalized === 'not_created' || normalized === 'not created') return 'not_created';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async withVmOperationLock<T>(vmName: string, task: () => Promise<T>): Promise<T> {
    const lockKey = this.sanitizeVmName(vmName);
    const previous = this.vmOperationLocks.get(lockKey) || Promise.resolve();

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate, () => gate);
    this.vmOperationLocks.set(lockKey, current);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      if (release) {
        release();
      }
      if (this.vmOperationLocks.get(lockKey) === current) {
        this.vmOperationLocks.delete(lockKey);
      }
    }
  }

  private async resolveExistingDomainName(vmName: string): Promise<string | null> {
    const sanitizedVmName = this.sanitizeVmName(vmName);
    const candidates = [sanitizedVmName, `${sanitizedVmName}_default`];

    for (const candidate of candidates) {
      const cmd = `timeout 8 virsh -c qemu:///system dominfo ${this.shellQuote(candidate)} >/dev/null 2>&1`;
      try {
        await execAsync(cmd, { timeout: 10000, maxBuffer: 1024 * 1024 });
        return candidate;
      } catch {
        // Continue checking fallback domain naming patterns.
      }
    }

    return null;
  }

  private async isLibvirtVmRunning(vmName: string): Promise<boolean> {
    return (await this.getLibvirtVmState(vmName)) === 'running';
  }

  private async getLibvirtVmState(vmName: string): Promise<'running' | 'stopped' | 'missing' | 'unknown'> {
    const sanitizedVmName = this.sanitizeVmName(vmName);
    const candidates = [sanitizedVmName, `${sanitizedVmName}_default`];
    let sawExistingState = false;

    for (const candidate of candidates) {
      const cmd = `timeout 8 virsh -c qemu:///system domstate ${this.shellQuote(candidate)} 2>/dev/null`;
      try {
        const { stdout } = await execAsync(cmd, { timeout: 10000, maxBuffer: 1024 * 1024 });
        const state = String(stdout || '').trim().toLowerCase();
        if (!state) continue;
        sawExistingState = true;
        if (state.includes('running') || state.includes('paused') || state.includes('blocked')) {
          return 'running';
        }
        if (state.includes('shut') || state.includes('off') || state.includes('crash') || state.includes('pmsuspended')) {
          return 'stopped';
        }
      } catch {
        // Continue candidate checks.
      }
    }

    return sawExistingState ? 'unknown' : 'missing';
  }

  private async tryStartLibvirtVm(vmName: string): Promise<boolean> {
    const domainName = await this.resolveExistingDomainName(vmName);
    if (!domainName) {
      return false;
    }

    const startCmd = `timeout 45 virsh -c qemu:///system start ${this.shellQuote(domainName)} >/dev/null 2>&1`;
    await this.execIgnoreFailure(startCmd, 50000);
    return (await this.getLibvirtVmState(vmName)) === 'running';
  }

  private async waitForVmReadiness(vmName: string): Promise<void> {
    const maxAttempts = 3;
    const baseDelayMs = 1500;
    let lastErrorMessage = 'unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.probeVmReadiness(vmName);
        return;
      } catch (error) {
        lastErrorMessage = error instanceof Error ? error.message : String(error);
        const canRetry = this.isTransientVmCommandError(lastErrorMessage);
        if (!canRetry || attempt === maxAttempts) {
          break;
        }

        const delayMs = baseDelayMs * attempt;
        logger.warn(`VM ${vmName} not ready yet (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`, {
          vmName,
          attempt,
          maxAttempts
        });
        await this.sleep(delayMs);
      }
    }

    throw new Error(`VM ${vmName} is not ready for blueprint apply: ${lastErrorMessage}`);
  }

  private async probeVmReadiness(vmName: string): Promise<void> {
    const vagrantDir = await this.vagrantDirPromise;
    if (!vagrantDir) {
      logger.warn('Skipping Vagrant operation — simulation mode or directory not found');
      return;
    }

    const vmPath = path.join(vagrantDir, vmName);
    const readinessCmd = [
      `cd ${this.shellQuote(vmPath)}`,
      'timeout 8 vagrant ssh -c "echo maya-decoy-ready >/dev/null"'
    ].join(' && ');

    try {
      await execAsync(readinessCmd, { timeout: 11000, maxBuffer: 1024 * 1024 });
    } catch (error) {
      const formatted = this.formatExecError(error);
      throw new Error(`readiness probe failed: ${formatted}`);
    }
  }

  private async executeOnVm(vmName: string, command: string, options: VmCommandOptions = {}): Promise<void> {
    const vagrantDir = await this.vagrantDirPromise;
    if (!vagrantDir) {
      logger.warn('Skipping Vagrant operation — simulation mode or directory not found');
      return;
    }

    const escapedCommand = this.escapeForDoubleQuotes(command);
    const timeoutSeconds = 25;
    const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    const retryDelayMs = Math.max(200, options.retryDelayMs ?? 1200);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Preferred command path for multi-machine Vagrant projects.
      const firstAttempt = [
        `cd ${this.shellQuote(vagrantDir)}`,
        `timeout ${timeoutSeconds} vagrant ssh ${this.shellQuote(vmName)} -c "${escapedCommand}"`
      ].join(' && ');

      try {
        await execAsync(firstAttempt, { timeout: 30000, maxBuffer: 1024 * 1024 });
        return;
      } catch (firstError) {
        const vmPath = path.join(vagrantDir, vmName);
        // Fallback for this repository layout where each VM has its own Vagrantfile directory.
        const fallbackAttempt = [
          `cd ${this.shellQuote(vmPath)}`,
          `timeout ${timeoutSeconds} vagrant ssh -c "${escapedCommand}"`
        ].join(' && ');

        try {
          await execAsync(fallbackAttempt, { timeout: 30000, maxBuffer: 1024 * 1024 });
          return;
        } catch (fallbackError) {
          const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          const merged = `Vagrant command failed for ${vmName}. Primary: ${firstMessage}. Fallback: ${fallbackMessage}`;
          const retryable = this.isTransientVmCommandError(merged);

          if (!retryable || attempt >= maxAttempts) {
            throw new Error(merged);
          }

          logger.warn(`Transient VM command failure on ${vmName}; retrying (${attempt}/${maxAttempts})`, {
            vmName,
            attempt,
            maxAttempts
          });
          await this.sleep(retryDelayMs * attempt);
        }
      }
    }
  }

  private isTransientVmCommandError(message: string): boolean {
    const lower = String(message || '').toLowerCase();
    return (
      lower.includes('is locked') ||
      lower.includes('currently reading or modifying the machine') ||
      lower.includes('connection refused') ||
      lower.includes('connection reset') ||
      lower.includes('connection timed out') ||
      lower.includes('operation timed out') ||
      lower.includes('timed out') ||
      lower.includes('timeout') ||
      lower.includes('temporarily unavailable') ||
      lower.includes('failed to connect') ||
      lower.includes('no route to host') ||
      lower.includes('could not resolve host') ||
      lower.includes('handshake') ||
      lower.includes('machine is not ready') ||
      lower.includes('code=124') ||
      lower.includes('signal=sigterm') ||
      lower.includes('signal=sigkill')
    );
  }

  private formatExecError(error: unknown): string {
    if (error && typeof error === 'object') {
      const withMeta = error as Error & {
        stderr?: string;
        stdout?: string;
        code?: number | string;
        signal?: string;
      };
      const parts: string[] = [withMeta.message || String(error)];
      if (withMeta.code !== undefined) parts.push(`code=${String(withMeta.code)}`);
      if (withMeta.signal) parts.push(`signal=${withMeta.signal}`);

      const stderr = String(withMeta.stderr || '').trim();
      if (stderr) parts.push(`stderr=${stderr.slice(0, 800)}`);
      const stdout = String(withMeta.stdout || '').trim();
      if (stdout) parts.push(`stdout=${stdout.slice(0, 300)}`);
      return parts.join(' | ');
    }
    return String(error);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private sanitizeUsername(raw: string, index: number): string {
    const cleaned = raw
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/^[^a-z]+/g, '');
    if (cleaned.length > 0) {
      return cleaned.slice(0, 24);
    }
    return `employee${index + 1}`;
  }

  private sanitizeFilename(raw: string, index: number): string {
    const separatorIndex = raw.lastIndexOf('.');
    const baseNameRaw = separatorIndex > 0 ? raw.slice(0, separatorIndex) : raw;
    const extensionRaw = separatorIndex > 0 ? raw.slice(separatorIndex + 1) : '';
    const baseName = (baseNameRaw || `document_${index + 1}`)
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64);
    const extension = (extensionRaw || 'txt')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8);
    return `${baseName || `document_${index + 1}`}.${extension || 'txt'}`;
  }

  private sanitizePathSegment(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40) || 'resource';
  }

  async generateVmName(companyName: string, role: string): Promise<string> {
    const normalizedCompany = this.sanitizeCompanySlug(companyName);
    const normalizedRole = this.normalizeVmRole(role);
    const prefix = `${normalizedCompany}-${normalizedRole}`;
    const pattern = new RegExp(`^${prefix}-(\\d{1,3})$`);

    const vagrantDir = await this.vagrantDirPromise;
    if (!vagrantDir) {
      logger.warn('Skipping Vagrant operation — simulation mode or directory not found');
      return `${prefix}-01`;
    }

    const entries = await fs.readdir(vagrantDir, { withFileTypes: true });
    let highestIndex = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(pattern);
      if (!match) continue;
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > highestIndex) {
        highestIndex = parsed;
      }
    }

    return `${prefix}-${String(highestIndex + 1).padStart(2, '0')}`;
  }

  private pickPrimaryRole(blueprint: CompanyBlueprint): VmRole {
    const firstServer = blueprint.internalServers?.[0];
    if (firstServer?.type) {
      return this.normalizeServerType(firstServer.type);
    }
    return 'web';
  }

  private sanitizeCompanySlug(companyName: string): string {
    const cleaned = String(companyName || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const rawTokens = cleaned.split(' ').filter(Boolean);
    const stopWords = new Set(['systems', 'system', 'health', 'cloud', 'enterprise', 'group', 'inc', 'corp', 'llc']);
    const meaningful = rawTokens.filter((token) => !stopWords.has(token));
    const selected = meaningful[0] || rawTokens[0] || '';
    return selected || 'decoy';
  }

  private normalizeVmRole(role: string): VmRole {
    const normalized = String(role || '').trim().toLowerCase() as VmRole;
    if (SUPPORTED_VM_ROLES.has(normalized)) return normalized;
    return 'web';
  }

  private sanitizeVmName(raw: string): string {
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    return cleaned.slice(0, 48) || this.generateDecoyVmName();
  }

  private generateDecoyVmName(): string {
    const fragment = Date.now().toString().slice(-4);
    return `decoy-web-${fragment}`;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private escapeForDoubleQuotes(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
  }

  private hashSeed(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
