---
name: codebase-analysis
description: Explore, debug, or assess refactor impact across the Duell Admin monorepo using its real structure (backoffice/api/cron/shared, dual entity managers, legacy duell-pos reference). Use when Claude is asked to explore or map the codebase, trace a bug through the stack, find all callers/usages before a refactor, or gather blast-radius context for a review. Replaces explore-codebase, debug-issue, refactor-safely, and review-changes.
argument-hint: <feature | symbol | route | file>
context: fork
agent: readonly-auditor
user-invocable: true
disable-model-invocation: true
---

# Codebase Analysis

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: codebase-analysis`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Explore, debug, plan refactors, and gather review context in this monorepo using standard tools (Grep/Glob/Read, the Explore agent, git). The `code-review-graph` MCP server that earlier versions of this skill relied on is **no longer configured** — do not call `semantic_search_nodes`, `query_graph`, `get_minimal_context`, or any other graph tool.

## Map of the monorepo

| What | Where |
|------|-------|
| Backoffice controllers | `backoffice/src/Controller/` — extend `BaseController` |
| API controllers | `api/src/Controller/` |
| Cron/console commands | `cron/src/` |
| All entities | `shared/src/Entity/Admin/` + `shared/src/Entity/Client/` — never app-local |
| All business repositories | `shared/src/Repository/Admin/` + `shared/src/Repository/Client/` |
| Shared services | `shared/src/Service/` |
| Twig templates | `backoffice/templates/` |
| Frontend JS | `backoffice/assets/js/` — one webpack entry per page (`webpack.config.js`) |
| Bundled JS routes | `backoffice/public/js/routes.json` (NOT `fos_js_routes.json`) |
| Legacy reference | `../duell-pos/src/*Bundle/` — business-logic source of truth (mapping in `CLAUDE.md`) |
| Error logs | `{backoffice,api,cron}/var/log/dev.error-*.log` |

Boundary rule: the **admin** entity manager serves the shared `kasse_admin` DB; the **client** entity manager serves the per-tenant `kasse_client_*` DB and is only valid after tenant context is initialized (`TenantContext` / `setupTenantFromDatabase()`).

That is the rule for *application code*. To query the **live** database — real columns and indexes, a tenant's actual DB name, or what data exists — use the `db-access` skill. Entity files tell you what the schema is supposed to be; only the DB tells you what it is.

## Explore mode

When asked to understand a feature or module:

1. Find the page entry point: the route name used in JS (`Routing.generate('...')`) or the menu link in `backoffice/templates/topNavHeader.html.twig`.
2. Grep the route name in `backoffice/src/Controller/` to find the action; read it plus the repository/service methods it calls.
3. Read the matching template in `backoffice/templates/` and the JS entry in `backoffice/assets/js/`.
4. For business-rule questions, check the legacy original in `../duell-pos/src/` — it is the source of truth for expected behavior.
5. For broad sweeps across many files or unknown naming conventions, delegate to the Explore agent instead of grepping serially.

## Debug mode

When tracing a bug:

1. Reconstruct the path first: JS event → AJAX route → controller action → repository/service → response handling. Read each hop; do not guess.
2. Check the newest error log: `ls -t backoffice/var/log/dev.error-*.log | head -1`. To fix directly from a log, use the `fix-error` skill; for a known `file:line` + exception, use `hotfix`.
3. Check recent changes: `git log -p --follow <file>` and the current `git diff` — recent edits are the most common cause of new breakage.
4. Suspect the usual failure classes in this codebase: missing tenant context before a client-DB call, wrong entity manager for the data, un-exposed route or stale `public/js/routes.json`, missing CSRF token on a write, and JS-payload vs controller-parsing mismatches (audit those with `upgrade-verification`).

## Refactor-impact mode

Before changing a shared symbol (repository method, service, entity field, route, JS helper):

1. Grep the exact symbol repo-wide — including `api/` and `cron/`, which share `shared/`. For repository methods, also grep the result-array keys callers read.
2. Check dynamic references that greps for the symbol alone will miss: route names in JS/Twig, service IDs in YAML, Twig variable names, `data-*` hooks, translation keys.
3. List every caller before editing. If the caller set is wide, present it and confirm scope before proceeding.
4. Preserve contracts by default: route names, JSON keys, result-array keys, pagination semantics (`isTotal`), Twig variables, DOM hooks.

## Review context

For actually reviewing a diff or an upgraded module, use the dedicated skills: `upgrade-verification` (module review, QA plan, AJAX contract audit) or the built-in `code-review`. Use this skill to gather the context they need — blast radius, caller lists, and legacy parity references.
