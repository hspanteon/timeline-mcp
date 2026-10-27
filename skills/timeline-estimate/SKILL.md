---
name: timeline-estimate
description: Produce a client-facing effort estimate for ANY feature, bug, refactor, or integration — grounded by first checking BOTH the legacy project (../duell-pos) and the new project (duell-admin), but reported as short non-technical points with hours, a total, and a manual vs AI-assisted summary. Use when Claude is asked how long something will take, to size or quote work, for story points, or for an estimate on a timeline task — with or without a task ID.
argument-hint: <task-id | feature/bug/refactor to estimate>
---

# Timeline Estimate

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: timeline-estimate`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Produce a **grounded** estimate for any requested work — a feature, bug fix, refactor, API endpoint, cron job, integration, or migration. Never guess from the description alone — first inspect the real code in **both** projects, then estimate. Always give **manual** and **AI-assisted** numbers.

**The estimate is written for a client, not for a developer.** The research below is how you get the numbers right; it is *not* what you print. The reply contains only the estimate points, the total, and the manual vs AI summary — nothing else. Every inventory, table, file name, class name and technical justification stays in your head.

This skill is **work-type-agnostic**. The method is the same for every task; only *which layers you inventory* changes. Step 0 picks the relevant layers so you don't force every estimate into a "listing page" shape.

## Inputs
- A description of the work (feature / bug / refactor / integration / chore).
- Optionally: a Figma link, ticket number, target fields/columns/endpoints, repro steps.

## Precondition — confirm the target before doing anything (HARD GATE)
Do **not** start an estimate until the user has named the work to estimate.

- If the skill is invoked with **no task** (no arguments, no described work item), **STOP and ask** what to estimate. Do not begin inventorying code.
- If the candidate **already contains an estimate**, point that out and ask whether they want it re-validated or want something else — don't silently re-derive existing numbers.
- Only proceed past this gate once the user explicitly confirms a concrete work item.

### Timeline tasks

This skill takes either a **task ID** or a plain description of work — estimating before a ticket exists is a supported case, and needs no timeline folder.

When a **task ID** is given:

1. If `timeline/{task-id}/analysis.md` does not exist (no folder, or only a fetched `task.md`), run the `timeline-intake` skill for it **first**, then estimate. Its `analysis.md` is the inventory starting point — do not re-derive the impact analysis it already produced.
2. If `analysis.md` exists, read `task.md` and `analysis.md` before inventorying. Take the deliverables from the acceptance criteria and the touched surface from the impact analysis, then verify both against real code rather than trusting the analysis outright.
3. Never call `timeline-intake` a second time in one run, and never call it when `analysis.md` already exists — intake refuses to overwrite an in-flight task anyway.

Report the estimate in the response. To record it in the task, write the result into `analysis.md`'s Time Analysis section, replacing whatever placeholder rows are there.

## Method (follow in order)

### 0. Classify the work type
Decide what kind of change this is — it drives which layers matter. Common types:
- **Listing / table page** — controller list action, repo `getXList()`, twig table, JS `CommonTable`, filters, export.
- **Form / CRUD page** — create/edit controller actions, entity + repository writes, validation, twig form, JS submit.
- **API endpoint** — `api/` controller, request/response shape, serialization, auth.
- **Cron / console command** — `cron/` command, scheduling, read-replica EM, batching.
- **Integration / webhook** — external service client, handler, retry/error handling, config.
- **Bug fix** — locate the defect, blast radius, regression risk (often small code, real QA cost).
- **Refactor / Symfony 8 modernization** — touched surface, callers, behavior-preservation risk.
- **Data / migration / entity change** — Doctrine migration, multi-tenant impact (admin vs client DB).

Pick the 1–3 types that apply and only inventory those layers below. Note which deliverables are backend, frontend, data, or human-bound (QA/judgment) — this matters for the AI-speedup split in step 5.

### 1. Frame the spec (internal)
List the concrete deliverables for yourself, scoped to the work type — this is the raw material for step 5's points, never printed as a checklist. Examples of what belongs depending on type: routes + `methods:`, columns/fields, filters, validation rules, permissions/guards, actions (export/download/print), pagination/sort, request/response shape, scheduling, error/retry behavior, migration + tenant scope, edge cases. List the explicit unknowns (design fidelity, query changes, external API behavior) — these become risk buffers.

### 2. Inventory the NEW project (duell-admin) — what already exists
Use Grep/Glob/Read directly; for broad sweeps across unknown naming, delegate to the Explore agent.
- Grep for the relevant controller, command, service, repo, and route names.
- For bugs and refactors, grep all callers/usages of the touched symbols to gauge blast radius.
- Check whatever layers the work type needs:
  - **Backend**: controller/command action exists? routes declare `methods:`? service present?
  - **Data**: does `shared/src/Repository/...` already have the method (e.g. `getXList()`, a write, a query) with the required filters/sort/pagination/joins?
  - **Entity/migration**: do the `shared/src/Entity/...` fields already exist? admin vs client DB? Where the estimate turns on whether a column/index/table is already there, confirm against the live DB with the `db-access` skill instead of trusting the entity — it owns credentials and tenant DB lookup. A field that exists in code but not yet on every tenant is migration work you would otherwise estimate as zero.
  - **Frontend**: `templates/<Area>/` template, `assets/js/` entry, `webpack.config.js` registration.
  - **Nav/permissions**: `templates/topNavHeader.html.twig` menu link + permission gate; existing `#[IsGranted('ROLE_...')]` guards (especially for unauthorized-access bugs).

Track internally what is **exists / partial / missing** so you can subtract the work that is already done. Check only the layers the work type needs. Never print this inventory — it exists to make the hours right, not to be shown.

