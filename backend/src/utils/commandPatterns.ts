// Command-to-technique mapping logic

// src/utils/commandPatterns.ts
import { MitreTechnique } from '../models/MitreTechnique';

// High-confidence command signatures manually curated
// These supplement the auto-extracted patterns from MITRE detection descriptions
export const COMMAND_SIGNATURES: Record<string, string[]> = {
  // Credential Access
  'mimikatz': ['T1003.001', 'T1003.002', 'T1003.004', 'T1003.006', 'T1550.002', 'T1550.003'],
  'sekurlsa::logonpasswords': ['T1003.001'],
  'sekurlsa::pth': ['T1550.002'],
  'kerberos::ptt': ['T1550.003'],
  'lsadump::sam': ['T1003.002'],
  'lsadump::secrets': ['T1003.004'],
  'lsadump::cache': ['T1003.005'],
  'token::elevate': ['T1134.001'],
  'vault::cred': ['T1005'],
  
  // Discovery
  'whoami': ['T1033'],
  'whoami /priv': ['T1033', 'T1069.001'],
  'whoami /groups': ['T1033', 'T1069.001'],
  'systeminfo': ['T1082'],
  'hostname': ['T1082'],
  'tasklist': ['T1057'],
  'tasklist /v': ['T1057', 'T1033'],
  'taskkill': ['T1489'],
  'netstat': ['T1049'],
  'netstat -an': ['T1049'],
  'ipconfig': ['T1016'],
  'ipconfig /all': ['T1016'],
  'arp -a': ['T1018'],
  'route print': ['T1016'],
  'nltest': ['T1016', 'T1482'],
  'nltest /domain_trusts': ['T1482'],
  'nslookup': ['T1018'],
  'net view': ['T1135'],
  'net share': ['T1135'],
  'net use': ['T1021.002', 'T1077'],
  'net user': ['T1087.001', 'T1136.001'],
  'net localgroup': ['T1087.001', 'T1098'],
  'net group': ['T1087.002', 'T1098'],
  'net accounts': ['T1087.001'],
  'qwinsta': ['T1033'],
  'quser': ['T1033'],
  'query user': ['T1033'],
  
  // Execution
  'powershell': ['T1059.001'],
  'powershell -enc': ['T1059.001', 'T1027'],
  'powershell -ep bypass': ['T1059.001', 'T1055'],
  'pwsh': ['T1059.001'],
  'cmd.exe': ['T1059.003'],
  'cmd /c': ['T1059.003'],
  'wscript': ['T1059.005'],
  'cscript': ['T1059.005'],
  'mshta': ['T1218.005'],
  'rundll32': ['T1218.011', 'T1055'],
  'regsvr32': ['T1218.010'],
  'regsvr32 /s': ['T1218.010'],
  'wmic': ['T1047'],
  'wmic process call create': ['T1047', 'T1059.003'],
  'wmic /node': ['T1047', 'T1021.002'],
  'certutil': ['T1105', 'T1027', 'T1036'],
  'certutil -urlcache': ['T1105'],
  'certutil -encode': ['T1027'],
  'certutil -decode': ['T1027'],
  'bitsadmin': ['T1197', 'T1105'],
  'csc': ['T1027.004'],
  'vbc': ['T1027.004'],
  
  // Persistence
  'schtasks': ['T1053.005'],
  'schtasks /create': ['T1053.005'],
  'at.exe': ['T1053.002'],
  'reg add': ['T1112', 'T1547.001'],
  'reg query': ['T1012'],
  'regedit': ['T1112'],
  'sc create': ['T1543.003'],
  'sc config': ['T1543.003'],
  'sc start': ['T1543.003'],
  'net start': ['T1569.002'],
  'wevtutil': ['T1070.001'],
  'auditpol': ['T1562.002'],
  
  // Defense Evasion
  'vssadmin delete shadows': ['T1490'],
  'vssadmin resize shadowstorage': ['T1490'],
  'wbadmin delete catalog': ['T1490'],
  'bcdedit': ['T1490', 'T1542.003'],
  'fsutil usn deletejournal': ['T1070.004'],
  'takeown': ['T1222.001'],
  'icacls': ['T1222.001'],
  'attrib +h': ['T1564.001'],
  'attrib +s +h': ['T1564.001'],
  'copy \\windows\\system32\\sethc.exe': ['T1546.008'],
  'sethc.exe': ['T1546.008'],
  'utilman.exe': ['T1546.008'],
  'magnify.exe': ['T1546.008'],
  'narrator.exe': ['T1546.008'],
  'osk.exe': ['T1546.008'],
  'sdelete': ['T1070.004'],
  'cipher /w': ['T1070.004'],
  'format': ['T1561.001'],
  'diskpart': ['T1561.001'],
  
  // Lateral Movement
  'psexec': ['T1569.002', 'T1021.002'],
  'psexec.exe': ['T1569.002', 'T1021.002'],
  'psexec64.exe': ['T1569.002', 'T1021.002'],
  'wmiexec': ['T1047', 'T1021.002'],
  'smbexec': ['T1021.002'],
  'mmcexec': ['T1218.007'],
  'winrm': ['T1021.006'],
  'winrs': ['T1021.006'],
  'remote desktop': ['T1021.001'],
  'mstsc': ['T1021.001'],
  'ssh': ['T1021.004'],
  'scp': ['T1105'],
  'sftp': ['T1105'],
  
  // Collection
  'rar': ['T1560.001'],
  '7z': ['T1560.001'],
  'zip': ['T1560.001'],
  'compress-archive': ['T1560.001'],
  ' robocopy ': ['T1105', 'T1036'],
  'xcopy': ['T1105'],
  'copy \\\\': ['T1105'],
  
  // Exfiltration
  'ftp': ['T1048.003'],
  'tftp': ['T1048.003'],
  'curl': ['T1105', 'T1048.003'],
  'wget': ['T1105', 'T1048.003'],
  'Invoke-WebRequest': ['T1105'],
  'Start-BitsTransfer': ['T1197'],
  
  // Command and Control
  'nc': ['T1095'],
  'ncat': ['T1095'],
  'netcat': ['T1095'],
  'socat': ['T1095'],
  'openssl s_client': ['T1573'],
};

