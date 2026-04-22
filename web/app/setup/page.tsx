'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState('en');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const router = useRouter();

  const startSetup = async () => {
    if (!domain.trim()) return;
    setStatus('running');
    setProgress('Bootstrapping project... This may take a few minutes.');

    try {
      const response = await fetch('/api/setup/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, language }),
      });

      const data = await response.json();

      if (data.status === 'complete') {
        setStatus('done');
        setResult(data);
        setProgress(`Project "${data.name}" created with ${data.agents} agents and ${data.methods} methods.`);
      } else {
        setStatus('error');
        setProgress(`Error: ${data.error}`);
      }
    } catch (e) {
      setStatus('error');
      setProgress(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
      <div style={{ width: '500px', padding: '40px' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '8px', color: '#fff' }}>Researcher</h1>
        <p style={{ color: '#888', marginBottom: '32px' }}>Set up a new autonomous research project</p>

        {status === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '14px' }}>Research Domain</label>
              <input
                placeholder="e.g. biblical studies, quantum computing, marine biology"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                autoFocus
                style={{
                  width: '100%', padding: '12px', background: '#161616', border: '1px solid #333',
                  borderRadius: '6px', color: '#e0e0e0', fontSize: '16px', boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '14px' }}>Language</label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                style={{
                  width: '100%', padding: '12px', background: '#161616', border: '1px solid #333',
                  borderRadius: '6px', color: '#e0e0e0', fontSize: '16px',
                }}
              >
                <option value="en">English</option>
                <option value="no">Norsk</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="pt">Português</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </div>

            <button
              onClick={startSetup}
              disabled={!domain.trim()}
              style={{
                padding: '14px 24px', background: '#338', border: 'none', borderRadius: '6px',
                color: '#fff', fontSize: '16px', cursor: 'pointer', marginTop: '8px',
                opacity: domain.trim() ? 1 : 0.5,
              }}
            >
              Initialize Project
            </button>
          </div>
        )}

        {status === 'running' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '16px' }}>Setting up...</div>
            <p style={{ color: '#888' }}>{progress}</p>
            <div style={{ marginTop: '24px', height: '4px', background: '#222', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: '#88f', borderRadius: '2px',
                animation: 'progress 2s ease-in-out infinite',
                width: '30%',
              }} />
            </div>
            <style>{`@keyframes progress { 0% { margin-left: 0% } 50% { margin-left: 70% } 100% { margin-left: 0% } }`}</style>
          </div>
        )}

        {status === 'done' && (
          <div>
            <div style={{ fontSize: '24px', color: '#4f4', marginBottom: '16px' }}>Project Created</div>
            <p style={{ color: '#888' }}>{progress}</p>
            <button
              onClick={() => router.push('/')}
              style={{
                padding: '14px 24px', background: '#338', border: 'none', borderRadius: '6px',
                color: '#fff', fontSize: '16px', cursor: 'pointer', marginTop: '16px',
              }}
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div style={{ fontSize: '24px', color: '#f44', marginBottom: '16px' }}>Setup Failed</div>
            <p style={{ color: '#888' }}>{progress}</p>
            <button
              onClick={() => setStatus('idle')}
              style={{
                padding: '14px 24px', background: '#333', border: 'none', borderRadius: '6px',
                color: '#fff', fontSize: '16px', cursor: 'pointer', marginTop: '16px',
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
