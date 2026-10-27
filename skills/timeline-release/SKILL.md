---
name: timeline-release
description: Ship a Duell Admin timeline task at a release boundary — to QA, to production, or as a hotfix — and produce the release paperwork. Appends a scoped section to timeline/{task-id}/release-note.md covering only the work since the previous release, with brief and detailed notes, DB changes, routes, translations, an impact checklist, and deferred items; and generates timeline/{task-id}/qa-plan.md, a Markdown manual QA checklist a tester works through and commits back. Use when Claude is asked for a release note, to release/ship a task to QA or prod, for a QA plan or manual test document, or for delivered/deferred work at handover. Runs once per release, so a task usually hits it several times.
argument-hint: <qa|prod|hotfix> <task-id>
---

# Timeline Release

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: timeline-release`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Phase 3 of the timeline lifecycle: `timeline-intake` -> `timeline-progress` (repeats) -> **`timeline-release`** (repeats).

This skill runs once per release boundary. A typical task hits it at least twice — release to QA, then release to prod — and again after each post-release fix. Each run documents **only what is new since the previous release**.

## Targets

Take the target from the first argument; infer it when absent.

| Target | Meaning | Produces | Sets task.md Status |
|--------|---------|----------|---------------------|
| `qa` | first delivery to testers | release-note section + `qa-plan.md` | `In QA` |
| `prod` | delivery to production | release-note section | `Live` |
| `hotfix` | production fix on an already-live task | release-note section | `Live` |

A QA plan can also be requested on its own, for any target or for a module/diff with no task at all — see [QA Plan](#qa-plan).

Ask for a task ID when missing.

## Read First

```text
timeline/{task-id}/task.md
timeline/{task-id}/analysis.md
timeline/{task-id}/progress.md
timeline/{task-id}/release-note.md   # if it exists
```

If the folder does not exist, stop and say:

```text
No timeline folder found for task {task-id}. Run timeline-intake {task-id} first.
```

### Scope this release

Read the `## Releases` table in `progress.md`:

- **No rows** — this is Release 1. It covers work-log entries 1 through the last.
- **Rows present** — take the highest `Covers entries` end value `N`. This release is Release `{last+1}` and covers entries `N+1` through the last.

If there are no new work-log entries since the last release, stop and say so — there is nothing to release. Recommend a `timeline-progress work` pass if the worktree has unlogged changes.

Derive the release content from those entries only:

- Done items from the scoped `progress.md` rows.
- DB changes actually made from the scoped rows and `## Changes Made`.
- Files changed from the scoped rows.
- Deferred items from `analysis.md` still absent from `progress.md`.
- Acceptance coverage by cross-referencing `task.md` against the whole work log, not just this release's slice — coverage is cumulative even when the note is incremental.

Do not search the codebase unless timeline files are too sparse and the user explicitly asks for deeper verification. For the impact checklist, `git status` / `git diff` on the task's changed files is allowed.

## Release Note

Append a new section at the **top** of `timeline/{task-id}/release-note.md`, newest first, creating the file with the `# Release Note - Task {task-id}: {Title}` heading if it does not exist. Never overwrite or rewrite an earlier release's section — earlier sections are the record of what already shipped.

### Impact Checklist

Before writing the section, explicitly check each item below against the scoped work. Base findings on `progress.md` / `analysis.md` first; if those are silent, check `git status` / `git diff` for the task's changed files rather than skipping the check. Report "None" only after checking — never invent a finding.

- **Fields added/removed**: any field/column added to or removed from an entity, form, DTO, or API/AJAX request or response payload.
- **Filters added/removed**: any filter added to or removed from a listing/report (CommonTable, search form, query params).
- **Indexing**: any DB index added in a migration (`addIndex`, `CREATE INDEX`, composite/unique index).
- **SQL performance**: any query rewritten or tuned (N+1 fix, added/removed JOIN, query builder change, raw SQL optimization, pagination fix).
- **Column picker**: any column shown, hidden, added, or removed in a CommonTable column-visibility picker.
- **Additional ticket requirements**: any requirement in `task.md` beyond the core ask worth calling out (edge case, validation rule, permission change, non-obvious acceptance criterion).
- **Module impact**: any other module or page affected (shared service, repository used elsewhere, event subscriber, cross-module entity).
- **Functional impact**: any behavior change to existing functionality (default values, validation, permission checks, calculation logic).

