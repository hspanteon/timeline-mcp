---
name: js-coding-standard
description: Verify and align a backoffice JS file with the project's one house coding standard for jQuery/vanilla UI-support scripts (declarations, equality, naming, module wrapping, section organization for large files, event delegation) — a manual style guide, not a linter/build pipeline. Use when Claude is asked to check, audit, or verify a JS file's code quality/style, standardize JS conventions across developers, or clean up a page script's structure without changing behavior.
argument-hint: <file-path>
---

# JS Coding Standard

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: js-coding-standard`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

This is a **Symfony + Twig** project. The JS under `backoffice/assets/js/` is UI-support glue for server-rendered pages — jQuery, CommonTable, Select2, AJAX form/table interactions — not a JS application with its own build/lint pipeline. Files here are routinely large single-page scripts (`common.js` is 3,100+ lines; most page scripts run 500–1,800 lines) — that's the normal shape of this codebase, not a code smell to "fix" by splitting into modules.

Because of that, the standard is a **manual house style**, not tooling: no ESLint, no Prettier, no new npm build/lint dependency. Every developer applies the same rules by hand, and this skill is how a file gets checked and brought into line with them.

This is a code-quality/style pass, not a dead-code or editor-warnings pass (use `code-quality-pass` for those), not a hardcoded-text audit (use `add-module-translations` for that), not a route-usage audit (that lives in the JS-facing route checklist in `CLAUDE.md`), and not an AngularJS-to-jQuery port (use `legacy-migration-modernization` for that) — cross-reference those skills instead of duplicating their work. It is the JS counterpart to `code-quality-pass`'s Structure pass, which is PHP-only.

**Scope:** one file at a time, under `backoffice/assets/js/` (page scripts, `common.js`, per-module files). If given a file that's still genuine AngularJS (unconverted), stop and say this skill applies to jQuery/vanilla JS files only.

---

## The Standard

Modern (ES2015+) conventions, applied by hand, consistent with what's already in the newest files in this repo (e.g. `backoffice/assets/js/opening-hours.js`):

1. **Declarations** — `const` by default, `let` only when the value is reassigned, never `var`.
2. **Equality** — always `===`/`!==`, except the intentional `== null` idiom to catch both `null` and `undefined` (leave that one alone).
3. **Strings** — single quotes; template literals for interpolation/concatenation instead of `+`.
4. **Semicolons** — always terminate statements.
5. **Indentation** — 4 spaces, matching this repo's existing PHP/Twig/JS convention. No tabs.
6. **Naming** — camelCase for variables and functions, `UPPER_SNAKE_CASE` for module-level constants, function names are verbs describing what they do (`startLoader`, not `loader2`).
7. **Module wrapping** — the whole file wrapped in `$(document).ready(function () { ... });` (the pattern already used in current files), so nothing leaks onto `window` by accident. If something must be global (called from an inline `onclick=`/`data-*` hook in a Twig template), attach it explicitly and say why in a comment — don't leave it ambiguous whether a global was intentional.
8. **Section organization** (matters here specifically because files are large) — group the file top-to-bottom in the same order every time, with a plain comment header per section: constants/state → helper functions → event bindings → AJAX handlers → init (called last). A developer opening any file in this repo should be able to navigate it the same way regardless of who wrote it.
9. **jQuery / event binding** — cache a `$(selector)` in a variable if queried 3+ times in the same scope; delegate events (`$(document).on('click', '.selector', fn)`) on anything CommonTable or an AJAX response re-renders, instead of binding directly to elements that get replaced.
10. **AJAX pattern** — one consistent success/error shape reused file to file (toastr for errors, consistent structure for the `$.ajax`/`.done()`/`.fail()` calls) — don't invent a new pattern per file.
11. **Magic values** — a literal (status code, CSS class, selector, threshold) repeated 3+ times unchanged in a file → hoist to a named `const` near the top of that file's relevant section.
12. **Comments** — only for non-obvious "why" (a workaround, a subtle invariant); never restate what the code already says.

---

## Step 1 — Analyze

Read the entire file. For each rule above, record every violation as `file:line — issue — risk tier`:

- **Safe** — mechanical, behavior-preserving, no external caller impact. Auto-fixable in Step 2.
- **Flag** — correct in principle but changes runtime behavior, event lifecycle, or something referenced outside the file. Report only, do not apply.

Notes on specific rules:
- Rule 7 (module wrapping) — a global that looks unintentional is **Flag**: `rg` the repo (including Twig templates, for inline `onclick=`/`data-*` hooks) to confirm nothing outside the file depends on it before touching it. If genuinely unreferenced, that's dead code — hand off to `code-quality-pass` instead of fixing it here.
- Rule 8 (section organization) — reordering a large file's structure is **Flag** even though it's "just organization": moving code around a 1,000+ line file is easy to get subtly wrong (execution order, closures capturing state) and should be a deliberate, reviewed pass, not a silent side effect of a style check. Report the current structure and the target structure; don't reorder unless asked.
- Rule 9 (event binding) — switching direct binding to delegation changes when/how the handler attaches → always **Flag**.
- Rule 2 (equality) — `== null` used as an intentional coercion idiom is not a violation; note it under Intentional in the report, not as an open issue.

---

## Step 2 — Apply

Apply every **Safe**-tier fix. For each:
- Re-verify safety immediately before editing: `rg` the repo for the identifier being changed to confirm nothing outside the file depends on its current form.
- Preserve exact runtime behavior, execution order, and anything referenced outside the file (global names, event names, selectors, exported functions).
- Do not touch **Flag**-tier items — leave the code as-is and carry them into the report.
- Do not introduce ESLint, Prettier, or any build/lint tooling as part of this fix — this standard is enforced by reading and editing, not by a linter.
- After editing, re-read the changed lines to confirm the fix is correct and nothing else shifted.

**Validate:**
- `node --check <file>` for plain JS (skip for browser-only/asset syntax Node can't parse — e.g. bare `import`/webpack-specific syntax outside a module context — and say so instead of forcing it).

If validation fails, fix the regression before proceeding to Step 3 — do not report a broken file as done.

---

## Step 3 — Report

```markdown
## JS Coding Standard Report: <filename>

