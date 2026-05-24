# Authoring Layer — Vision and Design (Fase 4)

**Status:** Vision draft
**Date:** 2026-05-24
**Author:** Brainstormed with Claude (model: claude-opus-4-7)
**Related milestone:** Fase 4 — Authoring
**Issues this doc covers:** see the `area:drafts` label

---

## 1. The gap

Today's architecture handles three things:

- **Input** — ingested documents, sources, findings, clusters
- **Inner state** — chat sessions, peer_conclusions, intent router, proposal queue
- **Side effects** — admin tasks, notifications

What's missing: a layer for **what the researcher actually produces**. There is no surface for drafts, commentaries, syntheses, briefings — the work product of research.

A researcher's core activity is *writing*. A system that ingests and structures sources but offers no place to author outputs is a reading/synthesis tool, not a research workshop. Adding an authoring layer turns the platform from a passive aggregator into a place where work compounds into something the user identifies with.

## 2. Core idea — drafts as living research targets

Introduce **drafts** as a first-class entity, distinct from ingested documents:

- An ingested document is *input* — a paper, a corpus file, an article from a source plugin.
- A draft is *authored output* — a commentary chapter, a thematic study, a sermon outline, a literature review.

But the claim is sharper than "drafts are an output surface". A draft is a **research target**. The existing autonomous subsystems (library, research dispatcher, discovery, paper) can be *steered* by an active draft — its parameters and scope become priority signals for what to ingest and analyze. As new findings land that match the draft's scope, the system emits **insertion proposals** at the relevant sections. The draft updates *live* while the user reads it, and the chat panel next to it is the wheel that turns the system's attention.

This is the line we want to hold: **not a markdown editor with AI suggestions** (Lex.page, Notion AI, ChatGPT Canvas, Cursor already do that — and they have the "AI slop / confirmation bias / generic output" credibility problem we discussed earlier). The differentiator is the **autonomous loop**: the research system actively researches the document target while the user is away, the document accumulates the work, the user has the wheel. Without that autonomous loop, this would just be `markdown editor + claude cli + skills` — fine for casual use, but not a research workshop.

Drafts are markdown-based and linear (sections within a single document, not block-based à la Roam/Notion). They live in Postgres, with versioned snapshots on every body change. Git export comes later, as a power-user feature, not a primary backend.

Each draft is the **anchor** for:

- A dedicated chat session ("we're working on this")
- A **research scope** — keywords, sources, sub-corpus filter; steers the autonomous subsystems
- A set of referenced findings/sources (some pulled by the system, some hand-picked)
- A live stream of researcher-proposed edits and insertions (accepted, rejected, or stale)
- The skill template it was scaffolded from (if any)

## 3. Four product loops

**A. Cold-start: skill template → first draft.**
User picks a skill (e.g., `bibel`) and a template within it (e.g., `chapter-commentary`). User fills in parameters (which book, which chapter, scope). Researcher generates v1 by combining template structure + relevant ingested findings + user preferences from peer_conclusions. User now has a draft to react to instead of a blank page.

**B. Editorial: chat → diff proposals → accept/reject.**
The chat panel is anchored to the current draft. User says *"den teologiske diskusjonen i seksjon 3 mangler nyanse på det reformerte ståstedet"*. Researcher analyzes the relevant section, proposes a **range-diff** (similar to a GitHub code-review suggestion). User reviews per-range, accepts or rejects. Accepted ranges are applied; a new revision is snapshotted with `source = 'proposal:<id>'`.

**C. Compounding: drafts → user model → next draft.**
A deriver-style extractor reads completed drafts and pulls out style/voice/methodology cues (*"tends to open a section with a textual observation before moving to theological reflection"*) into peer_conclusions. The next draft starts smarter because past drafts taught the system who the author is — without the user ever having to fill in a profile.

**D. Autonomous: background research → live insertion proposals into the draft.**
Independent of user activity, the research subsystems keep working. When a finding lands that semantically matches an anchored draft's scope (current body + research_scope keywords), the system emits an **insertion proposal**: *"I found X, here's the paragraph it belongs in, here's the section it goes under."* Over a day of background work, a draft can accumulate dozens of proposals — most rejected, some refined, a few accepted directly. This is the loop that makes the system a *workshop with an assistant working overnight*, not a chat tool that needs you at the keyboard. When the user opens the editor in the morning, the draft has visibly progressed and a queue of proposals is waiting.

## 4. Why diff-mediated, not free AI-editing

When researcher proposes edits as **diffs the user reviews per-range**, three things happen that don't happen with free AI-editing:

