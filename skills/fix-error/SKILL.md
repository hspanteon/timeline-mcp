---
name: fix-error
description: "Fix a specific reported bug — read the Symfony/PHP error log and repair the root cause in source. Use when Claude is asked for /fix-errors, to check error files, fix from logs, inspect dev/error logs, or repair a logged PHP/Symfony/Doctrine failure, exception, or stack trace. Do NOT use for cleanup, refactoring, dead code, OOP/structure passes, or editor warnings — that is `code-quality-pass`. For a specific `file:line` plus an exception, use `hotfix`."
argument-hint: "[log-file-path]"
---

# Fix Error

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: fix-error`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

When the user invokes /fix-errors (or asks to "check error file and fix" / "fix from logs"), follow these steps exactly.

**Not this skill:**
- If you already know the exact `file:line` of the failure and need a surgical hotfix, use `hotfix`.


## 1. Locate the error log

Check in this priority order:
1. User-supplied path argument (e.g., `/fix-errors backoffice/var/log/dev.error-2026-06-23.log`)
2. Latest `dev.error-*.log` in `backoffice/var/log/`
3. Latest `dev.error-*.log` in `api/var/log/`
4. Latest `dev.error-*.log` in `cron/var/log/`
5. `backoffice/var/log/dev.log` (last resort — grep for `ERROR|CRITICAL|exception`)

To find the latest:
```bash
ls -t backoffice/var/log/dev.error-*.log 2>/dev/null | head -1
ls -t api/var/log/dev.error-*.log 2>/dev/null | head -1
ls -t cron/var/log/dev.error-*.log 2>/dev/null | head -1
```

## 2. Parse errors

Read the tail of the log (last 200 lines). Group by error type:

- **PHP Fatal / Error**: class not found, call to undefined method, type error, etc.
- **Symfony exception**: 500 responses, twig render failures, missing service, missing route
- **Doctrine**: mapping error, query failure, entity not found, connection error
- **CSRF / Auth**: token mismatch, access denied, missing tenant context
- **JS-side errors** (logged by backend): only if explicitly passed as a file

For each distinct error, extract:
- Error message (exact)
- File + line number from the stack trace
- HTTP context if present (route, URL, method)

## 3. Triage and rank

Fix in this order:
1. **Fatal errors** that crash the request (Exception, TypeError, Error)
2. **Doctrine / DB errors** (broken queries, missing entity, wrong EM)
3. **Service / DI errors** (missing injection, wrong argument type)
4. **Logic errors** (null dereference, wrong branch, missing check)
5. **Deprecation warnings** — fix only if the user explicitly asks

Skip errors that are:
- Infrastructure issues (DB connection refused, Redis unavailable) — report, do not guess-fix
- Third-party library internals — report the surface call that triggered them
- Duplicate stack traces of already-fixed errors

## 4. Locate source files

For each error:
- Read the file at the exact line from the stack trace
- Also read 20 lines above and below for context
- If error is in a vendor file, trace back to the first non-vendor frame in the stack

## 5. Fix

Apply the minimal fix for each error:
- Do not refactor beyond what the error requires
- Preserve route names, JSON shapes, Twig variable names
- Use correct entity manager: `getClientEntityManager()` for client DB, `getAdminEntityManager()` for admin DB
- Use existing BaseController helpers; do not re-inject services already provided by it
- After fixing a null-dereference, add only the null check — do not restructure the method
- For missing CSRF tokens: add `CsrfValidatorService` validation following existing controller patterns
- For Doctrine type errors: match the entity property type exactly; check `shared/src/Entity/`
- When the entity and the error disagree — a column the mapping expects but the query can't find, a type that looks right in PHP but fails at runtime — the schema has drifted from the code. Confirm against the live DB using the `db-access` skill (it owns credentials and tenant DB lookup) before changing the entity. Remember tenants migrate at different times: a column present on one tenant may be missing on another
- For missing route: check if route attribute and `options: ["expose": true]` are correct, then remind user to run `php bin/console fos:js-routing:dump --format=json --target=public/js/routes.json`

## 6. Validate after each fix

After editing each file:
```bash
php8.5 -l <file>       # syntax check (use the repo's PHP 8.5 binary)
# if route changed:
# php bin/console debug:router | grep <route_name>
```

If a migration file is implicated: do not auto-run migrations — report and ask.

## 7. Report

After all fixes, produce a structured report using this template:

```markdown
## Fix Error Report

### Resolved Errors
| File & Line | Error / Exception | Root Cause | Fix Applied | Validation |
|---|---|---|---|---|
| `backoffice/src/Controller/FooController.php:142` | `TypeError: null given` | Missing null check on entity relation | Added null guard before `->getId()` | `php8.5 -l` PASS |
| `shared/src/Repository/Client/BarRepository.php:89` | `Undefined method getEM` | Outdated method name | Replaced with `getEntityManager()` | `php8.5 -l` PASS |

### Unresolved / Skipped Errors (if any)
- `<file:line>` — `<error>` — Reason (e.g. requires DB migration, external service outage, needs product decision)
```


## Constraints

- Never delete migrations or schema files to silence Doctrine errors
- Never remove permission checks to silence access-denied errors — investigate why they fail
- Never add `@suppress` / `@ignore` / `error_reporting(0)` as a fix
- If the log shows an error in a file under `vendor/`, do not edit vendor — fix the calling code
- If fixing requires a DB schema change, stop and explain what migration is needed
