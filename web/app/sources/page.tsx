'use client';
import { useEffect, useState } from 'react';

interface DocsResponse {
  stats: Record<string, number>;
  documents: Array<Record<string, unknown>>;
}

export default function SourcesPage() {
  const [docs, setDocs] = useState<DocsResponse | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>> | null>(null);

  useEffect(() => {
    fetch('/api/documents').then(r => r.json()).then(setDocs);
  }, []);

  const doSearch = async () => {
    if (!search.trim()) return;
    const results = await fetch(`/api/documents/search?q=${encodeURIComponent(search)}`).then(r => r.json());
    setSearchResults(results);
  };

  if (!docs) return <p>Loading...</p>;

  return (
    <div>
      <h1>Library & Sources</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <Stat label="Total" value={docs.stats.total ?? 0} />
        <Stat label="Metadata" value={docs.stats.metadata ?? 0} />
        <Stat label="Downloaded" value={docs.stats.downloaded ?? 0} />
        <Stat label="Extracted" value={docs.stats.extracted ?? 0} />
        <Stat label="Classified" value={docs.stats.classified ?? 0} />
        <Stat label="Embedded" value={docs.stats.embedded ?? 0} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input
          placeholder="Search documents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          style={{ flex: 1, padding: '8px', background: '#161616', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0' }}
        />
        <button onClick={doSearch} style={{ padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
          Search
        </button>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <a href="/sources/config" style={{ color: '#88f', textDecoration: 'none' }}>View Config →</a>
        <a href="/sources/edit" style={{ color: '#88f', textDecoration: 'none' }}>Edit Sources →</a>
      </div>

      <h2>Recent Documents</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Title</th>
            <th style={{ padding: '8px' }}>Type</th>
            <th style={{ padding: '8px' }}>Status</th>
            <th style={{ padding: '8px' }}>Author</th>
          </tr>
        </thead>
        <tbody>
          {(searchResults ?? docs.documents).map((d: Record<string, unknown>) => (
            <tr key={d.id as number} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ padding: '8px', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.url ? <a href={d.url as string} target="_blank" rel="noreferrer" style={{ color: '#88f' }}>{d.title as string}</a> : d.title as string}
              </td>
              <td style={{ padding: '8px', color: '#888' }}>{d.contentType as string}</td>
              <td style={{ padding: '8px' }}>
                <span style={{ color: statusColor(d.status as string) }}>{d.status as string}</span>
              </td>
              <td style={{ padding: '8px', color: '#888', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(d.author as string) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
      <div style={{ fontSize: '11px', color: '#888' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{value}</div>
    </div>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case 'embedded': return '#4f4';
    case 'classified': return '#8f8';
    case 'extracted': return '#ff8';
    case 'downloaded': return '#88f';
    case 'metadata': return '#888';
    default: return '#f44';
  }
}