- **The user owns the text.** Nothing the AI writes lands without explicit per-range approval. Reversal is trivial.
- **It reuses the existing proposal pattern.** Issue #89 already plans an approval UX for chat-driven changes. Draft edits are a *new type* of proposal, same mechanism.
- **It maps to a real workflow.** Reviewers leave change-suggestions; authors accept some, dismiss others. The metaphor is honest. Compare with "AI rewrote your stuff" — fine for a brainstorm, wrong for serious authorship.

Free editing is still available — the markdown editor is directly typeable by the human. The *AI's* path to the text is always proposal-mediated.

## 5. Skills, templates, and the authoring layer

A skill is more than prompts + source configuration. It ships with **document templates** — scaffolds for the kinds of work that domain produces.

A `bibel` skill might ship with:

- `chapter-commentary.md` — verse-by-verse commentary outline
- `thematic-study.md` — topical study across the canon
- `sermon-outline.md` — narrative-arc-oriented outline
- `translation-comparison.md` — side-by-side textual variant analysis

A template is a markdown file with sections, optional placeholders, and a small frontmatter spec (parameters required, default prompt for v1 generation, suggested findings filter). The skill loader registers templates alongside the skill's other configuration.

This sharpens the user-facing answer to *"what does a skill do?"* — it becomes *"what does a skill help you make?"*. The templates are the surface; prompts and sources are infrastructure that makes templates work.

The downloadable-skills idea from earlier brainstorming gains real concreteness here: you don't browse abstract "skills", you browse the *kinds of work* you can do. The platform's home page can showcase actual rendered drafts produced from the templates.

## 6. Architecture sketch

```
┌──────────────────────────────────────────────────────────────┐
│ Surfaces                                                       │
│  ├── Web UI: /drafts (list), /drafts/[id] (editor + chat)     │
│  └── CLI: `researcher drafts {create,list,show,edit,gen}`     │
└──────────────────────────────────────────────────────────────┘
                            ↕
┌──────────────────────────────────────────────────────────────┐
│ Drafts API                                                     │
│  POST /api/drafts                    (create; optionally from │
│                                       skill template)         │
│  GET  /api/drafts                                              │
│  GET  /api/drafts/:id                                          │
│  PATCH /api/drafts/:id               (free human edit)         │
│  POST /api/drafts/:id/generate       (SSE; full or section)   │
│  POST /api/drafts/:id/proposals      (SSE; AI suggests diffs) │
│  POST /api/drafts/:id/proposals/:pid/{accept,reject}          │
│  GET  /api/drafts/:id/revisions                                │
└──────────────────────────────────────────────────────────────┘
                            ↕
┌──────────────────────────────────────────────────────────────┐
│ Drafts subsystem (src/subsystems/drafts/)                     │
│  ├── store.ts        CRUD + revision snapshots                │
│  ├── generator.ts    initial draft from template + sources    │
│  ├── proposer.ts     diff-based edit proposals                │
│  ├── sections.ts     markdown-section parser/anchor utils     │
│  └── prompts: research/prompts/agents/{author,reviewer}.md    │
└──────────────────────────────────────────────────────────────┘
                            ↕
┌──────────────────────────────────────────────────────────────┐
│ Chat subsystem (extended)                                      │
│  chat_sessions.draft_id (nullable FK)                          │
│  Context assembly: when draft_id set, include current draft   │
│    body (or relevant section) + recent proposals + findings   │
└──────────────────────────────────────────────────────────────┘
                            ↕
┌──────────────────────────────────────────────────────────────┐
│ Persistence (new tables)                                       │
│  drafts(id, project, skill, template, title, body_md, …)      │
│  draft_revisions(id, draft_id, body_md, summary, source, …)   │
│  draft_edit_proposals(id, draft_id, range, original,          │
│                       replacement, status, …)                 │
└──────────────────────────────────────────────────────────────┘
                            ↕
┌──────────────────────────────────────────────────────────────┐
│ Research subsystems (extended — library/research/discovery)    │
│  When a draft is anchored/active, its research_scope feeds    │
│  the dispatcher's priority logic. New findings matching the   │
│  draft semantically → emit `draft_edit_proposals` rows of     │
│  type 'insertion' targeted at the right section.              │
└──────────────────────────────────────────────────────────────┘
                            ↕
┌──────────────────────────────────────────────────────────────┐
│ User model loop (extended)                                     │
│  Deriver consumes completed drafts → extracts voice/style/    │
│  methodology → peer_conclusions (topics: style, methodology)  │
└──────────────────────────────────────────────────────────────┘
```