// Regex patterns for fuzzy matching
export const REGEX_PATTERNS: Array<{ pattern: RegExp; techniques: string[]; name: string }> = [
  { pattern: /mimikatz|sekurlsa|kerberos::|lsadump::/i, techniques: ['T1003'], name: 'Mimikatz variants' },
  { pattern: /powershell.*-enc/i, techniques: ['T1059.001', 'T1027'], name: 'Encoded PowerShell' },
  { pattern: /powershell.*bypass/i, techniques: ['T1059.001'], name: 'PowerShell Bypass' },
  { pattern: /rundll32.*\.dll/i, techniques: ['T1218.011'], name: 'Rundll32 execution' },
  { pattern: /regsvr32.*\/s/i, techniques: ['T1218.010'], name: 'Regsvr32 silent' },
  { pattern: /certutil.*urlcache/i, techniques: ['T1105'], name: 'Certutil download' },
  { pattern: /vssadmin.*delete/i, techniques: ['T1490'], name: 'Shadow copy deletion' },
  { pattern: /net.*user.*\/add/i, techniques: ['T1136.001'], name: 'User creation' },
  { pattern: /net.*localgroup.*administrators/i, techniques: ['T1098'], name: 'Admin group modification' },
  { pattern: /wmic.*process.*call.*create/i, techniques: ['T1047'], name: 'WMIC execution' },
  { pattern: /schtasks.*\/create/i, techniques: ['T1053.005'], name: 'Scheduled task creation' },
  { pattern: /reg.*add.*run/i, techniques: ['T1547.001'], name: 'Run key persistence' },
  { pattern: /psexec|psexec64/i, techniques: ['T1569.002'], name: 'PsExec execution' },
  { pattern: /wevtutil.*cl/i, techniques: ['T1070.001'], name: 'Event log clearing' },
  { pattern: /fsutil.*usn.*deletejournal/i, techniques: ['T1070.004'], name: 'USN journal deletion' },
  { pattern: /icacls.*\/grant/i, techniques: ['T1222.001'], name: 'Permission modification' },
  { pattern: /takeown.*\/f/i, techniques: ['T1222.001'], name: 'File ownership takeover' },
  { pattern: /attrib.*\+h.*\+s/i, techniques: ['T1564.001'], name: 'Hidden system file' },
  { pattern: /copy.*sethc\.exe/i, techniques: ['T1546.008'], name: 'Sticky keys backdoor' },
  { pattern: /bcdedit.*bootstatuspolicy.*ignoreallfailures/i, techniques: ['T1490'], name: 'Boot recovery disable' },
];

/**
 * Classify a command against MITRE techniques
 */