### Section Format

```markdown
## Release {n} — {qa|prod|hotfix} — {today YYYY-MM-DD}

**Covers:** progress entries {a}–{b}

### Brief Summary

- {one-line user-facing summary, past tense}
- {one-line user-facing summary, past tense}

### Detailed Notes

**Backend** — {controller/service/repository behavior changes and why.}

**Database** — {migration files, table/column changes, types, nullable/FK notes.}

**Frontend** — {visible UI changes, interactions, data shown.}

**Routes added** — {route_name -> HTTP method -> path -> purpose}

**Translations added** — {keys and EN values if known}

### Impact Checklist

- **Fields added/removed:** {field on entity/form/payload, or "None"}
- **Filters added/removed:** {filter on listing/report, or "None"}
- **Indexing:** {index added and why, or "None"}
- **SQL performance:** {query optimized and how, or "None"}
- **Column picker:** {column added/removed/shown, or "None"}
- **Additional ticket requirements:** {requirement worth highlighting, or "None"}
- **Module impact:** {other module/page affected, or "None"}
- **Functional impact:** {behavior change to existing functionality, or "None"}

### Known Limitations / Deferred

{Unconfirmed acceptance criteria or planned items not implemented, or "None."}

### Testing Notes

{Manual checks based on open questions and risk factors.}
```

### Record the release

After writing the section, append one row to the `## Releases` table in `progress.md` and update `task.md` Status per the target table above. This is the only file `timeline-release` writes outside `release-note.md` and `qa-plan.md`.

```markdown
| 2 | prod | 2026-08-25 | 8–14 |
```

Do not advance Status to `Live` while acceptance coverage is partial — release the note, and say plainly in the output that the task shipped with gaps.

## QA Plan

Generate `timeline/{task-id}/qa-plan.md` on a `qa` release, or whenever a QA plan is requested directly. It is a plain Markdown checklist a tester works through and commits back, so results land in the task record and diff in git rather than living in one person's browser.

This is documentation generation, not browser testing — it does not launch the app (use `verify-in-app` for that).

With no task ID, build the plan from `git diff` / `git status` for a named module or diff instead, write it wherever the user asks, and skip the Acceptance coverage section.

### Step 1 — Scenario checklist

This skill is the single owner of the manual QA scenario list. **Enumerate every applicable point — do not reduce it to a fixed CRUD skeleton.** Derive one or more concrete scenarios per acceptance criterion and per changed behavior.

- Page load and permission access.
- Listing render, empty state, loading state, pagination, sorting, search, row actions.
- `CommonTable`: visible columns, column picker, footer totals, selected rows, URL/cookie state.
- Top filter bar, More/Less filters, promoted active filters, clearing, URL/sessionStorage state.
- Lazy Select2: selected value hydration, search, pagination, clear, dependent filters, modal dropdown parent.
- Datepickers/date ranges: defaults, quick ranges, invalid/future dates, persistence, backend format.
- Create/edit/delete and module-specific actions.
- Toggle/setting behavior: each setting ON and OFF, dependent/conditional settings, persistence after save, and any exclusion rules (e.g. skip when no payment or paid by invoice).
- Confirmation dialogs: message, cancel, confirm, CSRF, success/error, token refresh.
- Export/download flows: PDF/Excel/accounting formats, selected rows, row limits, blob errors.
- Tenant boundaries and department/client-specific data.
- Translations and language-sensitive text.
- Legacy parity and regression checks.
- Numeric formatting at real scale: check at least one displayed number >=1000 (qty, sales, currency, totals) for the correct thousands separator — test data under 1000 will never expose a missing-separator regression.
- Negative/error cases.
- Responsive checks when UI was touched.

Every acceptance criterion in `task.md` must appear in the Acceptance coverage table — none omitted. If one is untestable from available info, mark it `unclear` with the reason instead of dropping it.