### 3. Inventory the LEGACY project (../duell-pos) — the reference to port
Only when the work has a legacy counterpart (most migrations and feature ports do; brand-new features and infra chores may not). Use the bundle→new mapping in `CLAUDE.md`:
- Legacy controller/command (`src/*Bundle/...`), its action and result shape.
- Legacy repository query (`src/*Bundle/Repository/` or entity repo) — query semantics AND result formatting (controllers often depend on specific array keys).
- For UI work: legacy AngularJS controller (`Resources/public/js/controller/*.controller.js`) and view (`Resources/views/`) — **measure line counts** (`wc -l`) as a porting-effort proxy.
Note: legacy is the source of truth for business logic and payload shapes. If there is no legacy counterpart, say so explicitly and estimate as net-new.

### 4. Find the house-style reference (CRITICAL — "same style as others")
The estimate MUST account for matching existing conventions, not minimal code. Find the closest **already-migrated analog of the same work type** and measure its real size:
- **Listing page** → an analog list page (e.g. Invoice): `wc -l assets/js/<analog>.js templates/<Analog>/*.twig`.
- **Form/CRUD** → an analog edit page; note validation + submit patterns.
- **API endpoint** → an analog `api/` controller; note serialization + auth conventions.
- **Cron command** → an analog command in `cron/src/`; note EM/scheduling conventions.
- **Integration** → an analog service/handler; note retry/logging conventions.
- **Bug/refactor** → the surrounding code is its own reference; match local style.

Note the conventions the analog uses so the new work matches them, e.g.: class-level `#[IsGranted]`, `methods:` on routes, `CommonTable`, inline/advanced filter framework, select2, sessionStorage, FOS route dump, `Routing.generate()` / `Translator.trans()` / `Loader`, constructor injection, typed signatures. **The new work will be roughly the analog's size — scope to that, not to a thin file.** This is the most common estimation error; do not skip it (even for bugs, check the blast radius of matching conventions).

### 5. Build the points (client language, 5–15 words each)
Turn the deliverables into **short plain-language points**, one line per point, each ending with the manual hours in square brackets: `<point> [Xh]`.

Hard rules for a point:
- **5 to 15 words.** Never longer. If a point needs more words, it is two points.
- **No technical detail.** No file, class, controller, repository, route, table, entity, framework or library names. No "Symfony", "Doctrine", "webpack", "CommonTable", "twig", "endpoint", "migration", "refactor". Say what the client gets, not how it is coded.
- **One deliverable per point**, described as visible work: a screen, a field, a filter, an export, a fix, a check.
- Group invisible plumbing into the point it serves, rather than listing it separately.
- Keep testing/QA as its own point when it is real effort.

Good: `Invoice list screen with search, filters and sorting [16h]`
Good: `Export the filtered invoice list to CSV [6h]`
Good: `Testing and fixes across customer accounts [8h]`
Bad:  `Add getInvoiceList() to InvoiceRepository with joins and pagination [10h]`
Bad:  `Register the webpack entry and dump FOS routes [2h]`

The bracketed hours are **manual** hours. Work out story points and AI-assisted hours per point as well, but report those only in the summary.

Conversions used by this repo:
- 1 SP ≈ 4–5 focused dev hours. 1 working day = 8 h.
- AI-assisted speedup applies to *mechanical/pattern-following* work (scaffolding a screen, porting the front-end, boilerplate, repetitive query edits) → ~2.5–3×.
- AI-assisted gives little/no speedup to *human-bound* work (manual QA on a tenant, design-vs-implementation judgment, verifying data is correct, reproducing a flaky bug, external-API trial-and-error) → ~1.2×.
- Reuse: subtract work already present in the new project (don't estimate what exists).

### 6. Risks & buffers (internal — feeds one summary line)
Decide the 2–3 things that can stretch the work (a query needing a new join, design divergence, an undocumented external API, a change that has to reach every customer account, a wide blast radius). Turn them into a buffer in hours. **Do not print the risk list, the reasoning, or the excluded scope** — they only feed the "with risk buffers" line of the summary.

### 7. Output format (this is the whole output — print nothing else)

```markdown
## Estimate

Invoice list screen with search, filters and sorting [16h]
Export the filtered invoice list to CSV [6h]
Show paid and unpaid status on each row [4h]
Testing and fixes across customer accounts [8h]

Total: ~34h

## Manual vs AI summary

- Manual: ~34h (~4 working days, ~8 SP)
- AI-assisted: ~15h (~2 working days)
- With risk buffers: manual ~42h (~5 days), AI ~19h (~2.5 days)
```

## Rules
- **Never estimate a task the user didn't ask for.** If no work item was given, STOP and ask (see Precondition gate). Do not infer the target from `git status`, untracked/edited files, open docs, or "the obvious thing in the repo." A found candidate is a suggestion to confirm, never an assumed target.
- **Always inspect real code in both projects before quoting a number.** No blind estimates. The research is internal; only the points, the total and the summary are printed.
- **Classify the work type first** and inventory only the layers that apply.
- **Always subtract what already exists** — half the effort is often already ported.
- **Always include the house-style check** (step 4) for the matching analog type — it's the #1 thing that moves the hours, even though it is never printed.
- **Every point is 5–15 words of plain client language** with `[Xh]` manual hours at the end. No technical names, no tables, no sub-bullets, no explanations under a point.
- **The output is only** the `## Estimate` points, `Total:`, and the `## Manual vs AI summary` three lines. Anything else — inventories, tables, risks, first steps, caveats — is wasted output and must not be generated.
- The bracketed hours must sum to the total, and the total must match the manual summary line.
- Never modify code while estimating. The only files this skill may write are `timeline/{task-id}/*` — the docs `timeline-intake` creates, plus the Time Analysis section of `analysis.md`, which takes the same points-and-summary text.

