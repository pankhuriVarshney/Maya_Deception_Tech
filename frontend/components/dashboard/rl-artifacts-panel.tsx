"use client";

import React, { useState, useEffect } from 'react';
import { useSharedWebSocket } from '@/hooks/use-shared-websocket';

interface RLArtifacts {
  last_log_lines: string[];
  files: Record<string, string>;
  last_updated: string;
}

export function RLArtifactsPanel() {
  const [artifacts, setArtifacts] = useState<RLArtifacts>({
    last_log_lines: [],
    files: {},
    last_updated: '',
  });
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { subscribe, connected } = useSharedWebSocket();

  const loadArtifacts = async () => {
    try {
      const res = await fetch('/api/rl/artifacts');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setArtifacts(json.data);
        }
      }
    } catch (e) {
      // demo fallback - already seeded on backend
    }
  };

  useEffect(() => {
    loadArtifacts();

    const unsubscribe = subscribe((msg: any) => {
      if (msg.type === 'CONNECTION_STATUS') {
        setIsConnected(msg.data?.connected || false);
      }
      if (msg.type === 'RL_ARTIFACTS_UPDATED' && msg.data) {
        setArtifacts(msg.data);
      }
    });

    return unsubscribe;
  }, [subscribe]);

  const fileNames = Object.keys(artifacts.files).sort();
  const logLines = artifacts.last_log_lines.slice(-10); // ensure last 10

  const openFile = (name: string) => {
    const content = artifacts.files[name] || 'File content not available';
    setSelectedFile({ name, content });
  };

  const closeModal = () => setSelectedFile(null);

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base">Live Actuation Artifacts</span>
          <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${connected || isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {connected || isConnected ? 'LIVE FROM POD' : 'SIM'}
          </span>
        </div>
        <button 
          onClick={loadArtifacts}
          className="text-xs px-2 py-1 rounded border hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      <div className="text-[10px] text-muted-foreground mb-3">
        Sourced live from <code>/deception</code> volume inside the honeypot pod (emptyDir shared with RL sidecar)
      </div>

      {/* RL_ACTUATED.log viewer */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-medium text-sm">/deception/RL_ACTUATED.log</span>
          <span className="text-[10px] text-muted-foreground">(last {logLines.length} lines, auto-updates via WS)</span>
        </div>
        <div className="bg-black text-green-400 font-mono text-xs p-3 rounded-lg h-[140px] overflow-auto border border-green-900/50">
          {logLines.length > 0 ? (
            logLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap leading-tight">{line}</div>
            ))
          ) : (
            <div className="text-green-600/60">Waiting for RL decisions... (trigger via Rust simulate or the button above)</div>
          )}
        </div>
      </div>

      {/* Breadcrumb files */}
      <div>
        <div className="font-medium text-sm mb-2">Planted Breadcrumb Files (click to view)</div>
        
        {fileNames.length === 0 ? (
          <div className="text-xs text-muted-foreground border border-dashed rounded p-3">
            No files yet. Use "Simulate Sophisticated Attacker" or run the Rust sidecar with plant_breadcrumb decisions.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fileNames.map((name) => (
              <button
                key={name}
                onClick={() => openFile(name)}
                className="text-left px-3 py-2 rounded-lg border hover:border-purple-500 hover:bg-purple-50/50 transition-colors flex items-center gap-2 group"
              >
                <span className="text-purple-600 group-hover:text-purple-700">📄</span>
                <span className="font-mono text-sm truncate">{name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">view →</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal for file content */}
      {selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeModal}>
          <div 
            className="bg-card border rounded-xl w-full max-w-2xl mx-4 max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-mono text-sm font-semibold">{selectedFile.name}</div>
              <button onClick={closeModal} className="text-xl leading-none px-2">×</button>
            </div>
            <div className="p-4 overflow-auto font-mono text-xs bg-black text-green-400 flex-1 whitespace-pre-wrap rounded-b-xl">
              {selectedFile.content}
            </div>
            <div className="p-3 text-[10px] text-muted-foreground border-t">
              Content streamed from the pod's /deception/breadcrumbs/ via the RL sidecar → backend
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
