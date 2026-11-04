---
name: timeline-progress
description: "Drive and track work on an existing Duell Admin timeline task, in every phase — initial development, fixes after a QA release, and bug fixes after a production release. Decides the next step, dispatches the actual work to the right specialist skill, appends phase-tagged entries to timeline/{task-id}/progress.md, and keeps task.md status and analysis.md current. Also reports read-only status: progress so far, acceptance criteria coverage, DB status, remaining work, blockers, and release readiness. Use for continuing work on a task, logging what was done, asking what is left, or checking whether a task is ready to ship."
argument-hint: <work|status> <task-id>
---

# Timeline Progress

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: timeline-progress`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Phase 2 of the timeline lifecycle: `timeline-intake` -> **`timeline-progress`** (repeats) -> `timeline-release` (repeats).

This skill runs many times per task, in three phases:

| Phase tag | When | Typical trigger |
|-----------|------|-----------------|
| `dev` | before the first release | normal implementation |
| `qa-fix` | after a release to QA | QA found something |
| `prod-fix` | after a release to prod | live bug on a shipped task |

It is the **only** owner of `progress.md` work-log rows, `task.md` Status, and post-intake edits to `analysis.md`.

## Modes

Take the mode from the first argument; infer it from the request when absent.

- **work** — continue the task: pick the next step, dispatch it, log it.
- **status** — read-only report: what is done, what is left, is it releasable.

Ask for a task ID when missing.

## Read First

```text
timeline/{task-id}/task.md
timeline/{task-id}/analysis.md
timeline/{task-id}/progress.md
timeline/{task-id}/release-note.md   # only if it exists
```

If `timeline/{task-id}/analysis.md` does not exist, intake has not run (no folder, or only a fetched `task.md`). Stop and say:

```text
No intake for task {task-id} yet. Run timeline-intake {task-id} first.
```

Determine the current phase from the `## Releases` table in `progress.md`: no releases yet -> `dev`; last release target `qa` -> `qa-fix`; last release target `prod` or `hotfix` -> `prod-fix`.