Group scenarios into sections matching the feature areas actually touched (e.g. "General settings tab", "Logistics settings tab") — not a generic "Misc" bucket unless nothing else fits.

Steps must be concrete numbered actions and Expected must be concrete observable results. Neither may restate the scenario name.

### Step 2 — Write the plan

```markdown
# QA Plan - Task {task-id}: {Title}

**Generated:** {today YYYY-MM-DD}
**Scenarios:** {N}  |  **Acceptance criteria:** {M}  |  **Regression checks:** {R}

Mark each scenario as you test it: `[x]` pass, `[!]` fail, `[~]` blocked, `[ ]` not tested.
Put what you actually saw on the **Result** line — especially for `[!]` and `[~]`.

## Scope

| | |
|---|---|
| Module / page | {module} |
| Files changed | {files} |
| DB changes | {changes, or None} |

## Preconditions

| | |
|---|---|
| Role / permissions | {role} |
| Tenant / client | {real tenant + DB name, confirmed via db-access} |
| Data setup | {what must exist} |
| Feature flags / modules | {flags, or None} |
| Browser | {assumptions} |

## Test scenarios

### {Category name}

- [ ] **1. {Scenario name}**
  - **Steps:** 1. {action}  2. {action}
  - **Expected:** {observable result}
  - **Result:**

- [ ] **2. {Scenario name}**
  - **Steps:** 1. {action}
  - **Expected:** {observable result}
  - **Result:**

## Regression checks

| Flow to re-check | Why it is at risk | Where |
|---|---|---|
| {legacy or related flow} | {reason} | `{file:line}` |

## Acceptance coverage

| Criterion | Status | Verified by |
|---|---|---|
| {criterion from task.md} | covered / pending / unclear | {scenario number(s)} |

## Suspected / incomplete / unverified

- **{area}** — {why it is uncertain, and what data or access is needed to confirm it}

## Worth automating

- **{check}** — {why}, or "None"
```

Number scenarios continuously across sections, starting at 1. Include only the sections that have content, except Scope, Test scenarios, and Acceptance coverage, which are always present.

### Step 3 — Verify before reporting

1. Scenario numbers are unique and continuous, and the header's Scenarios count matches the actual number of `- [ ]` scenario items.
2. Acceptance coverage has one row per criterion in `task.md` — none missing.
3. Every scenario has non-empty Steps and Expected.
4. The "Verified by" column references scenario numbers that exist.

**Regenerating for the same task:** read the existing `qa-plan.md` first. Keep existing scenario numbers stable, append new scenarios with the next free number, and carry over every checkbox mark and Result line the tester already filled in. Never hand a tester a plan that silently discarded their results.

## Output

```text
RELEASE {n} ({target}) - Task {task-id}: {Title}
Covers: progress entries {a}-{b}

WRITTEN
- timeline/{task-id}/release-note.md  (section prepended)
- timeline/{task-id}/qa-plan.md       (qa target only: {N} scenarios in {M} sections)
- progress.md Releases row, task.md Status: {old} -> {new}

SHIPPED IN THIS RELEASE
- {brief summary line}

ACCEPTANCE COVERAGE (cumulative)
- covered {x} / pending {y} / unclear {z}

DEFERRED
- {item, or None}

GAPS
- {criteria with no concrete scenario, thin areas and why, or None}
```

## Constraints

- Never overwrite or rewrite an earlier release section; always prepend a new one.
- Never invent work that is not in `progress.md`; if progress is sparse, say so honestly.
- Never invent acceptance criteria, scenarios, or legacy behavior — mark unknown/unclear instead.
- Do not invent the QA plan's tenant/data setup. Where a scenario needs specific data (a tenant with orders, a client with a given license), confirm it with `db-access` so the tester gets a real client/tenant, not a placeholder.
- Do not launch a browser or the app.
- Do not discard a tester's existing marks or Result lines when regenerating a QA plan.
- Do not renumber `progress.md` work-log entries or edit its work log — that belongs to `timeline-progress`.
- Do not run destructive git commands.
