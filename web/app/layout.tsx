import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Researcher Admin',
  description: 'Autonomous AI Research System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0a0a0a', color: '#e0e0e0' }}>
        <nav style={{ background: '#111', padding: '12px 24px', borderBottom: '1px solid #222', display: 'flex', gap: '24px', alignItems: 'center' }}>
          <strong style={{ fontSize: '18px' }}>Researcher</strong>
          <a href="/" style={{ color: '#88f', textDecoration: 'none' }}>Dashboard</a>
          <a href="/agents" style={{ color: '#88f', textDecoration: 'none' }}>Agents</a>
          <a href="/sources" style={{ color: '#88f', textDecoration: 'none' }}>Sources</a>
          <a href="/config" style={{ color: '#88f', textDecoration: 'none' }}>Config</a>
          <a href="/projects" style={{ color: '#88f', textDecoration: 'none' }}>Projects</a>
          <a href="/pipeline" style={{ color: '#88f', textDecoration: 'none' }}>Pipeline</a>
          <a href="/queue" style={{ color: '#88f', textDecoration: 'none' }}>Queue</a>
        </nav>
        <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
