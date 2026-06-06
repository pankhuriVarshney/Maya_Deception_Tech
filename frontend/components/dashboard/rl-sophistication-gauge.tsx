"use client";

import React from 'react';

interface RLSophisticationGaugeProps {
  confidence: number; // 0-1
  avgConfidence?: number;
  label?: string;
}

export function RLSophisticationGauge({ confidence, avgConfidence, label = "Current Sophistication" }: RLSophisticationGaugeProps) {
  const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
  const avgPct = avgConfidence ? Math.round(avgConfidence * 100) : null;

  const color = pct > 82 ? 'emerald' : pct > 65 ? 'amber' : 'slate';

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm font-medium mb-2 flex items-baseline justify-between">
        <span>{label}</span>
        <span className={`font-mono text-lg font-semibold text-${color}-600`}>{pct}%</span>
      </div>

      <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-3 bg-${color}-500 transition-all duration-500`} 
          style={{ width: `${pct}%` }} 
        />
      </div>

      {avgPct !== null && (
        <div className="mt-2 text-xs text-muted-foreground flex justify-between">
          <span>10-decision avg</span>
          <span className="font-medium">{avgPct}%</span>
        </div>
      )}

      <div className="mt-3 text-[10px] text-muted-foreground">
        High confidence = attacker showing advanced TTPs → RL escalates fidelity to maximize dwell time.
      </div>
    </div>
  );
}