A task can reach QA or production without `timeline-release` (released through the team's PRs). So when the table has no rows, check the stages with the timeline MCP's `get_task_statuses`: Live started -> `prod-fix`; otherwise Testing or QA started -> `qa-fix`; otherwise `dev`. A phase the user names wins over both.

## Work Mode

### 1. Pick the next step

Take it from `analysis.md`'s Recommended Implementation Order, minus what `progress.md` already records, unless the user named a specific step. In `qa-fix` / `prod-fix` phase the step comes from the reported defect instead — the implementation order is already spent.

State the chosen step in one line before starting.

### 2. Dispatch the work

This skill does bookkeeping and routing, not implementation technique. Hand the actual edit to the skill that owns it:

| Work | Skill |
|------|-------|
| Module upgrade, UI upgrade, upgrade-bug fix | `upgrade-implementation` |
| Legacy parity comparison, AngularJS->jQuery, Symfony 8 / PHP 8.5 modernization | `legacy-migration-modernization` |
| Known error at a specific `file:line` | `hotfix` |
| Failure found in the Symfony/PHP error log | `fix-error` |
| Missing or hardcoded user-facing text | `add-module-translations` |
| Tenant context / cross-tenant risk | `tenant-context-guard` |
| Oversized controller needs splitting first | `split-oversized-controller` |
| Live schema, tenant DB name, did a migration land | `db-access` |
| Code review of what was just written | `upgrade-verification` |
| Confirm it works in the running app | `verify-in-app` |
| Branch, commit, push, PR | `ship-task` |

Small, self-contained changes that no specialist covers can be made directly. Do not restate a specialist's checklist here — invoke it.

### 3. Log it

Append one row per meaningful unit of work to the `## Work Log` table, continuing the existing numbering. Never renumber existing rows: `timeline-release` scopes each release note by entry number, so renumbering silently corrupts every past release note's range.

```markdown
| 8 | 2026-08-25 | qa-fix | Fixed thousands separator on sales total column | backoffice/assets/js/sales-report.js |
```

Also update, in the same pass:

- `## Changes Made` — migrations, config changes, new files.
- `## Blockers` — add when blocked, remove when cleared.
- `analysis.md` — when the real work diverged from the planned impact, DB change, or implementation order. Note the correction rather than rewriting history.
- `task.md` Status — see below.

### 4. Status transitions

Advance `task.md` Status only on evidence:

| To | When |
|----|------|
| `In Progress` | first work-log row exists |
| `Ready for QA` | every acceptance criterion has covering work logged and validation passed |
| `In QA` | set by `timeline-release` on a `qa` release |
| `Ready for Prod` | QA fixes logged and re-validated |
| `Live` | set by `timeline-release` on a `prod` release |
| `Reopened` | a prod bug is being worked; return to `Ready for Prod` when fixed |

Never set `Ready for QA` or `Ready for Prod` while acceptance coverage is partial or validation did not run — report the gap instead.

### 5. Validate

Run the smallest reliable validation set for the touched surface and record the result in the work-log row or `## Changes Made`:

- `php8.5 -l` on touched PHP files
- Twig lint on touched templates
- JS build for touched entries
- FOS route dump + rebuild when exposed routes changed
- XML parse for touched XLIFF files

If validation could not run, say exactly why and treat the work as unverified.

### Work Output

```text
TASK {task-id} - {Title}   [phase: dev|qa-fix|prod-fix]

STEP TAKEN
{what was done, and which skill did it}

LOGGED
- progress.md entry #{n}
- task.md Status: {old} -> {new}   (or "unchanged")
- analysis.md: {what was corrected, or "unchanged"}

VALIDATION
- {check}: passed/failed/not run

NEXT
{next step from implementation order, or "ready for timeline-release {task-id} qa"}
```

## Status Mode

Read-only. Do not edit any file. Do not search the codebase for new work; read-only `git log` / `git status` / `git diff` are allowed to verify or contradict what `progress.md` claims.

Derive:

- Status and title from `task.md`.
- Acceptance criteria coverage from explicit `progress.md` evidence.
- DB status from `analysis.md` expectations cross-checked against `progress.md`. A migration file existing in `cron/migrations/` is not evidence it ran — confirm against the live DB with `db-access` and report per-tenant status, since tenants migrate at different times.
- Work done from the work log; remaining work from implementation order minus logged entries.
- Time estimate from `analysis.md`; consumed time only from explicit time entries.
- Blockers from `progress.md`, risk factors from `analysis.md`, open questions from `task.md`.
- Release history from the `## Releases` table.
- Validation evidence: PHP syntax, Twig lint, JS build, route dump, manual QA, AJAX checks.

Work that exists in the worktree but not in `progress.md` is **unlogged**, not done — report it as unlogged and recommend a `work` pass to record it.

### Status Output

```text
STATUS - Task {task-id}: {Title}
Date: {today YYYY-MM-DD}

STATUS: {task status}   [phase: dev|qa-fix|prod-fix]

RELEASE READINESS
- Ready for QA / Ready for Prod / Not ready / Blocked
- Reason: {short justification}

ACCEPTANCE COVERAGE
- [DONE/PARTIAL/PENDING/UNCLEAR] {criterion} - evidence from progress/code

WORK DONE
#{n} {date} [{phase}] - {what was done} ({files changed})

REMAINING WORK
{pending implementation or QA item, or None}

DATABASE STATUS
New tables:          {none/created/pending/unclear}
Columns:             {none/altered/pending/unclear}
Migrations:          {none/created/ran/pending/unclear}
Indexes/constraints: {none/applied/pending/unclear}

VALIDATION STATUS
- {check}: passed/failed/not run/unknown

RELEASES SO FAR
- Release {n} ({target}) {date} - entries {a}-{b}

UNLOGGED / SUSPECTED / UNVERIFIED
- {item} - why it is uncertain and how to verify it

TIME
Estimate: {X}h   Consumed: {Y}h / Unknown   Remaining: ~{Z}h

BLOCKERS
{blockers or None}

OPEN QUESTIONS
{open questions or None}
```

Include only the sections that have content, except STATUS, RELEASE READINESS, and ACCEPTANCE COVERAGE, which are always present.

## Constraints

- Never invent work that is not in `progress.md`; treat all acceptance criteria as pending when the work log is empty.
- Never renumber work-log entries.
- Never mark a task ready on confidence alone — require logged evidence and validation.
- In status mode, do not edit files.
- Do not write `release-note.md` or `qa-plan.md`; that is `timeline-release`.
- Do not run destructive git commands, and keep unrelated dirty worktree changes out of the report unless they affect the task.
- Do not assert schema facts read from entity files as if they came from the database.
