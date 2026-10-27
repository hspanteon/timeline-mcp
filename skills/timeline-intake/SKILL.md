---
name: timeline-intake
description: Register a new Duell Admin timeline task and produce its initial analysis. Creates timeline/{task-id}/task.md, analysis.md, and progress.md from the timeline MCP or the user's description, with impact analysis, DB change analysis, legacy references, and a first-pass time estimate. Use when Claude is asked to start/register/create a new task, run intake, analyze a ticket before work begins, or set up a timeline folder. Fires once per task — for logging work or reporting status afterwards use `timeline-progress`.
argument-hint: <task-id>
---

# Timeline Intake

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: timeline-intake`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Phase 1 of the timeline lifecycle: `timeline-intake` -> `timeline-progress` (repeats) -> `timeline-release` (repeats).

Create the task record and its analysis. Do not implement code, and do not create `release-note.md` or `qa-plan.md`.

Create only these files:

```text
timeline/{task-id}/task.md
timeline/{task-id}/analysis.md
timeline/{task-id}/progress.md
```

Ask for a task ID when missing. Never guess a task ID.

If `timeline/{task-id}/` already exists, stop and say so — hand off to `timeline-progress` rather than overwriting an in-flight task's files.

## Input

If the timeline MCP is connected, fetch the task with `mcp__timeline-mcp__get_task_conversation` — it produces `timeline/{task-id}/task.md`. Verify the file exists afterwards and do not overwrite an MCP-fetched `task.md` with the template below.

Otherwise extract from the user message:

- Task ID: numeric or alphanumeric, such as `5384` or `DUEL-291`.
- Title: short feature or bug title.
- Description: full requirement text after the title.

If any field is missing, ask before proceeding.

## Research

Before writing `analysis.md`, search the codebase with 2-3 representative keywords from the title and description:

- `backoffice/src/Controller/`
- `shared/src/`
- `shared/src/Entity/`
- `backoffice/assets/js/`
- `backoffice/templates/`
- route attributes in controllers
- `../duell-pos/src/` when accessible

Read the most relevant controller, entity, repository, template, JS, or legacy files found. Base analysis on actual code, not assumptions.

For the **DB Change Analysis** section specifically, check the live database with the `db-access` skill before declaring a table, column, or index "new" — it owns DB credentials and the tenant→DB registry. Something already present on some tenants is a partial migration, not a fresh schema change, and that distinction changes both the plan and the estimate.

## Estimation

Intake does not estimate. `timeline-estimate` owns every number in this repo — it classifies the work type, sizes against the closest already-migrated analog, and splits manual vs AI-assisted hours. Intake has none of that method, so a table of hours written here would be invented.

Leave `analysis.md`'s Time Analysis section as the not-estimated stub below. When the user wants a number, they run `timeline-estimate {task-id}`, which fills that section in.

**Never invoke `timeline-estimate` from intake.** The dependency runs one way only: `timeline-estimate` calls intake when a task's folder is missing. Calling back would loop.

## task.md (only when not fetched via MCP)

```markdown
# Task {task-id}: {Title}

**ID:** {task-id}
**Title:** {Title}
**Date Created:** {today YYYY-MM-DD}
**Status:** In Analysis

## Description

{Full description exactly as user provided}

## Acceptance Criteria

{Derived from description. Mark inferred items with `[inferred]`.}

## Open Questions

{Ambiguities needing clarification, or "None."}
```

`Status` moves through `In Analysis` -> `In Progress` -> `Ready for QA` -> `In QA` -> `Ready for Prod` -> `Live`, with `Reopened` when a released task comes back. Intake sets `In Analysis` and never advances it — `timeline-progress` owns every later transition.

## progress.md

Create the skeleton only. `timeline-progress` appends work-log rows; `timeline-release` appends release rows.

```markdown
# Progress Log - Task {task-id}

## Work Log

_Appended by `timeline-progress`. Phase is one of: dev, qa-fix, prod-fix._

| # | Date | Phase | What was done | Files changed |
|---|------|-------|---------------|---------------|

## Releases

_Appended by `timeline-release`. "Covers entries" scopes each release note._

| Release | Target | Date | Covers entries |
|---------|--------|------|----------------|

## Changes Made

_File edits, migrations, config changes._

## Blockers

_None._
```

The numbered `#` column is what makes incremental release notes possible: each release records the last work-log entry it covered, so the next release note describes only what came after it. Never renumber existing rows.

## analysis.md

```markdown
# Analysis - Task {task-id}: {Title}

**Analyzed:** {today YYYY-MM-DD}

---

## Impact Analysis

### Backend - Controllers
{Controllers needing new actions or modification. Include paths and route notes.}

### Backend - Services / Repositories
{Shared services and repositories affected.}

### Backend - Entities
{Entities read or written. Note new fields/entities if likely.}

### Frontend - JS
{JS entry files needing logic.}

### Frontend - Templates
{Twig templates affected.}

### Routes
{New or changed routes, with expose flag needs.}

### Translations
{Likely translation keys.}

---

## DB Change Analysis

### New Tables
{Likely tables, schema sketch, nullable/FK notes, or None.}

### Column Additions
{Likely columns, types, or None.}

### Migrations
{Expected migration count/location, or None.}

### Index / Constraint Changes
{Indexes, unique constraints, FKs, or None.}

---

## Time Analysis

_Not estimated. Run `timeline-estimate {task-id}` to fill this in._

### Risk Factors
{Estimate risks.}

### Dependencies
{Dependencies or None.}

---

## Legacy Reference

{Matching legacy paths, or "No direct legacy equivalent found - implement from description only."}

---

## Recommended Implementation Order

1. {step}
2. {step}
3. {step}

_This order minimizes blocked work and allows incremental testing._
```

`timeline-progress` keeps this file current when scope changes during the task — it is a living document, not a snapshot.

## Output

After writing files, print:

```text
Task {task-id} registered -> timeline/{task-id}/

FILES CREATED:
  timeline/{task-id}/task.md
  timeline/{task-id}/analysis.md
  timeline/{task-id}/progress.md

IMPACT ANALYSIS
{summary from analysis.md}

DB CHANGE ANALYSIS
{summary from analysis.md}

TIME ESTIMATE
{summary from analysis.md}

OPEN QUESTIONS
{from task.md}

NEXT: timeline-progress {task-id}
```

## Constraints

- Do not implement code.
- Do not create `release-note.md` or `qa-plan.md`.
- Do not overwrite an existing timeline folder.
- Do not invent acceptance criteria the description does not support — mark derived ones `[inferred]`.
- Do not declare a schema change "new" without checking the live DB via `db-access`.
