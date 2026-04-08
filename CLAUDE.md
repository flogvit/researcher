# Researcher

Generic autonomous AI research system with subsystem architecture.

## Tech Stack
- Bun runtime, bun:sql, bun test
- PostgreSQL + pgvector + Drizzle ORM
- Claude Code CLI (`claude -p` via stdin)
- Ollama for embeddings (nomic-embed-text)

## Conventions
- ESM modules with .js extensions
- English codebase
- Research language is configurable per project

## Running
- `researcher init` — Initialize new research project
- `researcher library start/update/status` — Document library pipeline
- `researcher start` — Run all subsystems
- `researcher status` — Check all subsystems

## Database
PostgreSQL, database name configured per project in researcher.json.
Migrations: `bun run db:migrate`
