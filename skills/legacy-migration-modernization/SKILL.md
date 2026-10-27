---
name: legacy-migration-modernization
description: Migrate legacy duell-pos features into Duell Admin while preserving legacy parity and modernizing safely. Replaces legacy-parity-compare, migrate-angular-to-jquery, modernize-controller, modernize-repository, and symfony8-php85-upgrade-check. Use when Claude is asked to migrate old legacy code, compare old and new behavior, port AngularJS to jQuery/CommonTable, modernize Symfony controllers or Doctrine repositories, clean legacy aliases/annotations, add safe PHP 8.5 typing, or run Symfony 8/PHP 8.5 upgrade checks without breaking behavior.
argument-hint: <module-name | controller-path | task-id>
---

# Legacy Migration & Modernization

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: legacy-migration-modernization`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Use this skill when moving behavior from `../duell-pos` into the Symfony 8/PHP 8.5 Duell Admin repo, or when modernizing already-migrated code. Preserve behavior first, modernize second.

**Not this skill:**
- For fixing upgrade-specific bugs (`/upgrade-bug`), UI adjustments on already-ported modules, or restoring lost upgrade behavior, use `upgrade-implementation`.
- For cleaning dead code, unused imports, or file formatting, use `code-quality-pass`.

## Core Rule


Always establish legacy parity before cleanup. Do not change route names, payload keys, response shapes, repository result arrays, Twig variables, DOM hooks, permissions, session assumptions, sorting, pagination, or totals unless the user explicitly asks for a breaking change or a bug fix requires it.

## Workflow

### 1. Read Context

Read `CLAUDE.md`, then scope the exact feature/files.

If a timeline task exists, read:

```text
timeline/{task-id}/task.md
timeline/{task-id}/analysis.md
timeline/{task-id}/progress.md
```

Use timeline requirements and acceptance criteria to define the migration scope. If this is a new task intake, run `timeline-intake` first and ensure its analysis includes legacy source paths and parity risks. `timeline-progress` owns these files — report what changed rather than editing them here.

### 2. Trace Legacy Flow

Inspect the full legacy implementation in `../duell-pos` before editing:

- Controller action(s).
- Repository/service methods.
- Twig templates.
- AngularJS/legacy JS under `web/js/`.
- Translation keys, route names, permissions, and DB fields used by the flow.

If legacy code is inaccessible or missing, state that and derive expected behavior only from current requirements.

### 3. Build Parity Checklist

Document the compatibility surface before implementation:

- Input payload keys, query params, form fields, defaults.
- Query semantics: filters, joins, null handling, sorting, pagination, totals, `isTotal` behavior.
- Response shape: JSON keys/types, redirects, status flags, file downloads.
- Route names, HTTP methods, paths, exposed JS route flags.
- Twig variable names, DOM IDs, modal IDs, `data-*` hooks, CSS hooks.
- Repository method names, argument order, array keys, value types.
- Tenant/session assumptions: `clientId`, `departments`, locale, login employee, permissions.
- Security behavior: CSRF, authorization, sanitization, uploads, deletes, exports.
- Locale-aware value rendering: AngularJS `number`/`currency`/`date` template filters (e.g. `| number:0`). These are framework defaults applied implicitly to nearly every cell, not a named feature, so they're easy to drop wholesale during a full rewrite instead of being ported per-column. Grep the legacy Twig for `| number` / `| currency` / `| date` on every value the migrated view renders, not just the ones an explicit requirement calls out.

Treat this checklist as the contract to preserve.

### 4. Identify New-Code Counterparts

Map legacy code to the new repo:

- Legacy `AdminBundle` / `ClientBundle` controllers -> `backoffice/src/Controller/`.
- Legacy entities -> `shared/src/Entity/`.
- Legacy repositories -> `shared/src/Repository/Admin` or `shared/src/Repository/Client`.
- Legacy Twig -> `backoffice/templates/`.
- Legacy JS/Angular -> `backoffice/assets/js/`.
- Route exposure -> Symfony route attributes and FOS JS route artifacts.

Create or update only the files needed for the feature slice.

## Backend Controller Migration

When touching controllers:

- Use Symfony 8 route/security attributes and typed `Request` / `Response` arguments.
- Keep route names, exposed route flags, JSON keys, redirects, permissions, and Twig variables stable.
- Use the correct base controller: most backoffice controllers extend `App\Controller\BaseController`; admin-only pages may extend `App\Controller\Admin\BaseController`.
- Use `getClientEntityManager()` for tenant DB work and `getAdminEntityManager()` for shared admin DB work.
- Do not mix admin/client repositories accidentally.
- Replace `$this->getRequest()`, bundle template notation, Sensio-era annotations, and string repository aliases in touched code.
- Prefer existing injected services and base-controller helpers over new service-location patterns.
- Validate CSRF for POST/PUT/PATCH/DELETE endpoints.
- Sanitize user-controlled HTML before saving or rendering it back.

## Repository And Service Migration

When touching repositories or query services:

- Read the full repository and all direct callers.
- Compare matching legacy repository/service before changing query logic.
- Preserve array keys, value types, sort order, pagination semantics, `isTotal`, null handling, joins, and boolean normalization.
- Keep method names and argument order unless the user requested a breaking cleanup.
- Keep admin data in admin repositories and tenant data in client repositories after tenant context is initialized.
- Parameterize dynamic values and avoid concatenating user-controlled SQL.
- When legacy and new queries disagree about a column, join, or result shape, settle it against the live DB using the `db-access` skill (it owns credentials and tenant DB lookup) rather than assuming either side's entity mapping is current. `EXPLAIN` there also tells you whether a migrated query still uses the index the legacy one relied on.
- Prefer `Entity::class`, typed signatures, explicit return types, and strict parameter binding when safe.
- Do not rewrite stable business rules only for style.

## Frontend AngularJS To jQuery Migration

When migrating legacy Twig/JS:

- Distinguish Angular `{{ }}` bindings from Twig `{{ }}` expressions before deleting anything.
- Replace Angular directives with jQuery/Twig equivalents:
  - `ng-click` -> delegated `.on('click')`
  - `ng-change` -> `.on('change')`
  - `ng-submit` -> `.on('submit')`
  - `ng-keyup` / `ng-keydown` / `ng-keypress` -> matching key event handlers
  - `ng-model` -> `.val()` or `.prop('checked')`
  - `ng-show` / `ng-hide` -> `.toggle(true/false)`
  - `ng-if` -> jQuery show/hide or Twig `{% if %}`
  - `ng-class` -> `.toggleClass()` or Twig logic
  - `ng-disabled` -> `.prop('disabled', true/false)`
  - `ng-checked` -> `.prop('checked', true/false)`
  - `ng-src` / `ng-href` -> `.attr('src', ...)` / `.attr('href', ...)`
- Replace Angular `$http` with `$.ajax`.
- Replace Angular `| number:N` / `| currency` template filters with an explicit formatting call at the point of render — do not just stringify the raw value. Reuse the established local `formatNumber(value)` pattern (`Intl.NumberFormat('nb-NO', {minimumFractionDigits: N, maximumFractionDigits: N})`) already used in `backoffice/assets/js/report.js`, `chain-report.js`, and `timeofday-report.js`, rather than inventing a new helper or relying on `common.js`'s `formatNumber`/`CommonTable.prototype.formatNumber` (those only do `toFixed().replace('.', ',')` and add no thousands separator).
- Use `Routing.generate()` for URLs and ensure JS-used routes are exposed.
- Use `Translator.trans()` for user-facing strings. Before adding keys, follow the legacy-reuse rules in the `upgrade-implementation` skill's Translations section.
- Use `Loader.start()` / `Loader.stop()`, `toastr`, `openModalById()`, and `closeModalById()`.
- Include CSRF tokens on write requests.
- Convert tabular `ng-repeat` flows to `CommonTable` or server-side Twig rendering while preserving column keys and filter names.
- Preserve IDs, `data-*` attributes, form names, CSS hooks, modal IDs, and route names used by existing code.
- Keep architecture event-driven; avoid one-for-one watcher ports when smaller jQuery functions are clearer.
- Update webpack entry and Twig `encore_entry_*` calls when adding JS.

## Symfony 8 / PHP 8.5 Cleanup Pass

After behavior is migrated and parity is stable, run a targeted cleanup pass over touched files:

- Search for `$this->getRequest()`, `$this->container`, Sensio-era annotations/configuration, bundle template notation, string repository aliases, loose action signatures, and untyped arguments that are safe to type.
- Add parameter/return types only when behavior and callers are clear.
- Use newer PHP features only when they improve clarity.
- Remove dead imports/code only after confirming they are not migration scaffolding or framework/dynamic hooks.
- Keep broad style rewrites out of the migration unless they reduce real risk.

## Validation

Run checks that match the touched surface:

- `php8.5 -l <file>` for touched PHP files.
- PHP fixer: run `php-cs-fixer fix --config=.php-cs-fixer.php -- <file>` from the repo root when required; use `.php-cs-fixer.php`, not `phpcbf`. If PHP-CS-Fixer is unavailable, report that instead of substituting another formatter.
- Twig lint for touched templates.
- `node --check <file>` or build for touched JS entries.
- FOS JS route dump when exposed routes changed.
- XML parse for touched XLIFF files.
- Manual parity checks for controller, repository, Twig, JS, AJAX payloads, modals, filters, table behavior, permissions, CSRF, tenant data, and exports.

If validation cannot run, state why and list what remains unverified.

## Reporting

Report:

- Legacy files inspected.
- New files changed.
- What matches legacy exactly.
- What changed intentionally and why.
- Controller/repository/frontend modernization performed.
- Validation commands and results.
- Remaining parity gaps or migration risk.

## Constraints

- Never revive AngularJS runtime code in the new repo.
- Do not silently change route/API contracts.
- Do not move entity classes out of `shared/` or create local app entities.
- Do not run destructive git commands.
- Ask before DB migrations, destructive data operations, or breaking contracts unless the user explicitly requested them.
