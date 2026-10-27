---
name: upgrade-verification
description: Code review and contract audit for Duell Admin modules — upgraded or existing. Use when Claude is asked to review an upgraded module, inspect current diffs, find parity regressions, audit AJAX calls, CommonTable/Select2 endpoints, route exposure, request payloads, CSRF tokens, or response shapes (any module, not only upgrades), identify missing validation, or list suspected/incomplete/unverified work in code. For a manual QA plan use `timeline-release`; for task status and acceptance coverage use `timeline-progress`.
argument-hint: <task-id | module | diff | route/AJAX call>
context: fork
agent: readonly-auditor
user-invocable: true
disable-model-invocation: true
---

# Upgrade Verification

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: upgrade-verification`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Use this skill after or during implementation to review code or audit frontend/backend contracts. Default to review/audit mode and do not edit files unless the user explicitly asks for fixes.

This skill reviews **code**. It does not produce manual QA plans (`timeline-release`) or report task progress and acceptance coverage (`timeline-progress`) — when a review turns up something those own, name it in the findings and let the owning skill record it.

## Inputs

Accept any of these:

- Task ID with `timeline/{task-id}/` files.
- Module name.
- File list.
- Current git diff.
- Specific route, AJAX call, or observed frontend/backend mismatch.

If a task ID exists, read `timeline/{task-id}/task.md`, `analysis.md`, and `progress.md` first. Use them to identify expected acceptance criteria, intended files, DB constraints, progress, and remaining risks. Report against them — do not edit them.

## Modes

Choose the mode from the user request:

- **Review**: code review of an upgraded module or diff.
- **AJAX contract audit**: compare JS/Twig callers to Symfony routes/controllers and response contracts.

Both modes can run together when the user asks broadly for verification.

## Review Mode

Take a code-review stance. Findings first, ordered by severity, with file/line references.

Inspect only the module/diff unless the code path requires nearby context. Use `git diff`, `git status`, `rg`, and direct file reads.

Check:

- Legacy parity: route names, payloads, response keys, Twig variables, DOM IDs, modal IDs, repository result shapes, sort/pagination behavior.
- Numeric/currency rendering parity: legacy AngularJS applied `| number:0` / `| currency` filters (locale group separator) implicitly to nearly every numeric cell. Check that migrated cell renderers reproduce this (e.g. `formatNumber()`/`Intl.NumberFormat`) rather than raw `escapeHtml(value)` — a plausible-looking value that renders without a thousands separator on values ≥1000 is a parity regression, not a style nit.
- Symfony 8/PHP 8.5: attributes, typed actions, no `$this->getRequest()`, no casual `$this->container`, no bundle template notation, no string repository aliases in touched code.
- Tenant safety: client DB work only after tenant context, no accidental admin/client EM mixing.
- Security: CSRF on writes, permission checks, escaping/sanitization, guarded uploads/deletes.
- Frontend migration: no AngularJS directives/controllers revived, delegated jQuery events, Bootstrap 5 modal helpers.
- Angular residue: touched templates have no leftover dead AngularJS directive attributes from the original port (`ng-model`, `ng-show`/`ng-if`, `ng-repeat`, `ng-click`, `show-errors`, etc.) — these are inert with no Angular runtime present and should be stripped, not just left uncalled.
- UI standard: upgraded listing/report patterns, filters, lazy dropdowns, datepickers, confirmations, `CommonTable` where applicable.
- Accessibility: every `<label>` paired with an input/select has a `for` matching that control's `id` (or wraps it); informative `<img>`/icon-only buttons have `alt`/`aria-label`; custom toggles/modals expose `role`/`aria-*` consistent with existing patterns in the touched template.
- Routes: `Routing.generate()`, exposed JS routes, FOS route dump need.
- Translations: no new hardcoded user-facing strings where translations are expected.
- Automated rules (Sentinel): run `tools/sentinel/bin/sentinel rules --diff=development` (or `--paths=<files>`) to automatically flag legacy entity aliases, EM mismatches, CSRF omissions, raw Twig output, SQL concatenation, or route drift.
- AJAX contracts: method, payload keys, CSRF, response keys, table/dropdown expectations, error handling.
- Validation: syntax checks/build/lints/manual QA present or explicitly missing.


### Severity

- Critical: data leak, tenant boundary risk, destructive operation without permission/CSRF, broken route/API contract blocking primary flow.
- High: legacy parity regression, missing route exposure for used JS route, broken lazy dropdown/table contract, invalid PHP/JS/Twig.
- Medium: incomplete UI behavior, missing translation, weak error handling, missing validation, accessibility gaps (missing label association, alt text, aria attributes).
- Low: maintainability issue or minor inconsistency that does not affect behavior.

### Review Output

```text
REVIEW - {module/task/diff}