The autonomous loop is the load-bearing element: research subsystems become *aware of anchored drafts* and steer their work toward them. The draft is a **focus magnet** for the rest of the platform, not a passive output surface.

## 7. Why this changes the product positioning

The user interacts with the system in a categorically different way once authoring exists:

- Before: *"I have a tool that finds things and remembers."*
- After (writing layer alone): *"I have a workshop where I write things, and the workshop helps."*
- After (writing layer + autonomous loop): *"I have a workshop where I'm working on something — and the system is working on it alongside me, even when I'm not at the keyboard."*

The third state is the one that justifies the project. The first two are commodity (any LLM-aware editor offers some version). The third is a real research workshop.

For the Bible-as-personal-use-case, the difference is concrete: a Bible reference tool tells you what's in the text when you ask. A Bible study workshop *is researching Romans 8 right now*, finding cross-references in the Talmud, noting Septuagint variants, and queueing suggested footnotes for the chapter commentary you're working on — while you're cooking dinner.

This also makes the skill marketplace tangible. *"What does Bible-skill do?"* becomes *"It helps you make chapter commentaries, thematic studies, sermon outlines, and translation comparisons — here are examples, and the system will keep researching whatever you start."* The site that presents results AND lets people download the skill setup (earlier brainstorm) has a real product loop: read a rendered chapter commentary → click "I want to do this for [my corpus]" → download the skill structure, swap in your sources, the autonomous loop starts working on day one.

## 8. Relation to existing milestones

| Existing | What this phase adds |
|---|---|
| Chat sessions stand alone | Chat sessions optionally anchored to a draft |
| Context assembly = findings + memory + history | + current draft + recent proposals |
| Proposal queue handles chat-driven config changes | + draft edit proposals (range-replacement and insertion types, same UX) |
| Deriver extracts conclusions from chat turns | + extracts voice/style from completed drafts |
| Documents = ingested inputs | + drafts = authored outputs (distinct table, distinct lifecycle) |
| Research subsystems run on global project scope | + draft-scoped research focus: anchored drafts steer the dispatcher |
| Findings live in `findings` table, surfaced in dashboard | + relevant findings auto-proposed into anchored drafts as insertions |

The authoring layer composes with the existing architecture. It doesn't replace anything. It gives most of what's already there a place to compound into a deliverable.

## 9. Open questions

1. **Section granularity for diffs.** Character-range, line-range, paragraph-range, or markdown-section range? Character-range is most precise; markdown-section is the cleanest mental model. Likely answer: store char-range *and* a markdown-section anchor (heading path), so proposals can rebase when the body shifts.

2. **Template location in a skill.** Co-located in the skill package (`skill/templates/*.md`) with frontmatter, or registered programmatically? Co-located is simpler and lets non-engineers contribute templates.

3. **Conflict between human edit and pending proposal.** User free-edits section 3 while there's an open proposal for section 3. Options: auto-invalidate (mark stale), attempt rebase via anchor, or block. For v1: try rebase via anchor; mark stale if rebase fails.

4. **Multi-draft cross-reference.** Drafts citing each other (*"see chapter-3-commentary for the textual basis"*)? Yes eventually, defer.

5. **Export formats.** Markdown is the source of truth. DOCX/PDF/HTML for sharing — yes eventually, defer.

6. **Git export model.** Drafts as `drafts/<slug>.md` in a sync'd repo, with each accepted proposal becoming a commit (proposal-as-commit, clean), or full-snapshot commits per save? Proposal-as-commit is conceptually cleanest. v2 concern.

## 10. Out of scope for Fase 4

- Block-based / Notion-style editor (linear markdown only)
- Multi-author collaboration (single-user system)
- Real-time CRDT collaboration
- Export to DOCX/PDF/EPUB (markdown only initially)
- Git as backend storage (markdown + revisions in Postgres is v1; git export is later)
- Skill marketplace / downloadable third-party skills (templates ship with built-in skills; community marketplace is a separate phase)

---

## Appendix: Influences

- **Claude Artifacts / ChatGPT Canvas** — the side-by-side draft + chat pattern, AI as editorial collaborator on a visible artifact rather than a chat output target.
- **GitHub PR review suggestions** — range-scoped diffs the author accepts/rejects per-range.
- **Lex.page** — AI as writing collaborator anchored to a single document.
- **Scrivener** — drafts as the *unit of work* a researcher identifies with, not loose notes.
- **agentskills.io / Claude Skills** — skills as declarative packages; templates as part of that declarative surface.
