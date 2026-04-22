'use client';
import { useEffect, useState } from 'react';

interface AgentConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  allowedTools?: string[];
  maxTurns?: number;
}

interface Config {
  llm: {
    provider: string;
    model?: string;
    baseUrl?: string;
    allowedTools?: string[];
    maxTurns?: number;
  };
  agents?: Record<string, AgentConfig>;
}

const AGENT_ROLES = [
  'triage', 'reviewer', 'reflector', 'task-generator', 'supervisor',
  'researcher', 'discovery', 'paper', 'learner', 'bootstrap',
];

export default function AgentConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [editAgent, setEditAgent] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<AgentConfig>({});
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig);
  }, []);

  if (!config) return <p>Loading...</p>;

  const agents = config.agents ?? {};

  const startEdit = (name: string) => {
    setEditAgent(name);
    setEditConfig(agents[name] ?? {});
  };

  const save = async () => {
    if (!editAgent) return;
    setStatus('Saving...');

    // Queue a config modification for researcher.json
    // This modifies the agents section
    const cleanConfig: Record<string, unknown> = {};
    if (editConfig.provider) cleanConfig.provider = editConfig.provider;
    if (editConfig.model) cleanConfig.model = editConfig.model;
    if (editConfig.baseUrl) cleanConfig.baseUrl = editConfig.baseUrl;
    if (editConfig.maxTurns) cleanConfig.maxTurns = editConfig.maxTurns;

    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_researcher_config',
        payload: { key: `agents.${editAgent}`, value: cleanConfig },
      }),
    });

    setStatus(`Queued config update for ${editAgent}`);
    setEditAgent(null);
  };

  return (
    <div>
      <h1>Agent Configuration</h1>
      <p style={{ color: '#888' }}>Override LLM settings per agent role. Empty fields inherit from global config.</p>

      <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 8px 0' }}>Global Default</h3>
        <div style={{ fontSize: '13px', color: '#888' }}>
          <div>Provider: <strong style={{ color: '#e0e0e0' }}>{config.llm.provider}</strong></div>
          <div>Model: <strong style={{ color: '#e0e0e0' }}>{config.llm.model ?? '(default)'}</strong></div>
          {config.llm.baseUrl && <div>Base URL: {config.llm.baseUrl}</div>}
          {config.llm.maxTurns && <div>Max turns: {config.llm.maxTurns}</div>}
        </div>
      </div>

      <h2>Per-Agent Overrides</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Agent</th>
            <th style={{ padding: '8px' }}>Provider</th>
            <th style={{ padding: '8px' }}>Model</th>
            <th style={{ padding: '8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {AGENT_ROLES.map(name => {
            const cfg = agents[name];
            return (
              <tr key={name} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '8px', color: '#88f' }}>{name}</td>
                <td style={{ padding: '8px', color: cfg?.provider ? '#e0e0e0' : '#555' }}>{cfg?.provider ?? 'inherited'}</td>
                <td style={{ padding: '8px', color: cfg?.model ? '#e0e0e0' : '#555' }}>{cfg?.model ?? 'inherited'}</td>
                <td style={{ padding: '8px' }}>
                  <button
                    onClick={() => startEdit(name)}
                    style={{ padding: '4px 12px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#88f', cursor: 'pointer', fontSize: '12px' }}
                  >
                    {cfg ? 'edit' : 'override'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editAgent && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161616', border: '1px solid #333', borderRadius: '12px', padding: '24px', width: '400px' }}>
            <h3 style={{ marginTop: 0 }}>Configure: {editAgent}</h3>

            <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Provider (leave empty to inherit)</label>
            <select
              value={editConfig.provider ?? ''}
              onChange={e => setEditConfig({ ...editConfig, provider: e.target.value || undefined })}
              style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px' }}
            >
              <option value="">inherit from global</option>
              <option value="claude">claude</option>
              <option value="ollama">ollama</option>
              <option value="codex">codex</option>
              <option value="opencode">opencode</option>
            </select>

            <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Model</label>
            <input
              placeholder="inherit from global"
              value={editConfig.model ?? ''}
              onChange={e => setEditConfig({ ...editConfig, model: e.target.value || undefined })}
              style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px', boxSizing: 'border-box' }}
            />

            <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Max Turns</label>
            <input
              type="number"
              placeholder="inherit"
              value={editConfig.maxTurns ?? ''}
              onChange={e => setEditConfig({ ...editConfig, maxTurns: e.target.value ? parseInt(e.target.value) : undefined })}
              style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '16px', boxSizing: 'border-box' }}
            />

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditAgent(null)} style={{ padding: '8px 16px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={save} style={{ padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
                Save (queued)
              </button>
            </div>
          </div>
        </div>
      )}

      {status && <p style={{ marginTop: '12px', color: '#8f8' }}>{status}</p>}
    </div>
  );
}
