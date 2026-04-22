'use client';
import { useState } from 'react';

export default function ConfigPage() {
  const [module, setModule] = useState('research');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('');

  const updateConfig = async () => {
    if (!key.trim()) return;
    setStatus('Queuing...');

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }

    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_config',
        payload: { module, key, value: parsedValue },
      }),
    });

    setStatus(`Queued: ${module}.${key} = ${value}`);
    setKey('');
    setValue('');
  };

  return (
    <div>
      <h1>Configuration</h1>

      <div style={{ marginBottom: '24px' }}>
        <a href="/config/agents" style={{ color: '#88f', textDecoration: 'none' }}>Agent Config (per-agent model/backend) →</a>
      </div>

      <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '24px', maxWidth: '500px' }}>
        <h3 style={{ marginTop: 0 }}>Modify Module Config</h3>

        <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>Module</label>
        <select
          value={module}
          onChange={e => setModule(e.target.value)}
          style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '16px' }}
        >
          <option value="research">research</option>
          <option value="discovery">discovery</option>
          <option value="paper">paper</option>
          <option value="library">library</option>
        </select>

        <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>Key (dot notation, e.g. tickInterval or fetchDelay.minMs)</label>
        <input
          placeholder="tickInterval"
          value={key}
          onChange={e => setKey(e.target.value)}
          style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '16px', boxSizing: 'border-box' }}
        />

        <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>Value (JSON or string)</label>
        <input
          placeholder="5000"
          value={value}
          onChange={e => setValue(e.target.value)}
          style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '16px', boxSizing: 'border-box' }}
        />

        <button
          onClick={updateConfig}
          disabled={!key.trim()}
          style={{ padding: '10px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
        >
          Update Config (queued)
        </button>

        {status && <p style={{ marginTop: '12px', color: '#8f8' }}>{status}</p>}
      </div>
    </div>
  );
}