export async function classifyCommand(command: string): Promise<{
  primary: { techniqueId: string; confidence: number; method: string } | null;
  allMatches: Array<{ techniqueId: string; confidence: number; method: string; pattern: string }>;
}> {
  const normalizedCmd = command.toLowerCase().trim();
  const matches: Array<{ techniqueId: string; confidence: number; method: string; pattern: string }> = [];
  
  // 1. Exact signature matching (highest confidence)
  for (const [signature, techniques] of Object.entries(COMMAND_SIGNATURES)) {
    if (normalizedCmd.includes(signature.toLowerCase())) {
      techniques.forEach(techId => {
        // Confidence based on signature specificity (longer = more specific)
        const confidence = Math.min(0.95, 0.7 + (signature.length / 100));
        matches.push({
          techniqueId: techId,
          confidence,
          method: 'exact',
          pattern: signature
        });
      });
    }
  }
  
  // 2. Regex pattern matching (medium confidence)
  for (const { pattern, techniques, name } of REGEX_PATTERNS) {
    if (pattern.test(normalizedCmd)) {
      techniques.forEach(techId => {
        matches.push({
          techniqueId: techId,
          confidence: 0.75,
          method: 'pattern',
          pattern: name
        });
      });
    }
  }
  
  // 3. Database lookup for command patterns extracted from MITRE detection descriptions
  const dbMatches = await MitreTechnique.find({
    commandPatterns: { $in: normalizedCmd.split(/\s+/) }
  }).limit(5);
  
  for (const tech of dbMatches) {
    const matchingPatterns = tech.commandPatterns.filter(p => normalizedCmd.includes(p));
    if (matchingPatterns.length > 0) {
      matches.push({
        techniqueId: tech.techniqueId,
        confidence: 0.6,
        method: 'database',
        pattern: matchingPatterns[0]
      });
    }
  }
  
  // Deduplicate and sort by confidence
  const seen = new Set<string>();
  const uniqueMatches = matches.filter(m => {
    const key = `${m.techniqueId}-${m.method}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.confidence - a.confidence);
  
  return {
    primary: uniqueMatches[0] || null,
    allMatches: uniqueMatches
  };
}

export interface CommandRiskAssessment {
  dangerous: boolean;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  matchedPattern?: string;
}

// Keyword/regex "is this command dangerous" check -- independent of MITRE
// classification above (a command can be confidently MITRE-tagged as
// Discovery and still be entirely benign, e.g. `whoami`, or vice versa).
// Same match style as COMMAND_SIGNATURES/REGEX_PATTERNS: exact substring
// first (fast, unambiguous), then regex for variable arguments.
const DANGEROUS_SIGNATURES: string[] = [
  'rm -rf /', 'rm -fr /', 'mkfs', 'dd if=/dev/zero', 'dd if=/dev/urandom',
  'chmod 4755', 'chmod +s', 'chmod -r 777', 'chmod 777 /',
  'cat /etc/shadow', '/etc/shadow',
  'history -c', 'unset histfile', 'export histfile=/dev/null',
  'iptables -f', 'iptables --flush',
  'useradd', 'passwd root', 'usermod -ag sudo', 'usermod -ag wheel',
  'crontab -e',
];

const DANGEROUS_REGEX_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /rm\s+-[a-z]*r[a-z]*f?[a-z]*\s+\//i, name: 'Recursive delete from root' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, name: 'Fork bomb' },
  { pattern: /(nc|ncat|netcat)\s+.*-e\s+/i, name: 'Netcat reverse shell' },
  { pattern: /bash\s+-i\s*>&\s*\/dev\/tcp/i, name: 'Bash reverse shell' },
  { pattern: /python[23]?\s+-c\s+.*socket/i, name: 'Python reverse shell' },
  { pattern: /(curl|wget)\s+\S+\s*\|\s*(sh|bash)/i, name: 'Pipe-to-shell download' },
  { pattern: /base64\s+(-d|--decode)\s*\|\s*(sh|bash)/i, name: 'Base64-decoded execution' },
  { pattern: />\s*\/etc\/(passwd|shadow|sudoers)/i, name: 'Overwrite of a system credential file' },
];

// Common recon commands that aren't dangerous on their own -- gives every
// real captured command *some* severity signal, not just the flagged ones.
const RECON_SIGNATURES: string[] = [
  'whoami', ' id', 'uname', 'ps aux', 'netstat', 'ss -tulpn',
  'ls -la', 'find /', 'cat /etc/passwd', 'cat /etc/hosts',
];

export function assessCommandRisk(command: string): CommandRiskAssessment {
  const normalized = command.toLowerCase().trim();

  for (const sig of DANGEROUS_SIGNATURES) {
    if (normalized.includes(sig.toLowerCase())) {
      return { dangerous: true, severity: 'Critical', matchedPattern: sig };
    }
  }
  for (const { pattern, name } of DANGEROUS_REGEX_PATTERNS) {
    if (pattern.test(normalized)) {
      return { dangerous: true, severity: 'Critical', matchedPattern: name };
    }
  }
  if (RECON_SIGNATURES.some(sig => normalized.includes(sig))) {
    return { dangerous: false, severity: 'Medium' };
  }
  return { dangerous: false, severity: 'Low' };
}