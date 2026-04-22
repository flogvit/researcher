# TODO

## Oppgavekø (admin tasks)
- [x] Admin task processor (`core/admin-tasks.ts`) — plukker opp `admin:*` tasks fra agentTasks
- [x] Støtter: `create_agent`, `modify_config`, `run_learner`
- [x] Web API: POST `/api/admin/tasks` (enqueue), GET `/api/admin/tasks` (list), GET `/api/admin/tasks/:id` (status)
- [x] Prosesseres hvert 5. sekund av web server
- [x] `modify_prompt` admin task — lagre prompt-endringer fra web editor
- [x] `delete_agent` admin task — sletter agent prompt-fil
- [x] `modify_researcher_config` admin task — endrer researcher.json
- [x] `bootstrap_project` admin task — full prosjekt-bootstrap fra web UI
- [ ] Flere admin task-typer etter behov (update_source settings, etc.)

## Web — Next.js
- [x] Next.js app i `web/` — app router, proxyer /api/* til backend
- [x] Dashboard — status, findings, task-oversikt, auto-refresh
- [x] Agents-side — vis/les alle prompter, opprett ny agent via kø
- [x] Sources-side — dokument-statistikk, pipeline-status, søk
- [x] Config-side — endre module config via kø (modul + key + value)
- [x] Projects-side — list, opprett, vis status/fase/findings
- [x] Queue-side — vis admin-oppgaver med status, auto-refresh
- [x] `researcher queue` CLI — prosesser admin-kø (one-shot eller --watch)
- [x] Prompt editor — textarea med preview, lagrer via admin-kø (`modify_prompt`)
- [x] Agent edit-side (`/agents/[name]`) med edit/preview toggle
- [x] Pipeline flow visualisering (`/pipeline`) — React Flow med moduler, steps, og inter-modul koblinger
- [x] Pipeline flow editing — double-click step for å toggle enabled/disabled, lagrer via admin-kø
- [x] Pipeline editing — klikk step for editor panel, endre enabled/every/batchSize/maxTasks
- [x] Agent config editor (`/config/agents`) — per-agent provider/model/maxTurns override med modal
- [x] Local source directory picker — legg til lokale kataloger via `/sources/edit`
- [x] Setup-side (`/setup`) — domene/language-skjema, bootstrap via API, redirect til dashboard
- [x] `researcher start` starter bare web UI + queue (ikke subsystemer)
- [x] Subsystem start/stopp fra dashboard med knapper
- [x] Auto-redirect til /setup hvis prosjektet ikke er initialisert
- [x] Source config-side (`/sources/config`) — viser alle kilder med settings, søketermer, API keys
- [x] Source editor (`/sources/edit`) — endre søketermer, API keys, mailto, interval, legg til nye kilder
- [x] `modify_researcher_config` admin task — endrer researcher.json direkte

## Sources
- [x] OpenAlex — fri API, cursor-paginering, abstract-rekonstruksjon fra inverted index
- [x] Semantic Scholar — fri API (100 req/5min), optional apiKey, håndterer 429
- [x] CrossRef — fri API, polite pool via mailto, DOI-basert
- [x] PubMed — NCBI E-utilities (esearch + efetch), optional apiKey
- [x] arXiv — Atom XML API, XML-parsing, preprints markert som peerReviewed='no'
- [ ] Google Scholar (krever scraping eller SerpAPI — mer komplisert)
- [x] Bootstrapper anbefaler relevante kilder — AI velger basert på domenet, bruker vises i init
- [x] Per-kilde søketermer via web UI (`/sources/edit`)
- [x] Per-kilde filtre — `SourceFilters` (yearFrom/yearTo/openAccessOnly/type) i types.ts
  - OpenAlex: native filter param
  - CrossRef: native filter param (from-pub-date, type, has-license)
  - Semantic Scholar: native year param + client-side OA/type filter
  - PubMed: bygger inn i søketerm (Date, Publication Type, open access filter)
  - arXiv: client-side year filter (API mangler native støtte)
- [x] API key management via web UI (`/sources/edit` modal for Semantic Scholar, PubMed)

## Konfigurerbarhet
- [x] Rate limiting — randomisert delay 2-10s for DOAJ og downloader
- [x] Tick intervals — alle dispatchers leser fra module config
- [x] Batch sizes og limits — `batchSize`, `maxTasksPerCycle`, per-step `batchSize`/`maxTasks`
- [x] Thresholds — `minFindings`, `reviewThreshold`, `generateWorkCooldown`, `rateLimitRecoveryCap`
- [x] Content truncation — `classifyContentLimit`, `extractorHtmlLimit`, `extractorMinContent`
- [x] Embedding config — `ProjectConfig.embedding` med model og baseUrl
- [x] Text-extractor modell — `extractorModel` i library.json (faller tilbake til OLLAMA_MODEL env)
- [x] Orchestrator dependency timeout/poll — `orchestrator.dependencyTimeout`/`dependencyPollInterval` i researcher.json

## Model & tool control
- [x] `AgentConfig` type (`provider?, model?, baseUrl?, allowedTools?, maxTurns?`)
- [x] `agents` seksjon i researcher.json — per-agent overrides
- [x] `createLLM()` factory — agent-override → global → defaults
- [x] Alle dispatchers bruker agent-spesifikke LLM-instanser
- [x] Bootstrap bruker agent-config istedenfor hardkodet Opus
- [x] Codex backend — `callCodex()` i LLM, spawner `codex` CLI
- [x] OpenCode backend — `callOpenCode()` i LLM, spawner `opencode` CLI
- [x] LLMProvider type utvides: claude | ollama | codex | opencode
- [x] Init støtter alle providers interaktivt
- [x] Ollama manager — auto-start server, pull modell, stopp modell, sjekk status
- [x] Ollama auto-setup ved første kall (ensureOllamaRunning + ensureModel)
- [ ] OpenClaw backend (avventer CLI-dokumentasjon)
- [ ] Tools per agent utover allowedTools for claude

## Lokale kilder
- [x] `LocalSourceConfig` i config.ts (path, enabled, name, extensions, recursive, interval)
- [x] Source plugin (`sources/local.ts`) — scanner kataloger med Bun.Glob
- [x] Tekst/md → extracted, PDF → downloaded (text-extractor håndterer)
- [x] Inkrementell oppdatering via mtime-sjekk
- [x] Integrert i library dispatcher med interval-støtte
- [x] Slette dokumenter fra indeks når filer fjernes fra katalog (status → 'removed')
- [x] Tittel-ekstraksjon fra markdown H1 og HTML `<title>`

## Learning loop
- [x] Track agentsUsed — slår opp findings via findingId + synthesis cluster logs
- [x] add_agent proposal — oppretter ny agent prompt-fil i research/prompts/
- [x] modify_config proposal — oppdaterer module config JSON (støtter nestede nøkler)
- [x] CLI command: `researcher learn` — tvinger læringssyklus uavhengig av threshold

## Init
- [x] Interaktiv kildevalg — velg blant alle tilgjengelige kilder (doaj, openalex, semantic-scholar, crossref, pubmed, arxiv)
- [x] Interaktiv LLM-provider og modellvalg (claude/ollama + modellnavn)
- [x] Interaktiv agent-konfigurasjon — velg hvilke agenter å beholde etter bootstrap
- [x] `researcher upgrade` — oppgraderer eksisterende prosjekt (merge config, nye prompter, migrasjoner)
