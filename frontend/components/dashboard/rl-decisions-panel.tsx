"use client";

import React, { useState, useEffect } from 'react';
import { useSharedWebSocket } from '@/hooks/use-shared-websocket';

export interface RLDecision {
  timestamp: string;
  attacker_id: string;
  current_tier: string;
  action: 'maintain' | 'escalate_tier' | 'plant_breadcrumb' | 'observe_only';
  confidence: number;
  rationale: string;
  features: Record<string, number>;
  observed_ttps: string[];
  predicted_reward_delta: number;
}

const ACTION_COLORS: Record<string, string> = {
  escalate_tier: 'bg-emerald-500 text-white',
  plant_breadcrumb: 'bg-purple-500 text-white',
  maintain: 'bg-slate-500 text-white',
  observe_only: 'bg-amber-500 text-white',
};

const ACTION_LABELS: Record<string, string> = {
  escalate_tier: 'ESCALATE TIER',
  plant_breadcrumb: 'PLANT BREADCRUMB',
  maintain: 'MAINTAIN',
  observe_only: 'OBSERVE',
};

interface RLDecisionsPanelProps {
  maxItems?: number;
}

export function RLDecisionsPanel({ maxItems = 6 }: RLDecisionsPanelProps) {
  const [decisions, setDecisions] = useState<RLDecision[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const { subscribe, connected } = useSharedWebSocket();

  useEffect(() => {
    // Initial load of recent decisions
    const loadRecent = async () => {
      try {
        const res = await fetch('/api/rl/decisions?limit=8');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.decisions) {
            setDecisions(json.data.decisions);
          }
        }
      } catch (e) {
        console.log('Could not load initial RL decisions (demo mode ok)');
      }
    };
    loadRecent();

    // Live updates via WebSocket
    const unsubscribe = subscribe((msg: any) => {
      if (msg.type === 'CONNECTION_STATUS') {
        setIsConnected(msg.data?.connected || false);
      }
      if (msg.type === 'RL_DECISION' && msg.data) {
        setDecisions(prev => {
          const next = [msg.data as RLDecision, ...prev].slice(0, maxItems);
          return next;
        });
      }
    });

    return unsubscribe;
  }, [subscribe, maxItems]);

  const simulateSophisticatedAttacker = async () => {
    try {
      const res = await fetch('/api/rl/simulate-decision', { method: 'POST' });
      if (res.ok) {
        const { data } = await res.json();
        setDecisions(prev => [data, ...prev].slice(0, maxItems));
      }
    } catch (e) {
      // Fallback: create a convincing local decision for pure demo
      const mock: RLDecision = {
        timestamp: new Date().toISOString(),
        attacker_id: `DEMO-${Math.floor(Math.random() * 9000) + 1000}`,
        current_tier: 'low-gvisor',
        action: 'escalate_tier',
        confidence: 0.89,
        rationale: 'High recon diversity + privilege escalation + lateral movement detected. Escalating to Kata tier to increase dwell time.',
        features: { recon_command_count: 14, privilege_escalation_attempts: 4, mitre_ttp_coverage: 4, command_entropy: 4.2 },
        observed_ttps: ['T1082', 'T1068', 'T1021'],
        predicted_reward_delta: 92,
      };
      setDecisions(prev => [mock, ...prev].slice(0, maxItems));
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="font-semibold text-lg">RL Adaptive Engine</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${connected || isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {connected || isConnected ? 'LIVE' : 'SIM'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Real-time decisions from the reinforcement learning policy</p>
        </div>

        <button
          onClick={simulateSophisticatedAttacker}
          className="text-xs px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors flex items-center gap-1.5"
        >
          <span>Simulate Sophisticated Attacker</span>
        </button>
      </div>

      <div className="space-y-2 max-h-[340px] overflow-auto pr-1 custom-scroll">
        {decisions.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-lg">
            No RL decisions yet. Start the Rust simulator or click the button above.
          </div>
        )}

        {decisions.map((d, idx) => {
          const colorClass = ACTION_COLORS[d.action] || 'bg-slate-500 text-white';
          const label = ACTION_LABELS[d.action] || d.action.toUpperCase();

          return (
            <div key={idx} className="rounded-lg border p-3 bg-background/60 hover:bg-background transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{new Date(d.timestamp).toLocaleTimeString()}</span>
                    <span className="font-semibold truncate">{d.attacker_id}</span>
                    <span className={`text-[10px] px-1.5 py-px rounded font-mono ${colorClass}`}>{label}</span>
                  </div>
                  <div className="mt-1 text-sm leading-tight text-foreground/90">
                    {d.rationale}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground font-mono">
                    <span>conf: <span className="font-semibold text-foreground">{(d.confidence * 100).toFixed(0)}%</span></span>
                    <span>tier: {d.current_tier}</span>
                    {d.predicted_reward_delta > 0 && (
                      <span>+{d.predicted_reward_delta} reward</span>
                    )}
                    {d.observed_ttps?.length > 0 && (
                      <span>TTPs: {d.observed_ttps.join(', ')}</span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold tabular-nums tracking-tighter">
                    {(d.confidence * 100).toFixed(0)}
                    <span className="text-xs font-normal text-muted-foreground">%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground -mt-1">confidence</div>
                </div>
              </div>

              {/* Mini feature sparkline row */}
              {d.features && Object.keys(d.features).length > 0 && (
                <div className="mt-2 pt-2 border-t text-[10px] flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground">
                  {Object.entries(d.features).slice(0, 5).map(([k, v]) => (
                    <span key={k}>{k.replace(/_/g, ' ')}: <span className="font-medium text-foreground">{Number(v).toFixed(1)}</span></span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-[10px] text-muted-foreground flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        Decisions stream from Rust RL sidecar via WebSocket
      </div>
    </div>
  );
}
