# Researcher

Generic autonomous AI research system. Give it a domain, and it builds a library, researches, discovers novel findings, and writes papers.

## Principles

1. **Download first, research later.** The system downloads all available research from academic sources before doing its own analysis.
2. **Don't reinvent the wheel.** All findings are checked against existing literature. We only research what's actually unexplored.
3. **Source agents are thorough.** Each source plugin downloads everything matching the search terms, not just the first page.
4. **Projects follow academic flow.** Literature search → review → identify gaps → research → write paper.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh)
- PostgreSQL with pgvector
- [Claude Code](https://claude.ai/code) CLI (or Codex/OpenCode)
- Ollama with nomic-embed-text (embeddings) and a model for text extraction

### Setup

```bash
bun install
bun link    # install as global 'researcher' command
```

### Running

```bash
# Start researcher (web UI + admin queue)
researcher start

# If no researcher.json exists, the web UI shows a setup page
# where you enter domain and language. The AI bootstraps the project.

# Or initialize from CLI instead:
researcher init "biblical studies"
```

Open http://localhost:3051 — the dashboard shows subsystem controls where you start/stop:
- **Library** — collect documents from academic sources
- **Research** — analyze and find
- **Discovery** — synthesize findings into discoveries
- **Paper** — write and review papers

```bash
# Run subsystems directly from CLI (alternative to web UI)
researcher library start
researcher research start

# One-shot mode
researcher library update
researcher research update

# Next.js admin UI (development)
bun run web:dev

# Trigger learning manually
researcher learn

# Upgrade existing project to latest version
researcher upgrade
```

## Commands

### Core

| Command | Description |
|---------|-------------|
| `researcher init [domain]` | Initialize new project. AI-bootstrapped if domain given. |
| `researcher start` | Start web UI with subsystem management |
| `researcher status` | Show status of all subsystems |
| `researcher web` | Start the web dashboard |
| `researcher upgrade` | Upgrade project to latest version (configs, prompts, migrations) |

### Library (document pipeline)

| Command | Description |
|---------|-------------|
| `researcher library start` | Run library pipeline continuously |
| `researcher library update` | Run library pipeline once |
| `researcher library status` | Show documents per pipeline stage |
| `researcher library retry` | Retry failed documents |

### Research

| Command | Description |
|---------|-------------|
| `researcher research start` | Run research pipeline continuously |
| `researcher research update` | Run one research cycle |
| `researcher research status` | Show task queue and findings count |

### Discovery

| Command | Description |
|---------|-------------|
| `researcher discovery start` | Run discovery pipeline continuously |
| `researcher discovery update` | Run one discovery pass |
| `researcher discovery status` | Show discovery counts by status |

### Paper

| Command | Description |
|---------|-------------|
| `researcher paper start` | Run paper pipeline continuously |
| `researcher paper update` | Run one paper pass |
| `researcher paper status` | Show paper counts by status |

### Projects

| Command | Description |
|---------|-------------|
| `researcher project create [title]` | Create a research project |
| `researcher project list` | List all projects |
| `researcher project status <id>` | Show project details |
| `researcher project start <id>` | Activate a project |
| `researcher project pause <id>` | Pause a project |

### Utilities

| Command | Description |
|---------|-------------|
| `researcher focus <topic>` | Set research focus |
| `researcher seed` | Add initial research tasks |
| `researcher report` | Show recent findings |
| `researcher learn` | Trigger learning cycle manually |
| `researcher queue` | Process admin task queue (add `--watch` for continuous) |

## Configuration

### researcher.json

Main configuration file, created by `init`:

```json
{
  "name": "my-research",
  "description": "...",
  "language": "en",
  "database": "researcher_my_research",
  "llm": {
    "provider": "claude",
    "model": "opus",
    "allowedTools": ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]
  },
  "agents": {
    "reviewer": { "model": "sonnet" },
    "triage": { "provider": "ollama", "model": "gemma4:31b" }
  },
  "embedding": {
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434"
  },
  "library": {
    "sources": [
      {
        "type": "doaj",
        "enabled": true,
        "interval": 86400,
        "settings": {
          "searchTerms": ["term1", "term2"],
          "filters": { "yearFrom": 2020, "openAccessOnly": true }
        }
      }
    ],
    "localSources": [
      {
        "path": "/path/to/documents",
        "enabled": true,
        "name": "My Documents",
        "extensions": [".txt", ".md", ".pdf"],
        "recursive": true
      }
    ]
  },
  "research": {
    "agentTypes": ["exegete", "historian"],
    "strategyFile": "research/strategy.md",
    "reflectEvery": 3
  },
  "orchestrator": {
    "dependencyTimeout": 60000,
    "dependencyPollInterval": 500
  }
}
```

### Module configs

Each subsystem has its own config in `research/modules/` (or shipped defaults):

- `research.json` — tick interval, batch sizes, step configs (triage, execute, review, reflect, etc.)
- `discovery.json` — synthesis batch size, novelty/lit-search batch sizes
- `paper.json` — review threshold for learner
- `library.json` — fetch/download delays, content truncation limits, extractor model

### Per-agent LLM overrides

Every internal component is an "agent" with a configurable LLM. Set overrides in `agents` section of `researcher.json`:

Available agent names: `triage`, `reviewer`, `reflector`, `task-generator`, `supervisor`, `researcher`, `discovery`, `paper`, `learner`, `bootstrap`, plus any domain-specific agents.

Supported providers: `claude`, `ollama`, `codex`, `opencode`.

## Source Plugins

| Source | API | Auth | Filters |
|--------|-----|------|---------|
| DOAJ | REST | None | — |
| OpenAlex | REST | None (mailto for polite pool) | yearFrom/To, openAccessOnly, type |
| Semantic Scholar | REST | Optional API key | year range, OA (client-side), type (client-side) |
| CrossRef | REST | None (mailto for polite pool) | yearFrom/To, type, has-license |
| PubMed | E-utilities | Optional API key | year range, OA, publication type |
| arXiv | Atom XML | None | year (client-side) |
| Local directories | Filesystem | — | extensions, recursive |

All API sources use randomized delays (2-10s default) between requests to avoid rate limiting.

## Web UI

Next.js admin interface in `web/`. Run with `bun run web:dev`.

Pages:
- **Dashboard** — system status, findings, task overview
- **Agents** — view/edit agent prompts, create new agents
- **Sources** — document pipeline stats, source config editor
- **Config** — module config editor, agent LLM config
- **Pipeline** — visual flow editor (React Flow) with step toggling
- **Projects** — create/manage research projects
- **Queue** — admin task monitor

The web UI uses an admin task queue — changes are queued and processed by the backend (`researcher queue --watch` or the web server's built-in processor).

## Architecture

```
researcher.json          # Project config
research/
├── strategy.md          # Research strategy
├── prompts/             # Agent prompts (one .md per agent)
├── methods/             # Methodology documents
└── modules/             # Module configs (research.json, etc.)

src/
├── cli.ts               # CLI entry point
├── config.ts            # Config types and loader
├── core/                # Orchestrator, learner, admin tasks, state
├── llm/                 # LLM abstraction (claude, ollama, codex, opencode), embeddings, ollama manager
├── subsystems/
│   ├── library/         # Document pipeline: sources → download → extract → classify → embed
│   ├── research/        # Task execution: triage → execute → review → reflect
│   ├── discovery/       # Synthesis → novelty check → literature search
│   └── paper/           # Domain review → write → originality check → peer review → revise
└── web/                 # API server (Bun.serve)

web/                     # Next.js admin UI
└── app/                 # App router pages
```

## Tech Stack

- **Bun** — runtime, test, package manager
- **PostgreSQL** + pgvector — database, embeddings, RAG
- **Drizzle ORM** — type-safe database
- **Claude Code CLI** — LLM reasoning (also supports Codex, OpenCode, Ollama)
- **Ollama** — embeddings (nomic-embed-text), local models
- **Next.js** + React Flow — admin UI

## License

MIT
