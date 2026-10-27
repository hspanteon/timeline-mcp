---
name: hotfix
description: Permanently fix a reported error at a given file:line without disturbing core feature behavior. Diagnoses root cause, applies minimal surgical fix, and explains what broke, what changed, and why the exception cannot recur. Use when Claude is given file.php:line plus an exception/error and asked for a minimal surgical hotfix.
argument-hint: <file:line> [error-description]
---

# Hotfix

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: hotfix`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

You are performing a **permanent hotfix**. The user has given you a file path, line number, and error description. Your job is to diagnose the root cause, apply the minimal correct fix, and prove it is permanent.

**Not this skill:**
- If investigating an unknown error or looking at recent Symfony/PHP error logs without a known `file:line`, use `fix-error`.


## Input format

The user provides one of:
- `file.php:123 "ErrorMessage"` — file, line, error string
- A natural language description referencing file + line + error

Parse all three from the user message before starting.

## Step 1 — Read the file around the reported line

Read the file. Focus on ±40 lines around the reported line to get full context: the method signature, variable declarations, all code paths leading to that line.

If the file is a controller, also check:
- The route/action that calls this method
- Any service or repository injected and used here

If the file is a service or repository, also check:
- How callers pass data to this method
- Whether the issue is in the caller vs. this file

## Step 2 — Diagnose root cause

Do NOT just fix the symptom. Ask:

1. **Why did this line fail?** (null not checked, wrong type, missing key, wrong assumption)
2. **Where does the bad value originate?** (caller, DB, config, user input)
3. **Is this the only place this pattern exists?** (grep for similar patterns in the same file/class)
4. **Can this condition recur after the fix?** (if yes, the fix is not permanent — go deeper)

Common root causes in this codebase:
- Null entity returned from Doctrine `find()`/`findOneBy()` with no null check
- Array key accessed without `isset()` or `??` guard
- Service not injected (null service used without guard)
- Type mismatch between what Doctrine returns and what the code expects
- Missing tenant context before client DB operation
- Legacy `$_FILES` / `$_GET` direct access instead of `Request` object
- `strtotime()` returning `false` on invalid date input without validation

If the root cause depends on what the data or schema actually looks like — a column that may not exist on this tenant, a value that shouldn't be null but is — verify it against the live DB with the `db-access` skill rather than inferring from entity files. It owns DB credentials and tenant DB lookup; don't hand-roll a connection.

## Step 3 — Apply the fix

Rules:
- **Surgical**: change only what is necessary to eliminate the root cause permanently
- **No behavior change**: the feature must work exactly as before for valid input
- **Symfony 8 patterns**: use typed nullables, null coalescing, early returns, not nested ifs
- **No new dependencies**: do not add services/methods unless strictly required
- **If root cause is in caller**: fix the caller, not the callee — document why
- **If fix requires >2 files**: fix all of them; do not leave a half-fix

After editing, re-read the changed lines to confirm the edit is correct.

## Step 4 — Verify no similar issues remain

After fixing the reported line, grep the same file for the same antipattern. If found:
- Fix all instances in the same file in the same pass
- Note them in the report

## Step 5 — Validate the fix

For touched PHP files, run `php -l <file>` (use the repo's PHP 8.5 binary, e.g. `php8.5 -l`). When formatting is required, run `php-cs-fixer fix --config=.php-cs-fixer.php -- <file>` from the repo root — use `.php-cs-fixer.php`, not `phpcbf`. If PHP-CS-Fixer is unavailable in this environment, report that instead of substituting another formatter.

## Step 6 — Draft the commit message

This repo's convention for hotfix commits is `Hotfix: <what was fixed>.` — capital "Hotfix:", one sentence describing the fix (not the error, not the diagnosis), ending with a period. Check recent history if unsure: `git log --oneline --grep=hotfix -i`.

Derive it from the Step 3 fix, not the raw error string. Examples from this repo's history:
- `Hotfix: Guarded the percentage calculation with $highestSale > 0.`
- `Hotfix: The filename fallback must only contain ASCII characters.`
- `Hotfix: endtime could arrive malformed.`

Do not run `git commit` yourself — only produce the message. Committing/pushing is the user's call (use the `ship-task` skill if they ask to commit).

## Step 7 — Deliver the hotfix report

Output this report (concise, no filler):

### Hotfix Report

**File:** `path/to/file.php` (line N)

**Error:** `ExceptionType: message`

**Root cause:** One sentence. What actually caused this — the incorrect assumption, missing guard, or wrong value origin.

**Fix:** One sentence. What was changed and why it eliminates the root cause, not just the symptom.

**Why it won't recur:** One sentence. What structural guarantee now prevents this condition from being possible again (null guard, type enforcement, early return, validation at boundary, etc.).

**Other instances fixed:** (list file:line if any; omit section if none)

**Commit message:** `Hotfix: <one-line summary>.`

Do not summarize what you read. Do not explain Symfony concepts. Keep the report under 12 lines total.
