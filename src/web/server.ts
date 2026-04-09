import { getDb, initDatabase } from '../db/connection.js';
import { agentTasks, findings, researchLog, discoveries, documents, projects } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { searchSimilar } from '../llm/embeddings.js';
import { loadState } from '../core/state.js';
import { LLM } from '../llm/llm.js';
import { loadConfig, getDatabaseUrl } from '../config.js';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

let projectDir: string;

const DASHBOARD_HTML = join(import.meta.dir, 'dashboard.html');
const PROJECTS_HTML = join(import.meta.dir, 'projects.html');
const PROJECT_HTML = join(import.meta.dir, 'project.html');

async function handleStatus(): Promise<Response> {
  const db = getDb();
  const state = await loadState(projectDir);

  const [taskCounts] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      inProgress: sql<number>`count(*) filter (where status = 'in_progress')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    })
    .from(agentTasks);

  const [findingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(findings);

  return Response.json({
    running: state.running,
    startedAt: state.startedAt,
    tasksCompleted: Number(taskCounts.completed),
    lastReflection: state.lastReflection,
    currentFocus: state.currentFocus,
    rateLimited: LLM.isCurrentlyRateLimited(),
    rateLimitWaitMin: Math.ceil(LLM.getRateLimitWaitMs() / 60_000),
    tasks: {
      pending: Number(taskCounts.pending),
      inProgress: Number(taskCounts.inProgress),
      completed: Number(taskCounts.completed),
      failed: Number(taskCounts.failed),
    },
    findingCount: Number(findingCount.count),
  });
}

async function handleFindings(): Promise<Response> {
  const db = getDb();
  const rows = await db
    .select()
    .from(findings)
    .orderBy(desc(findings.createdAt))
    .limit(50);

  return Response.json(rows);
}

async function handleLog(): Promise<Response> {
  const db = getDb();
  const rows = await db
    .select()
    .from(researchLog)
    .orderBy(desc(researchLog.createdAt))
    .limit(100);

  return Response.json(rows);
}

async function handleRules(): Promise<Response> {
  const researchDir = join(projectDir, 'research');
  const strategyPath = join(researchDir, 'strategy.md');
  const files: Array<{ path: string; name: string; content: string; category: string }> = [];

  // Strategy
  if (existsSync(strategyPath)) {
    files.push({
      path: 'research/strategy.md',
      name: 'Research Strategy',
      content: await readFile(strategyPath, 'utf-8'),
      category: 'strategy',
    });
  }

  // Prompts (agents + system prompts)
  const promptsDir = join(researchDir, 'prompts');
  if (existsSync(promptsDir)) {
    for (const file of await readdir(promptsDir)) {
      if (file.endsWith('.md')) {
        const content = await readFile(join(promptsDir, file), 'utf-8');
        files.push({
          path: `research/prompts/${file}`,
          name: file.replace('.md', '').replace(/-/g, ' '),
          content,
          category: 'prompt',
        });
      }
    }
  }

  return Response.json({ files });
}

async function handleDocuments(): Promise<Response> {
  const db = getDb();
  const [counts] = await db.select({
    total: sql<number>`count(*)`,
    metadata: sql<number>`count(*) filter (where status = 'metadata')`,
    downloaded: sql<number>`count(*) filter (where status = 'downloaded')`,
    extracted: sql<number>`count(*) filter (where status = 'extracted')`,
    classified: sql<number>`count(*) filter (where status = 'classified')`,
    embedded: sql<number>`count(*) filter (where status = 'embedded')`,
  }).from(documents);

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      contentType: documents.contentType,
      tags: documents.tags,
      topics: documents.topics,
      qualityScore: documents.qualityScore,
      peerReviewed: documents.peerReviewed,
      sourceCredibility: documents.sourceCredibility,
      author: documents.author,
      summary: documents.summary,
      status: documents.status,
      url: documents.url,
      scoutedAt: documents.scoutedAt,
    })
    .from(documents)
    .orderBy(desc(documents.scoutedAt))
    .limit(100);

  return Response.json({
    total: Number(counts.total),
    metadata: Number(counts.metadata),
    downloaded: Number(counts.downloaded),
    extracted: Number(counts.extracted),
    classified: Number(counts.classified),
    embedded: Number(counts.embedded),
    items: rows,
  });
}

async function handleClusters(): Promise<Response> {
  const db = getDb();
  const rows = await db
    .select()
    .from(researchLog)
    .where(sql`${researchLog.eventType} IN ('cluster_found', 'cluster_mature')`)
    .orderBy(desc(researchLog.createdAt))
    .limit(50);

  return Response.json(rows);
}

async function handleDiscoveries(): Promise<Response> {
  const db = getDb();
  const rows = await db
    .select()
    .from(discoveries)
    .orderBy(desc(discoveries.createdAt))
    .limit(50);

  return Response.json(rows);
}

async function handleDiscoveryPaper(id: number): Promise<Response> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(discoveries)
    .where(sql`${discoveries.id} = ${id}`)
    .limit(1);

  if (!row) return new Response('Not found', { status: 404 });
  return Response.json(row);
}

export function startWebServer(port: number, dir: string): void {
  projectDir = dir;

  // Init database from config
  const configPromise = loadConfig(projectDir).then((config) => {
    const dbUrl = getDatabaseUrl(config);
    initDatabase(dbUrl);
  });

  configPromise.then(() => {
    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        const headers = { 'Access-Control-Allow-Origin': '*' };

        try {
          if (url.pathname === '/api/status') {
            const res = await handleStatus();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname === '/api/findings') {
            const res = await handleFindings();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname === '/api/log') {
            const res = await handleLog();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname === '/api/rules') {
            const res = await handleRules();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname === '/api/documents') {
            const res = await handleDocuments();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname === '/api/documents/search') {
            const db = getDb();
            const query = url.searchParams.get('q');
            if (!query) return new Response(JSON.stringify({ error: 'Missing ?q= parameter' }), { status: 400, headers });
            const results = await db
              .select({
                id: documents.id,
                title: documents.title,
                contentType: documents.contentType,
                author: documents.author,
                summary: documents.summary,
                tags: documents.tags,
                topics: documents.topics,
                qualityScore: documents.qualityScore,
                sourceCredibility: documents.sourceCredibility,
                peerReviewed: documents.peerReviewed,
                url: documents.url,
              })
              .from(documents)
              .where(sql`
                ${documents.title} ILIKE ${'%' + query + '%'}
                OR ${documents.content} ILIKE ${'%' + query + '%'}
                OR ${documents.summary} ILIKE ${'%' + query + '%'}
                OR ${documents.tags}::text ILIKE ${'%' + query + '%'}
                OR ${documents.topics}::text ILIKE ${'%' + query + '%'}
                OR ${documents.author} ILIKE ${'%' + query + '%'}
              `)
              .limit(20);
            return new Response(JSON.stringify(results), { headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname.match(/^\/api\/documents\/\d+$/)) {
            const db = getDb();
            const id = parseInt(url.pathname.split('/').pop()!);
            const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
            if (!row) return new Response('Not found', { status: 404 });
            return Response.json(row, { headers });
          }
          if (url.pathname === '/api/search') {
            const query = url.searchParams.get('q');
            if (!query) return new Response(JSON.stringify({ error: 'Missing ?q= parameter' }), { status: 400, headers });
            try {
              const results = await searchSimilar(query, 10);
              return Response.json(results, { headers });
            } catch (e) {
              return Response.json({ error: 'Search requires Ollama with nomic-embed-text', detail: String(e) }, { headers });
            }
          }
          if (url.pathname === '/api/clusters') {
            const res = await handleClusters();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname === '/api/discoveries') {
            const res = await handleDiscoveries();
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }
          if (url.pathname.startsWith('/api/discoveries/')) {
            const id = parseInt(url.pathname.split('/').pop()!);
            const res = await handleDiscoveryPaper(id);
            return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
          }

          // ── Project API ──
          if (url.pathname === '/api/projects' && req.method === 'GET') {
            const db = getDb();
            const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
            return Response.json(rows, { headers });
          }
          if (url.pathname === '/api/projects' && req.method === 'POST') {
            const db = getDb();
            const body = await req.json() as { title: string; description?: string };
            const [project] = await db.insert(projects).values({
              title: body.title,
              description: body.description ?? null,
            }).returning();
            await db.insert(researchLog).values({
              eventType: 'project_created', agentType: 'user',
              details: { projectId: project.id, title: project.title },
            });
            return Response.json(project, { headers });
          }
          if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === 'GET') {
            const db = getDb();
            const id = parseInt(url.pathname.split('/').pop()!);
            const [project] = await db.select().from(projects).where(eq(projects.id, id));
            if (!project) return new Response('Not found', { status: 404 });

            const projectFindings = await db.select().from(findings)
              .where(eq(findings.projectId, id)).orderBy(desc(findings.createdAt)).limit(50);
            const projectTasks = await db.select({
              pending: sql<number>`count(*) filter (where status = 'pending' and project_id = ${id})`,
              inProgress: sql<number>`count(*) filter (where status = 'in_progress' and project_id = ${id})`,
              completed: sql<number>`count(*) filter (where status = 'completed' and project_id = ${id})`,
            }).from(agentTasks);
            const projectLog = await db.select().from(researchLog)
              .where(sql`${researchLog.details}->>'projectId' = ${String(id)}`)
              .orderBy(desc(researchLog.createdAt)).limit(50);

            return Response.json({
              ...project,
              findings: projectFindings,
              tasks: { pending: Number(projectTasks[0].pending), inProgress: Number(projectTasks[0].inProgress), completed: Number(projectTasks[0].completed) },
              log: projectLog,
            }, { headers });
          }
          if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === 'PATCH') {
            const db = getDb();
            const id = parseInt(url.pathname.split('/').pop()!);
            const body = await req.json() as { status?: string; workers?: number };
            await db.update(projects).set({ ...body, updatedAt: new Date() }).where(eq(projects.id, id));
            const [updated] = await db.select().from(projects).where(eq(projects.id, id));
            return Response.json(updated, { headers });
          }
          if (url.pathname.match(/^\/api\/projects\/\d+\/generate$/) && req.method === 'POST') {
            const db = getDb();
            const id = parseInt(url.pathname.split('/').pop()!.replace('/generate', ''));
            await db.insert(researchLog).values({
              eventType: 'project_generate_requested', agentType: 'user',
              details: { projectId: id },
            });
            return Response.json({ ok: true }, { headers });
          }

          // Pages
          if (url.pathname === '/' || url.pathname === '/index.html') {
            return new Response(Bun.file(DASHBOARD_HTML));
          }
          if (url.pathname === '/projects') {
            return new Response(Bun.file(PROJECTS_HTML));
          }
          if (url.pathname.match(/^\/project\/\d+$/)) {
            return new Response(Bun.file(PROJECT_HTML));
          }
        } catch (err) {
          console.error('API error:', err);
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not found', { status: 404 });
      },
    });

    console.log(`Dashboard running at http://localhost:${server.port}`);
    console.log('Press Ctrl+C to stop.');

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      server.stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      server.stop();
      process.exit(0);
    });
  }).catch((err) => {
    console.error('Failed to start web server:', err);
    process.exit(1);
  });
}
