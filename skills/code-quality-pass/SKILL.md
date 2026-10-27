---
name: code-quality-pass
description: "Explicit cleanup / refactor / code-quality pass on one PHP, JS, or Twig file — dead code and unused imports, OOP and structural fundamentals, and IDE-level static warnings — always behavior-preserving. Run one pass or all of them. Use ONLY when the user explicitly asks to clean up, tidy, restructure, refactor, or quality-check a file they name. Do NOT use for fixing a reported bug, exception, or error log (use `fix-error` or `hotfix`), and do NOT use for feature work or logic changes that merely touch the same file."
argument-hint: <file-path> [clean | structure | warnings | all]
user-invocable: true
disable-model-invocation: true
---

# Code Quality Pass

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: code-quality-pass`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

One deliberate, behavior-preserving quality pass over one file the user named. Three passes live here — **Clean**, **Structure**, **Warnings** — plus an optional **Optimize** step that hands the accumulated diff to the global `simplify` skill.

## Scope

- **One file at a time.** If given several files or a glob, finish every selected pass *and* the report for file N before starting file N+1. Report per file rather than accumulating silently, so a problem found in file 3 doesn't retroactively cast doubt on files 1–2 that already finished clean.
- **File types:** `.php`, `.js`, `.twig`/`.html.twig`. Anything else — say the skill does not apply.
- **Repo:** duell-admin only (`backoffice/`, `shared/`, `cron/`). A file under `../duell-pos/` is reference-only — stop and say so.
- Batch/backlog work (a family of controllers all needing the same treatment) is what `all` mode plus `/loop` is for — feed this skill as the per-iteration prompt rather than looping individual passes.

## Mode selection

| The user asked for | Run |
|---|---|
| "clean up", "remove dead code", "unused imports", "tidy this file" | **Clean** |
| "check OOP", "fundamentals", "encapsulation/typing/SRP", "restructure" | **Structure** |
| "fix editor/IDE warnings", "squiggly lines", "inspections" | **Warnings** |
| "clean up, restructure and optimize", "full pass", "do everything" | **all** (Clean → Structure → Warnings → Optimize, strict order) |
| Generic "clean this file up" with no further detail | **Clean**, then offer the rest |

Run only what was asked. `all` is strictly more expensive than one pass — don't reach for it unless the request actually calls for it.

**Strict order in `all` mode, no skipping or reordering.** Restructuring before cleanup risks polishing code that cleanup was about to delete; optimizing before restructuring risks simplifying code whose shape is still about to change. Re-read the file fresh between passes — each one changes it, and cleanup routinely surfaces structural issues that weren't visible before (removing a dead branch shrinks a method enough to expose an SRP violation; removing an unused import makes a property's real type unambiguous). Each pass finishes, including its validation, before the next starts; if a pass's validation fails, fix the regression before continuing — never hand a broken file to the next pass.

## Risk tiers

Every pass classifies each finding, and only one tier gets applied:

- **Safe** — mechanical, behavior-preserving, no external caller impact. Apply it.
- **Flag** — plausible in principle, but fixing it touches the public API or call sites, or needs information from outside this file. Report only, never apply.

**When in doubt, Flag instead of Safe** — a missed report line is recoverable; a silently changed behavior is not.

Before removing or renaming any symbol, `rg` the repo for its name — PHP method names, route names, service IDs, command names, entity fields, repository methods, Twig variable names; JS function names, selectors, DOM ids/classes, `data-*` attributes, event names, translation keys, globals, and inline `onclick=` in Twig. If a symbol may be referenced dynamically (string-built method/route names, DI service IDs, markup hooks), keep it and note it in the report instead of deleting it.

---

## Pass 1 — Clean

Read the entire file first. Identify its type (controller, service, repository, entity, JS module, template), the framework conventions in use, its public API surface, and its dependencies. **Check the current git diff for the file** so in-progress user changes aren't accidentally reverted.

Remove:

**Dead code** — unused private/protected methods and properties and class constants (verify with a repo-wide search), unreachable code after `return`/`throw`/`exit`, empty catch blocks with no logging, variables assigned but never read, overridden methods never called via `parent::`.

**Obsolete comments** — commented-out old implementations, TODO/FIXME for completed work, comments restating the code (`// set name` above `$this->name = $name`), PHPDoc contradicting the actual signature.

