'use client';
import { useEffect, useState } from 'react';

interface SourceConfig {
  type: string;
  enabled: boolean;
  interval: number;
  settings: Record<string, unknown>;
}

interface LocalSourceConfig {
  path: string;
  enabled: boolean;
  name?: string;
  extensions?: string[];
  recursive?: boolean;
  interval?: number;
}

interface Config {
  library: {
    sources: SourceConfig[];
    localSources?: LocalSourceConfig[];
  };
}

export default function SourceConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig);
  }, []);

  if (!config) return <p>Loading...</p>;

  const sources = config.library.sources ?? [];
  const localSources = config.library.localSources ?? [];

  return (
    <div>
      <h1>Source Configuration</h1>
      <p style={{ color: '#888' }}>
        Edit source settings in researcher.json. Changes require restart.
        Use the Config page to modify values via the admin queue.
      </p>

      <h2>API Sources</h2>
      {sources.map((s, i) => (
        <div key={i} style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{s.type}</h3>
            <span style={{ color: s.enabled ? '#4f4' : '#f44' }}>{s.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div style={{ marginTop: '12px', fontSize: '13px', color: '#888' }}>
            <div>Interval: {s.interval}s ({Math.round(s.interval / 3600)}h)</div>
            {Array.isArray(s.settings.searchTerms) && (
              <div style={{ marginTop: '8px' }}>
                <strong>Search terms:</strong> {(s.settings.searchTerms as string[]).length} terms
                <details style={{ marginTop: '4px' }}>
                  <summary style={{ cursor: 'pointer', color: '#88f' }}>Show all</summary>
                  <div style={{ marginTop: '4px', maxHeight: '200px', overflow: 'auto' }}>
                    {(s.settings.searchTerms as string[]).map((t, j) => (
                      <div key={j}>{t}</div>
                    ))}
                  </div>
                </details>
              </div>
            )}
            {typeof s.settings.apiKey === 'string' && <div style={{ marginTop: '4px' }}>API Key: ••••••••</div>}
            {typeof s.settings.mailto === 'string' && <div style={{ marginTop: '4px' }}>Mailto: {s.settings.mailto}</div>}
          </div>
        </div>
      ))}

      {sources.length === 0 && <p style={{ color: '#666' }}>No API sources configured.</p>}

      <h2>Local Sources</h2>
      {localSources.map((s, i) => (
        <div key={i} style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{s.name ?? s.path}</h3>
            <span style={{ color: s.enabled ? '#4f4' : '#f44' }}>{s.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#888' }}>
            <div>Path: {s.path}</div>
            <div>Extensions: {(s.extensions ?? ['.txt', '.md', '.pdf', '.html']).join(', ')}</div>
            <div>Recursive: {s.recursive !== false ? 'yes' : 'no'}</div>
            <div>Interval: {s.interval ?? 86400}s</div>
          </div>
        </div>
      ))}

      {localSources.length === 0 && <p style={{ color: '#666' }}>No local sources configured.</p>}
    </div>
  );
}
