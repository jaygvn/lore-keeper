# Architecture — Lore Keeper

## Purpose

Lore Keeper is a reference "pond agent" that answers questions about Tobyworld lore.

Design goals:
- canon integrity (anti-distortion)
- auditability (every Q/A is logged in Issues)
- forkability (Toadgang can evolve new agents from the template)

## Repos and responsibilities

### 1) Canon repo: `lore-scrolls` (private recommended)

- Stores the full markdown lore corpus.
- Should be treated as canon / source of truth.
- Changes should be reviewable and deliberate.

### 2) Agent repo: `lore-keeper`

- Automation + scripts + docs.
- Stores derived artifacts:
  - `data/scroll_index.json` (searchable index)
  - `data/stats.json` (usage stats)

## Retrieval model

- Index build scans `lore-scrolls/**/*.md`
- Each scroll becomes a lightweight index entry (title/tags/summary/text_preview)
- At question time, the script scores scroll entries and selects the top 5

## Answer format (role model)

Every answer must include:
- **Signal** (direct bullet summary)
- **Reflection** (brief, lore-aligned)
- **Sources** (citations)

Citations are mandatory to make distortion harder and verification easier.

## Mirror Runtime integration

Mirror Runtime (OpenClaw-based custom runtime) can treat this as one surface:
- same canon
- same index schema
- same citation rules
- multiple interfaces (GitHub / Telegram / local runtime)