### Fixed (Safe tier, applied)
- **Declarations:** <file>:<line> — <what changed>
- **Equality:** <file>:<line> — <what changed>
- **Strings/semicolons:** <file>:<line> — <what changed>
- **Naming:** <file>:<line> — <what changed>
- **Event binding (cached selector):** <file>:<line> — <what changed>
- **Magic values:** <file>:<line> — <what changed>
(omit any category with nothing fixed)

### Flagged (needs a judgment call, not applied)
- <file>:<line> — <rule> — <why it's Flag-tier, and what the fix would look like>
(one line per item; omit section if none)

### Intentional (left as-is on purpose)
- <file>:<line> — <e.g. loose equality relied on for null/undefined coercion>
(omit if none)

### Validation
- `node --check`: <result, or "skipped — browser-only syntax">

### Total
- N issues found (N Safe / N Flag / N Intentional)
- N fixes applied
- N flagged for follow-up
```

---

## Important Rules

1. **No tooling** — never introduce ESLint, Prettier, or any npm lint/build dependency as part of this skill. This is a PHP/Symfony project; the standard is a written house style applied by hand, the same way every time, by whoever is editing.
2. **NEVER change runtime behavior** — this is a style-correctness pass, not a refactor or bug fix.
3. **NEVER change event-binding strategy, global names, section order, or anything referenced outside the file** — even inside the "Safe" tier, these disqualify a fix from being Safe.
4. **NEVER auto-apply a Flag-tier item** — report it, don't apply it, even if the fix seems obvious.
5. **One file at a time** — if given multiple files, finish each before starting the next; if the file is AngularJS or not JS, say the skill does not apply.
6. **Large files are normal, not a defect** — don't flag file length itself or suggest splitting a file into modules; this codebase's page scripts are meant to be one file per page.
7. **When in doubt, Flag instead of Safe** — a missed report line is recoverable; a broken event handler or reordered 1,000-line file in production is not.
