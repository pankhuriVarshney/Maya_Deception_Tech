"use client";

import React from 'react';

interface RLFeatureTableProps {
  features: Record<string, number>;
  topN?: number;
}

const FEATURE_LABELS: Record<string, string> = {
  recon_command_count: 'Recon Intensity',
  privilege_escalation_attempts: 'Priv-Esc Attempts',
  mitre_ttp_coverage: 'MITRE TTP Coverage',
  command_entropy: 'Command Entropy',
  fingerprint_risk_score: 'Fingerprint Risk',
  num_lateral_moves: 'Lateral Moves',
  suspicious_tool_count: 'Suspicious Tools',
  dwell_time_minutes_proxy: 'Dwell (min)',
};

export function RLFeatureTable({ features, topN = 8 }: RLFeatureTableProps) {
  const entries = Object.entries(features)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, topN);

  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground p-3 border rounded">No feature vector available for current decision.</div>;
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-2 text-sm font-medium border-b bg-muted/40">Top Signals (25-dim vector)</div>
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([key, value]) => {
            const label = FEATURE_LABELS[key] || key.replace(/_/g, ' ');
            const isHigh = value > 3.5;
            return (
              <tr key={key} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-1.5 font-medium text-muted-foreground">{label}</td>
                <td className="px-4 py-1.5 font-mono text-right tabular-nums">
                  <span className={isHigh ? 'text-emerald-600 font-semibold' : ''}>
                    {typeof value === 'number' ? value.toFixed(1) : value}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-1 text-[10px] text-muted-foreground bg-muted/20">
        Features extracted in real-time by Rust CRDT + FeatureExtractor
      </div>
    </div>
  );
}