> **Entity exception.** In `shared/src/Entity/`, an `@ORM\...` docblock is not always documentation. Some properties — mixed in among PHP 8 `#[ORM\...]` attribute-mapped fields — are mapped *only* via the legacy annotation docblock, with no attribute equivalent and often no type hint (e.g. `shared/src/Entity/Client/Channels.php:184-192`, `private $isCartVersion;`). Removing that docblock silently drops the Doctrine column mapping, and `php -l` will not catch it — it only breaks at schema/runtime. Before treating any `@ORM\...` docblock as obsolete PHPDoc, confirm the same property also carries a `#[ORM\...]` attribute duplicating the mapping. If it doesn't, keep it and note it as intentionally kept.

**Redundant imports** — `use` statements for classes not referenced or used only in removed code, duplicate `use` statements, unused JS imports.

**Dead branches** — `if (false)` / `if (true)` constant conditions, permanently-settled feature flags, legacy fallbacks for removed features.

**Reorder**, if the file needs it — PHP: constants, properties, constructor, public methods (route handlers first in controllers), protected, private. JS: imports, constants/config, initialization, event handlers, helpers.

**Add comments** only where they earn their place: complex business logic, non-obvious algorithmic choices, important side effects, dependency requirements, multi-tenant or permission context notes.

---

## Pass 2 — Structure

A design/correctness pass on OOP fundamentals. **PHP only** — for a JS file, skip this pass and point at `js-coding-standard`, which is its JS counterpart (scope discipline, equality, event binding, coupling, magic values, naming, house style).

**Legacy caveat:** if the file is still on Symfony 2.8 / PHP 5.6-era syntax, do not force modern-only syntax (constructor promotion, `readonly`, enums, `match`) onto it — flag the modernization as an opportunity instead of applying it.

### Encapsulation
- Public properties with no reason to be public (not a DTO, not required by Doctrine hydration/reflection, not a Twig template variable contract) → **Safe**: make `private`/`protected`; add a getter only if something outside the class actually reads it (verify with `rg` first)
- Public setters for values that should never change post-construction (e.g. entity ID setters with no real caller) → **Flag**
- Properties mutated from outside the class via direct access instead of a method → **Flag**

### Typing
- Untyped properties, parameters, or return types where the type is unambiguous from usage → **Safe**: add the type only, no signature reordering
- Missing `?Type` nullable typing where `null` is a real observed value (e.g. Doctrine `findOneBy` results) → **Safe**
- `declare(strict_types=1)` absent → **Flag** — can change behavior at call sites relying on loose coercion; never auto-add

### Single responsibility
- A class mixing unrelated concerns (a service that also formats HTTP responses, a repository issuing flash messages) → **Flag**
- A method doing more than one clearly separable thing → **Flag**; note the natural split point but do not perform the extraction — a genuine God-class extraction is `split-oversized-controller`'s job

### Coupling & dependencies
- `new SomeService()` inline inside a method instead of constructor-injected → **Flag** (changes the constructor signature and DI wiring)
- `$this->container->get(...)` / service-location → **Flag**, citing the CLAUDE.md rule against the pattern
- Concrete class type-hints where an existing interface would do → **Flag**

### Immutability & constants
- Magic numbers/strings repeated across the file with obvious meaning → **Safe**: extract to a `private const` within this file only — do not introduce a new shared constants class
- A DTO-like class whose properties are never reassigned after construction but aren't `readonly` → **Safe**, if `readonly` is consistent with how similar classes in the codebase are written
- Constructor-only property assignment not using constructor property promotion → **Safe**: promote it, provided no annotations/attributes on the property are lost in the process

### Inheritance & structure
- Overridden methods with a signature incompatible with the parent (LSP risk) → **Flag**
- Deep inheritance chains (3+ levels) where composition would be simpler → **Flag**
- A class/method that looks like it should be `final` → **Flag** even when `rg` finds no subclasses; marking `final` is a public contract change

### Naming & style
- Class names not PascalCase, methods/properties not camelCase, constants not UPPER_SNAKE_CASE → **Safe**, provided the rename doesn't cross the public API (route names, Twig variables, DI service IDs — if it does, **Flag**)
- Getter/setter naming inconsistent with the property it wraps → **Safe** if internal-only, **Flag** if called externally

---

## Pass 3 — Warnings

The IDE-inspection layer: the underlines an editor shows for suspicious-but-not-necessarily-broken code.

