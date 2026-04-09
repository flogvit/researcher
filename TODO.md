# TODO

## Web — migrate to Next.js
- Replace static HTML files (Bun.serve) with Next.js app
- Admin panel for agents: create, edit, delete agents with .md prompt files
- Pipeline flow editor: drag-and-drop steps, add/remove agents per step
- When adding a new agent via UI, queue Opus to generate the .md file
- Module config editor (research.json, discovery.json, etc.)
- Markdown editor for prompts with preview
- Keep existing API routes as Next.js API routes

## Sources
- Add more source plugins beyond DOAJ (Google Scholar, Semantic Scholar, OpenAlex, CrossRef, PubMed, arXiv)
- Bootstrapper should pick relevant sources for the domain

## Learning loop
- Track which agents contributed to each paper (agentsUsed field is null today)
- Support add_agent and modify_config proposal types in learner (only modify_prompt works now)
- CLI command to trigger learning manually: `researcher learn`

## Init
- Support more interactive setup (pick sources, configure agents interactively)
