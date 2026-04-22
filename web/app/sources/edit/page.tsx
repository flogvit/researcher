'use client';
import { useEffect, useState } from 'react';

interface SourceConfig {
  type: string;
  enabled: boolean;
  interval: number;
  settings: Record<string, unknown>;
}

interface Config {
  library: {
    sources: SourceConfig[];
    localSources?: Array<{ path: string; enabled: boolean; name?: string; extensions?: string[]; recursive?: boolean; interval?: number }>;
  };
}

const AVAILABLE_SOURCES = ['doaj', 'openalex', 'semantic-scholar', 'crossref', 'pubmed', 'arxiv'];

export default function SourceEditPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [editing, setEditing] = useState<{ index: number; source: SourceConfig } | null>(null);
  const [newLocalPath, setNewLocalPath] = useState('');
  const [newLocalName, setNewLocalName] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig);
  }, []);

  if (!config) return <p>Loading...</p>;

  const sources = config.library.sources ?? [];
  const localSources = config.library.localSources ?? [];
  const usedTypes = sources.map(s => s.type);
  const availableToAdd = AVAILABLE_SOURCES.filter(t => !usedTypes.includes(t));

  const saveSource = async (index: number, updated: SourceConfig) => {
    setStatus('Saving...');
    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_researcher_config',
        payload: { key: `library.sources.${index}`, value: updated },
      }),
    });
    setStatus(`Updated ${updated.type}`);
    setEditing(null);
  };

  const addSource = async (type: string) => {
    setStatus('Adding...');
    const newSource: SourceConfig = {
      type,
      enabled: true,
      interval: 86400,
      settings: { searchTerms: [] },
    };
    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_researcher_config',
        payload: { key: `library.sources.${sources.length}`, value: newSource },
      }),
    });
    setStatus(`Added ${type} source`);
  };

  const addLocalSource = async () => {
    if (!newLocalPath.trim()) return;
    setStatus('Adding local source...');
    const newLocal = {
      path: newLocalPath,
      enabled: true,
      name: newLocalName || undefined,
      interval: 86400,
    };

    const currentLocal = localSources;
    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_researcher_config',
        payload: { key: 'library.localSources', value: [...currentLocal, newLocal] },
      }),
    });
    setStatus(`Added local source: ${newLocalPath}`);
    setNewLocalPath('');
    setNewLocalName('');
  };

  return (
    <div>
      <h1>Edit Sources</h1>

      <h2>API Sources</h2>
      {sources.map((s, i) => (
        <div key={i} style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{s.type}</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setEditing({ index: i, source: { ...s, settings: { ...s.settings } } })}
                style={{ padding: '4px 12px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#88f', cursor: 'pointer', fontSize: '12px' }}>
                edit
              </button>
            </div>
          </div>
          <div style={{ fontSize: '13px', color: '#888', marginTop: '8px' }}>
            {s.enabled ? '✓ enabled' : '✗ disabled'} | interval: {s.interval}s
            {Array.isArray(s.settings.searchTerms) && ` | ${(s.settings.searchTerms as string[]).length} search terms`}
            {typeof s.settings.apiKey === 'string' && ' | API key set'}
          </div>
        </div>
      ))}

      {availableToAdd.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3>Add Source</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {availableToAdd.map(type => (
              <button key={type} onClick={() => addSource(type)}
                style={{ padding: '8px 16px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', cursor: 'pointer' }}>
                + {type}
              </button>
            ))}
          </div>
        </div>
      )}

      <h2>Local Sources</h2>
      {localSources.map((s, i) => (
        <div key={i} style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
          <h3 style={{ margin: 0 }}>{s.name ?? s.path}</h3>
          <div style={{ fontSize: '13px', color: '#888', marginTop: '8px' }}>
            Path: {s.path} | {s.enabled ? '✓ enabled' : '✗ disabled'}
          </div>
        </div>
      ))}

      <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
        <h3 style={{ marginTop: 0 }}>Add Local Directory</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            placeholder="/path/to/directory"
            value={newLocalPath}
            onChange={e => setNewLocalPath(e.target.value)}
            style={{ flex: 2, padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0' }}
          />
          <input
            placeholder="Name (optional)"
            value={newLocalName}
            onChange={e => setNewLocalName(e.target.value)}
            style={{ flex: 1, padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0' }}
          />
          <button onClick={addLocalSource} disabled={!newLocalPath.trim()}
            style={{ padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
            Add
          </button>
        </div>
      </div>

      {editing && (
        <SourceEditModal
          source={editing.source}
          onSave={(updated) => saveSource(editing.index, updated)}
          onClose={() => setEditing(null)}
        />
      )}

      {status && <p style={{ color: '#8f8' }}>{status}</p>}
    </div>
  );
}

function SourceEditModal({ source, onSave, onClose }: { source: SourceConfig; onSave: (s: SourceConfig) => void; onClose: () => void }) {
  const [s, setS] = useState(source);
  const [terms, setTerms] = useState((s.settings.searchTerms as string[] ?? []).join('\n'));
  const [apiKey, setApiKey] = useState((s.settings.apiKey as string) ?? '');
  const [mailto, setMailto] = useState((s.settings.mailto as string) ?? '');

  const save = () => {
    const settings: Record<string, unknown> = {
      ...s.settings,
      searchTerms: terms.split('\n').map(t => t.trim()).filter(Boolean),
    };
    if (apiKey) settings.apiKey = apiKey;
    else delete settings.apiKey;
    if (mailto) settings.mailto = mailto;
    else delete settings.mailto;

    onSave({ ...s, settings });
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#161616', border: '1px solid #333', borderRadius: '12px', padding: '24px', width: '500px', maxHeight: '80vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Edit: {s.type}</h3>

        <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Enabled</label>
        <select value={s.enabled ? 'yes' : 'no'} onChange={e => setS({ ...s, enabled: e.target.value === 'yes' })}
          style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px' }}>
          <option value="yes">Enabled</option>
          <option value="no">Disabled</option>
        </select>

        <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Interval (seconds)</label>
        <input type="number" value={s.interval} onChange={e => setS({ ...s, interval: parseInt(e.target.value) || 86400 })}
          style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px', boxSizing: 'border-box' }} />

        <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Search Terms (one per line)</label>
        <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={8}
          style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px', fontFamily: 'monospace', fontSize: '12px', boxSizing: 'border-box', resize: 'vertical' }} />

        {['semantic-scholar', 'pubmed'].includes(s.type) && (
          <>
            <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>API Key (optional)</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Optional API key for higher rate limits"
              style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px', boxSizing: 'border-box' }} />
          </>
        )}

        {['openalex', 'crossref'].includes(s.type) && (
          <>
            <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '12px' }}>Mailto (for polite pool)</label>
            <input type="email" value={mailto} onChange={e => setMailto(e.target.value)} placeholder="your@email.com"
              style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '12px', boxSizing: 'border-box' }} />
          </>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>Save (queued)</button>
        </div>
      </div>
    </div>
  );
}
