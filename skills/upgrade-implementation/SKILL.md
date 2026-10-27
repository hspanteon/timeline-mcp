---
name: upgrade-implementation
description: Implement Duell Admin module upgrades, UI upgrades, and upgrade-bug fixes while preserving legacy parity. Reports what changed so `timeline-progress` can log it. Replaces upgrade-module, upgrade-bug, and upgrade-module-ui. Use when Claude is asked for /upgrade-bug, upgrade module, migrate module, modernize a feature, complete a whole module, apply upgraded UI, match current listing UX, restore lost upgrade behavior, or fix Angular-to-jQuery/Symfony upgrade regressions.
argument-hint: <task-id | bug-id | module-name>
---

# Upgrade Implementation

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: upgrade-implementation`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Implement module upgrades and upgrade-bug fixes end to end. Preserve behavior first, modernize second.

**Not this skill:**
- For porting legacy bundles from scratch, full AngularJS-to-jQuery rewrites, or Symfony 8 architecture modernization, use `legacy-migration-modernization`.
- For read-only code review, contract audits, and parity regression verification, use `upgrade-verification`.

## Intake


1. Read `CLAUDE.md`.
2. If a task ID or timeline is provided, read `timeline/{task-id}/task.md`, `analysis.md`, and `progress.md` first.
3. If the user asks to register or analyze a task before implementation, use the `timeline-intake` skill first and stop after analysis.
4. If the user invokes `/upgrade-bug`, extract bug ID, title, and description. If missing, ask before proceeding.
5. If no task ID exists and the user directly asks to upgrade/fix a module, proceed without forcing timeline creation.

When a timeline exists, `timeline-progress` owns `progress.md` and `task.md` Status — report what you changed in the handoff and let it record the entry, rather than writing the work log here. When this skill is invoked directly with no timeline task, there is nothing to log.

## Scope Inventory

Before editing, identify:

- Current controller(s), route names, methods, expose flags, permissions.
- Twig template(s), DOM IDs, modal IDs, form field names, data hooks.
- JS entry point(s), webpack entry, AJAX calls, CommonTable use, Select2/dropdowns, datepickers.
- Shared repositories/entities/services and DB boundary: admin vs client.
- Matching legacy files in `../duell-pos/src/` and `../duell-pos/web/js/` when available.
- Likely translation keys and route dump/build commands.

Do not edit until the module boundary and validation commands are known.

## Legacy Parity Map

Before implementation, document the compatibility surface that must remain stable:

- Route names, HTTP methods, expose flags, redirects, and JSON keys.
- Request payloads, query parameters, filters, pagination, sorting, totals, `isTotal` behavior.
- Twig variable names, field names, DOM IDs, modal IDs, `data-*` hooks, CSS hooks.
- Repository method names, argument order, result array keys, sort order, value normalization.
- Tenant/session dependencies: `clientId`, `departments`, locale, login employee, permissions.
- CSRF, authorization, sanitization, upload, export, and delete behavior.
- Locale-aware number/date/currency rendering: legacy AngularJS applied `| number:0` / `| currency` / `| date` filters implicitly on nearly every numeric cell via a globally-loaded locale (`angular-locale_nb-no.js`, thousands separator included). When a listing/report is rebuilt as `CommonTable` + custom cell renderers, this formatting has nothing to attach to unless it's explicitly ported per renderer — grep the legacy template for `| number` / `| currency` on every rendered value, not just the ones a written requirement calls out.

If legacy code is missing or contradictory, state the gap and preserve current new-code behavior unless the user explicitly requests a change.

## Upgrade Bug Mode

For `/upgrade-bug` or lost/broken upgrade behavior:

1. If `timeline/{bug-id}/analysis.md` doesn't exist and the user wants a timeline record, run `timeline-intake` for it first.
2. Search current code for the broken feature using 2-3 keywords.
3. Search legacy `../duell-pos` for the original flow.
4. Compare legacy and current behavior across route, controller, repository, response shape, frontend logic, template, and DB fields.
5. Mark each gap as `MISSING`, `COMMENTED`, `BROKEN`, or `PARTIAL`.
6. Write or update `analysis.md` with parity gap summary, legacy files, current files, fix plan, DB impact, risk, and recommended fix order.
7. Apply the minimal fix immediately unless the analysis reveals a risky DB migration or breaking contract needing user approval.
8. Hand the resolved gap to `timeline-progress` to log and to advance `task.md` Status.

Never restore AngularJS code; port behavior to jQuery/Bootstrap 5 patterns.

## Backend Implementation

When controllers, routes, request handling, security, or Twig rendering are touched:

- Follow Symfony 8 patterns: route/security attributes, typed `Request`/`Response`, imported classes.
- Use `getClientEntityManager()` for tenant DB work and `getAdminEntityManager()` for admin DB work.
- Keep route names, expose flags, permission checks, redirects, JSON keys, and Twig variables stable.
- Validate CSRF on write endpoints.
- Avoid service extraction unless it clearly reduces risk or duplication.
- Syntax-check touched PHP files before leaving backend work.

## Repository And Service Work

When shared queries or service contracts are touched:

- Compare matching legacy repository/service before changing logic.
- Preserve method names, argument order, result shape, pagination, sorting, totals, null handling, and boolean normalization.
- Keep admin and client DB concerns separated.
- Parameterize dynamic SQL and avoid user-controlled SQL concatenation.
- Add typing only when behavior and callers are clear.

## Frontend And UI Upgrade

When Twig/JS UI work is in scope, match the upgraded Duell Admin listing/report UX.

Reference nearby patterns before editing:

- `backoffice/templates/SalesReport/index.html.twig` and `backoffice/assets/js/sales-report.js`
- `backoffice/templates/Invoice/index.html.twig` and `backoffice/assets/js/invoice.js`
- `backoffice/templates/WarehouseReport/index.html.twig` and `backoffice/assets/js/warehouse-report.js`
- `backoffice/assets/js/report.js`
- `backoffice/assets/js/common.js`
- `backoffice/templates/common-modal.html.twig`

UI checklist:

- Use `bg-white content-outer`, `top-titlebar`, `topInput-filter-bar`, `body-part`, `body-part-inner datatable-card-style`, `datatable-buttons`, `datatable-wrap toolbar-absolute`, and pagination wrapper where applicable.
- Put primary search/filters in the top row and advanced filters in `topInput-filter-bar-bottom top-filters-hide`.
- Promote active advanced filters into an inline filters container when useful.
- Use Select2 for dropdowns; lazy AJAX Select2 for dynamic or large option lists.
- Use report-style daterangepicker for date ranges; keep backend date format explicit.
- Use `CommonTable` for upgraded listings and reports; do not keep raw DataTables/datatable.net wiring.
- Format numeric cells (qty/avg/sales/currency) with the established local `formatNumber(value)` pattern (`Intl.NumberFormat('nb-NO', {minimumFractionDigits: N, maximumFractionDigits: N})`, see `report.js`/`chain-report.js`/`timeofday-report.js`) instead of raw `escapeHtml(value)` string conversion — do not use `common.js`'s global `formatNumber`/`CommonTable.prototype.formatNumber`, which has no thousands separator.
- Use Bootstrap dropdowns for action/export menus and CommonTable column selector.
- Use shared Bootstrap confirmation helpers; avoid browser `confirm()`.
- Preserve DOM hooks, route names, payload keys, and response contracts.
- Use `Routing.generate()`, `Translator.trans()`, `Loader`, `openModalById()`, and `closeModalById()`.
- Update the webpack entry and Twig `encore_entry_*` calls when adding JS; build with `npm run dev` / `npm run build`.

## Translations — Reuse Legacy First

- Before using or inventing any translation key, grep the legacy key in `../duell-pos/app/Resources/translations/messages.en.xliff`. If it already exists there, reuse the same key name and English text verbatim — do not invent a new key or paraphrase.
- Also check whether the surrounding UI convention avoids the key entirely (e.g. icon-only toolbar buttons in this codebase have no text label at all — see `dd-import-export` dropdown toggles). Matching the existing pattern is often better than adding a new key.
- When a key is genuinely new (no legacy equivalent, no existing duell-admin key covers it), add the EN source string to **`../duell-pos/app/Resources/translations/messages.en.xliff`** (the legacy project, **EN only**). That file syncs to the external translation tool — adding the key there is what makes it visible to translators. Do **not** add new keys to duell-admin's own `shared/translations/messages.en.xliff`; that small local file predates the sync workflow and is legacy.
- duell-admin's runtime translations load from `shared/translations/messages_no.json` / `messages_en.json`, which are **overwritten wholesale** by `ExternalTranslationWebhookController` on every translation-tool push — they are sync targets, not hand-maintained sources. For immediate QA visibility before the tool sync catches up, temporarily add the key with real Norwegian text to `messages_no.json`; it will be overwritten by the real synced value later, which is expected.
- The `add-module-translations` skill is the source of truth for this workflow — follow it for the full procedure, key naming conventions, and xliff ID-block numbering.

## Cross-Cutting Sync

Use the specialist skills as needed for narrow sub-tasks:

- `add-module-translations` for settings module toggle/helptext translations.
- `tenant-context-guard` for tenant errors or cross-tenant risks.
- `legacy-migration-modernization` for deep parity comparison, AngularJS-to-jQuery conversion detail, and Symfony 8/PHP 8.5 cleanup passes.
- `upgrade-verification` for post-implementation code review and AJAX contract audits.
- `timeline-release` when the work is ready to ship — release note and manual QA plan.
- `db-access` whenever you need the live database — real column/index structure, a tenant's DB name, or whether a migration has actually landed. Never assume schema from entity files.

## Validation

Run the smallest reliable validation set for the touched surface:

- PHP syntax checks for touched PHP files (`php8.5 -l <file>`).
- Twig lint for touched templates when available.
- JS syntax/build for touched frontend entries.
- FOS JS route dump if exposed routes changed: `php bin/console fos:js-routing:dump --format=json --target=public/js/routes.json` in `backoffice/`, then rebuild.
- XML parse for touched XLIFF files.
- PHP fixer: run `php-cs-fixer fix --config=.php-cs-fixer.php -- <file>` from the repo root when required; use `.php-cs-fixer.php`, not `phpcbf`. If PHP-CS-Fixer is unavailable, report that instead of substituting another formatter.
- Manual compatibility notes for AJAX payloads, modals, filters, tables, exports, permissions, CSRF, and tenant-specific data.

If validation cannot run, state exactly why and what remains unverified.

## Handoff

Final response should include:

- Inventory: module boundary, touched files, legacy references, routes.
- Changed: backend, repository/service, frontend/UI, config.
- Preserved: route names, payloads, response shapes, DOM hooks, permissions, tenant/session contracts.
- Changed intentionally: user-requested or required behavior changes.
- Validation: commands run, results, failures, unverified areas.
- Risks: remaining migration gaps, manual QA, DB migration concerns, follow-up work.

## Stop Points

Ask before continuing only when:

- Required task/bug ID is missing for requested timeline creation.
- A DB migration, destructive data operation, or breaking route/API contract is needed and was not explicitly requested.
- Legacy and new behavior conflict and neither can be authoritative.
- User changes in the worktree directly block the upgrade.

Otherwise, make conservative assumptions and continue through implementation and validation.