**Tooling caveat:** this repo has no ESLint/Prettier config for JS — do not invent one. PHP has `.php-cs-fixer.php` at the repo root; Twig has `bin/console lint:twig`. Use what exists; never introduce a new linter, formatter, or static analyzer to make this easier.

### PHP

| Issue | Tier |
|---|---|
| Unused `use` import | Safe — `rg` first to confirm the FQCN/short name has zero remaining usages in the file |
| Local variable assigned but never read | Safe |
| Variable possibly undefined on some code path (read outside every branch that sets it) | Flag — a default can mask a real bug; report the exact missing branch |
| Missing return/param type hint where every call site and return path is unambiguous | Safe — add the type only |
| Nullable value passed into a non-nullable typed/builtin call (`strlen($x)` where `$x` is `?string`) | Flag, unless a null-check already exists immediately adjacent to attach to |
| `@param`/`@return` PHPDoc contradicting the real signature | Safe — correct the PHPDoc to match the code, never the reverse |
| Deprecated construct: implicit nullable param (`SomeType $x = null`), curly-brace string offset (`$str{0}`), dynamic property write on a plain class | Safe — apply the direct modern equivalent |
| Array/offset access on a key that can legitimately be absent, no `isset()`/`??` | Flag — silencing changes behavior if absence was meant to surface an error |
| Duplicate `use` of the same class | Safe |

### JS

| Issue | Tier |
|---|---|
| Unused function parameter or declared-but-unread variable | Safe |
| Unreachable code after `return`/`throw`/`break`/`continue` | Safe — remove |
| `switch` case missing `break` with no shared logic/comment suggesting intentional fall-through | Flag — verify intent first |
| Implicit global (assignment to an undeclared identifier) | Flag if anything else might read it (`rg` the repo, including inline `onclick=` in Twig); Safe to scope with `let`/`const` only if nothing external references it |
| Assignment inside a conditional (`if (x = y)`) where comparison was clearly intended | Safe if context makes the typo obvious; Flag otherwise |
| Duplicate key in the same object literal | Safe — remove the shadowed one, after confirming neither is a typo'd *different* intended key |
| Leftover `console.log`/`debugger` not gated behind a debug flag | Safe — remove |

### Twig

| Issue | Tier |
|---|---|
| `<label>` with no `for` matching a paired control's `id` | Safe — add `for="<id>"` or wrap the control; if the `id` isn't unique in rendered output (inside a `{% for %}` loop), Flag instead |
| `<img>` missing `alt` | Safe — `alt=""` for decorative/preview images; a real description if the image conveys information not already in adjacent text |
| `<a>` with no `href`, used only as a click target | Safe — add `href="javascript:void(0);"`, matching this codebase's convention (see `CustomerGroup/addCustomerGroupModal.html.twig`, `VariantTemplate/addModal.html.twig`) |
| Malformed URI (stray space, e.g. `href="mailto: "`) | Safe — fix the syntax only; never fabricate a real value that doesn't exist elsewhere in the file/controller |
| Duplicate static `id` (outside, or duplicated across renders of, a `{% for %}` loop) | Flag — picking the authoritative one needs to know what targets it; grep `backoffice/assets/js` first |
| Leftover dead AngularJS directive attributes (`ng-model`, `ng-show`, `ng-if`, `ng-repeat`, `ng-click`, `show-errors`) with no Angular runtime on the page | Safe — remove the attribute entirely; never convert it to a jQuery equivalent here (that's `legacy-migration-modernization`'s job if real behavior needs porting) |
| Reference to a variable/filter a quick grep of the controller's render call shows is never passed | Flag — report, do not guess a replacement |
| Deprecated bundle-style include (`@Bundle/...`) | Safe — convert to path-based include per CLAUDE.md's Symfony 8 rules |

---

## Pass 4 — Optimize (`all` mode only)

Invoke the global `simplify` skill against the **accumulated diff from passes 1–3**, not the file in a vacuum — `simplify` reviews *changed* code for reuse, simplification, efficiency, and altitude cleanups, so hand it the diff rather than making it rediscover the whole file.

---

## Validation

Run the relevant tool check **before** the first pass and **again after** every pass's edits. Never leave the file failing its own syntax/lint check.

