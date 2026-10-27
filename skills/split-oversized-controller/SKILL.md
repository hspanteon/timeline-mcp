---
name: split-oversized-controller
description: Extract one module's actions from an oversized backoffice controller into a dedicated controller while preserving every route contract and behavior. Use when Claude is asked to split, slim down, or extract a module from a large controller (ReportController, PurchaseOrderController, ImportController) or to move a feature's actions into their own controller.
argument-hint: <source-controller> <module-name>
user-invocable: true
disable-model-invocation: true
---

# Split Oversized Controller

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: split-oversized-controller`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Move one module's actions out of a giant controller into a dedicated controller class, byte-for-byte behavior-preserving. This is a **move, not a refactor** — modernization happens in a separate pass, never during the split.

Proven on the giftcard extraction: `GiftcardReportController` was cut from the 24k-line `ReportController` (15 methods, 1,286 net lines removed, all 10 routes intact). `BookingReportController` and `GiftcardReportController` are the reference templates.

## Step 1 — Scope the module

1. List every public action belonging to the module (grep the feature keyword across method names, route paths, and route names).
2. List every private method and constant those actions use. Classify each as **module-exclusive** (moves) or **shared with remaining actions** (stays; see Step 3 for a third option).
3. Build the **route registry** before touching anything: for each action record route name, path, HTTP methods, `expose` flag, and `IsGranted`/permission checks. This registry is the contract to verify at the end.

## Step 2 — Route-name safety check (critical)

- Routes with an explicit `name:` in the attribute keep their name after the move — safe.
- Any action relying on the **auto-generated** route name (derived from the controller class) would silently get a new name when moved. Pin the old name explicitly (`name: 'app_report_xyz'`) before or during the move.
- After the move, `debug:router` will also show new auto-registered `app_<newcontroller>_*` variants alongside the explicit names. This is a pre-existing, harmless pattern in this codebase (~100 `getallpermissions` variants already exist) — not an error. The explicit named routes are what matter.

## Step 3 — Classify imports and shared helpers

1. For each `use` statement in the source controller, mark it: **exclusive** to moved methods (goes to new controller, removed from source), **shared** (duplicated in both), or **already unused** (removed from source).
2. Constants used by both controllers are **redeclared** in the new controller — do not reach into the old controller's constants and do not create an intermediate parent (BookingReportController pattern: constants redeclared, no `__construct`).
3. A private helper needed by both controllers is **promoted to `BaseController` as `protected`** (as done with `getCurrentRequest()`), not duplicated. Check BaseController first — the helper may already exist there (e.g. `getRequest()` at ~line 1540).

## Step 4 — Create the new controller

- Same namespace, extends `App\Controller\BaseController`, class-level route prefix only if the source had one.
- Copy methods **verbatim** — keep formatting, comments, and even known anti-patterns (e.g. `exit;` after file streaming in export actions). Note anti-patterns in the report; do not fix them in this pass.
- Add the classified subset of `use` statements and redeclared constants.

## Step 5 — Delete from the source controller

1. Identify the exact cut boundaries first (moved methods are rarely contiguous — expect multiple segments).
2. Delete segment by segment; after all cuts, grep the source for every moved method name to confirm **zero remain**.
3. Remove `use` statements orphaned by the deletion (verify each candidate has no remaining reference in the file).

## Step 6 — Validate

Run all of these:

```bash
php8.5 -l <source controller> <new controller> [BaseController if touched]
php bin/console cache:clear            # in backoffice/
php bin/console debug:router | grep -E '<each route name from the Step 1 registry>'
```

- Every registry route must resolve to the **new** controller with unchanged path/methods.
- If any moved route is exposed: `php bin/console fos:js-routing:dump --format=json --target=public/js/routes.json` then `npm run dev`. Since route names are unchanged, **no JS edits should be needed** — if a JS change seems required, a route name leaked.
- `git diff --stat` sanity check: source shrinks by roughly the new file's size; nothing else changed unexpectedly.

## Step 7 — Report

- Methods moved (count + names), net lines removed from source.
- Imports: moved / duplicated / removed as orphaned.
- Helpers promoted to BaseController, constants redeclared.
- Route registry verification result (all resolved to new controller).
- Anti-patterns preserved deliberately (listed, not fixed).

## Rules

- Never rename a route, change a path/method/expose flag, or alter a response shape during the split.
- Never refactor, retype, or "clean while you're in there" — one concern per pass (`code-quality-pass` exists for the cleanup pass).
- Never leave a half-split: either the module fully moves and the source fully sheds it, or revert.
- Ask before proceeding if a candidate method is shared by moved and remaining actions and promoting it to BaseController looks risky.