FINDINGS
[{severity}] {file:line} - {problem}. Expected: {expected behavior}. Fix: {specific correction}.

SUSPECTED / INCOMPLETE / UNVERIFIED
- {item} - why it is uncertain, what evidence is missing, and how to verify it.

VALIDATION REVIEWED
- {command/check}: {passed/failed/not run/unknown}

SUMMARY
- {brief note on overall readiness}
```

If there are no findings, say so clearly, then still list validation gaps and residual risk.

## AJAX Contract Audit Mode

Compare JavaScript/Twig callers against Symfony controller actions and repository/service response contracts. This mode can be invoked standalone for any module — a suspected frontend/backend mismatch does not need to be upgrade-related.

### Discovery

1. Search JS/Twig for `$.ajax`, `fetch`, `Routing.generate`, `CommonTable`, `applySelect2WithAjax`, form submissions, and export/download calls.
2. Map generated routes to Symfony controller actions.
3. Read controller actions and any repository/service methods shaping responses.
4. Check route methods and `options: [expose => true]` when used by JS.
5. Check generated FOS route artifacts when route exposure changed.

### Contract Matrix Fields

For each contract capture:

- Caller file and function/event.
- Route name and URL parameters.
- HTTP method.
- Payload format and keys.
- CSRF token source/key for writes.
- Controller request parsing method.
- Success and error response shapes.
- Frontend success/error handling.
- `CommonTable`: `dataKey`, pagination keys, totals, primary key.
- Select2: `items`, `total_count`, `id`, `text`, `page`, `length`, `search[value]`, optional `id` hydration.
- Exports: `Blob`, headers, filename, JSON error blob handling.

### Common Findings

- JS method differs from route method.
- JS sends JSON but controller reads form data.
- Controller response shape does not match `CommonTable` or Select2 expectations.
- Missing CSRF on write endpoint.
- Missing route exposure for `Routing.generate()`.
- Hardcoded URL.
- HTML/plain-text error response where JSON is expected.
- Blob download does not handle JSON error blobs.
- Pagination/search/sort/filter keys changed unexpectedly.
- Tenant/client DB endpoint can run before tenant context exists.

### AJAX Output

```text
AJAX CONTRACT AUDIT - {module/task}

CONTRACTS CHECKED
| Caller | Route | Method | Payload | Expected Response | Status |
|--------|-------|--------|---------|-------------------|--------|
| {file:function} | {route} | {GET/POST} | {keys} | {shape} | PASS/FAIL/SUSPECT |

FINDINGS
[{severity}] {file:line} / {controller:line} - {contract mismatch}. Fix: {specific correction}.

SUSPECTED / INCOMPLETE / UNVERIFIED
- {contract} - why it is uncertain and what must be checked or run.

ROUTE / FOS JS STATUS
- {route}: exposed/not exposed/unknown; route dump needed yes/no/unknown.

VALIDATION SUGGESTIONS
- {exact manual or command check}
```

## Constraints

- Do not modify files unless explicitly asked for fixes.
- Do not invent legacy behavior or response shapes; read code or mark unknown.
- Do not assert anything about database schema or data from entity files alone. To verify a column, index, migration, or tenant-boundary claim against the live DB, use the `db-access` skill — it owns DB credentials and the tenant→DB registry, and is read-only by default, which suits this skill's audit stance. State which DB and tenant each finding came from; if the DB was unreachable, mark the item unverified rather than inferring.
- Treat missing validation as unverified, not passed.
- Treat write endpoints without visible CSRF as at least High severity unless an explicit exception exists.
- Prefer concise, actionable findings over broad commentary.