- **PHP:** `php8.5 -l <file>` (the repo's PHP 8.5 binary), then `php-cs-fixer fix --config=.php-cs-fixer.php -- <file>` from the repo root — use `.php-cs-fixer.php`, not `phpcbf`. If PHP-CS-Fixer is unavailable, report that rather than substituting another formatter.
- **Twig:** `cd backoffice && php8.5 bin/console lint:twig <path>` (path relative to `backoffice/`, or the full path).
- **JS:** `node --check <file>` — skip with a note if the file uses webpack-only syntax (bare `import`, etc.) that Node can't parse standalone.
- If a change touched routes, templates, generated assets, or translations, run the smallest relevant project command.
- If a fix breaks the check, revert that specific change and move it to **Flag** rather than forcing it through. If validation cannot run at all, state exactly why.

Before finalizing, confirm: public method signatures identical; route attributes/annotations unchanged; constructor params and DI unchanged; no behavioral logic modified; all used imports still present; PHP namespace and class name unchanged; JS module exports unchanged.

---

## Report

One report per file. Include only the passes that actually ran; an empty result is still a result — say "nothing found" rather than omitting the section.

```markdown
## Code Quality Pass: <filename>  —  <modes run>

### 1. Clean
- **Dead code:** N lines removed (list methods/blocks)
- **Obsolete comments:** N lines removed
- **Redundant imports:** N use statements removed
- **Dead branches:** N blocks removed
- **Reordered:** <structural changes, or "none">
- **Comments added:** N for complex logic

### 2. Structure   (N Safe applied / N Flag)
- **Encapsulation:** <file>:<line> — <what changed>
- **Typing:** <file>:<line> — <what changed>
- **Immutability/Constants:** <file>:<line> — <what changed>
- **Naming:** <file>:<line> — <what changed>
(omit categories with nothing fixed)

### 3. Warnings   (N Safe applied / N Flag)
- <file>:<line> — <issue> — <what changed>

### 4. Optimize (simplify)
<what was simplified/removed for efficiency>

### Flagged — needs a judgment call, not applied
- <file>:<line> — <issue> — <why it's Flag-tier, and what the fix would look like>

### Kept intentionally
- <dynamic/framework-facing code kept for safety, with reason>

### Validation
- `php8.5 -l` / `node --check` / `lint:twig`: <result>
- `php-cs-fixer`: <result — "no changes" or "applied">

### Total
- Lines before: N → after: N (net N, X%)
- N issues found (N Safe / N Flag), N applied, N flagged for follow-up

### Preserved
- Public API signatures ✅ · Route definitions ✅ · DI/constructor params ✅ · Behavioral logic ✅
```

---

## Important rules

1. **NEVER change behavior.** Every pass here is cleanup, design-correctness, or warning-silencing — none of them is a bug fix or a refactor of what the code *does*. If the only way to silence a warning is to change behavior, it's **Flag**, not Safe.
2. **NEVER remove a public method**, even if it looks unused — it may be called externally.
3. **NEVER modify route attributes** — names, paths, and methods stay identical.
4. **NEVER change a constructor signature or DI wiring** — even inside the Safe tier, this disqualifies a fix from being Safe.
5. **NEVER rename anything with an external reference** — response keys, Twig variables, DI service IDs, DOM hooks.
6. **NEVER auto-apply a Flag-tier item**, even when the fix seems obvious.
7. **When in doubt, keep it / Flag it.** False positives are safer than false negatives.
8. **Respect legacy syntax.** Legacy Symfony 2.8 / PHP 5.6 files must not receive modern-only syntax; do not convert AngularJS to jQuery unless explicitly requested.
9. **One file at a time**, one concern per pass.
10. **Wrong file type, wrong repo, or wrong kind of pass** → say so and point at the right skill instead of forcing this one.

## Not this skill

- A reported bug, exception, stack trace, or error log → `fix-error`; a specific `file:line` plus an exception → `hotfix`
- JS/jQuery fundamentals and house style in depth (scope, equality, coupling, event binding, naming) → `js-coding-standard`
- Extracting a module's actions out of a God controller → `split-oversized-controller`
- Hardcoded user-facing text → `add-module-translations`
- Cleanup of only the *changed lines* of an in-progress diff, not a full file → the global `simplify` skill directly
- Full legacy-parity/regression review of an upgraded module → `upgrade-verification` (its Review Mode checklist *flags* accessibility gaps and leftover AngularJS directive residue; this skill is where those get fixed, file by file)
- AngularJS-to-jQuery or Symfony modernization ports → `legacy-migration-modernization`
