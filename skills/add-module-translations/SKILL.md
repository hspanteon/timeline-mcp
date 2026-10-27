---
name: add-module-translations
description: "Find and fix missing or hardcoded user-facing text in a module (Twig, PHP, JS) by declaring proper translation keys in the legacy EN xliff, reusing existing duell-pos keys wherever one already exists. Use when Claude is asked to audit a module for hardcoded strings, add missing translation keys, or wire up module text to Translator.trans()/|trans. Use ONLY when the user explicitly asks to add/update/fix a translation key or locale string. Do NOT use for general PHP, CSS, or module logic changes, even if they touch the same file."
argument-hint: <module-name | template-path | controller-path>
---

# Add Module Translations

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: add-module-translations`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Find every piece of missing or hardcoded user-facing text in a module's Twig templates, PHP controllers/services, and JS files, and turn it into a proper translation key — reusing an existing legacy key whenever the text (or its concept) already exists in duell-pos, and only minting a new key when it genuinely doesn't.

**Not this skill:**
- For dead code or formatting cleanup, use `code-quality-pass`.
- For complete legacy bundle migrations and AngularJS rewrites, use `legacy-migration-modernization`.


**Translation source of truth — read this first:**
- English source strings for new/changed keys are added to **`../duell-pos/app/Resources/translations/messages.en.xliff`** (the legacy project), **English only**. That file is what syncs to the external translation tool server; adding a key there is what makes it visible to translators (e.g. Peter Hamre handles NO/other locales personally in the tool once the EN key exists).
- Do **not** add new keys to duell-admin's own `shared/translations/messages.en.xliff` — that small local file predates this workflow and is legacy from before the sync process was clarified.
- duell-admin's runtime translations are loaded from `shared/translations/messages_no.json` and `shared/translations/messages_en.json`. These are **overwritten wholesale** by `ExternalTranslationWebhookController` (`backoffice/src/Controller/ExternalTranslationWebhookController.php`) whenever the translation tool pushes an update — they are a sync target, not a hand-maintained source.
- For immediate QA visibility on duell-admin (before the translation tool sync catches up with a real translator-provided value), manually add the key with real Norwegian text directly into `shared/translations/messages_no.json`. Treat this as a temporary QA aid — it will eventually be overwritten by the real synced value once Peter/the translation tool provides it, which is expected and fine.

**Files involved:**
- Module source: `backoffice/templates/<ModuleName>/**/*.twig`, the module's controller(s)/service(s) under `backoffice/src/`, and its JS file(s) under `backoffice/assets/js/`
- EN source (source of truth, syncs to translation tool): `../duell-pos/app/Resources/translations/messages.en.xliff`
- Legacy reference for reuse/matching: `../duell-pos/app/Resources/translations/messages.en.xliff` and `../duell-pos/app/Resources/translations/messages.no.xliff`
- NO QA text (temporary, until tool sync overwrites it): `shared/translations/messages_no.json`

## Step 1 — Scope the module

Identify every file that renders user-facing text for the target module:
- Twig template(s): `backoffice/templates/<ModuleName>/*.html.twig`
- Controller(s)/service(s): search `backoffice/src/Controller/` and `backoffice/src/` for the module's PHP classes
- JS file(s): the module's per-page webpack entry under `backoffice/assets/js/`

If the user names a module but not specific files, grep the module name across these three locations first to build the file list before scanning.

## Step 2 — Scan for hardcoded/missing text

Per file type, flag candidate strings using these patterns. Only flag text a user would actually see — never developer-only strings.

**Twig:**
- Any literal text node inside a tag that is not passed through `|trans` (labels, headings, button text, table headers, modal titles/bodies, tooltips, placeholders, `alt`/`title` attributes, help text, confirm dialogs)
- Exclude: class names, `data-*`/`id` attribute values, Twig variable output (`{{ someVar }}`), icon markup, whitespace-only nodes

**PHP:**
- String literals passed to `$this->addFlash(...)`, thrown in exceptions that are caught and shown to the user (check the catch site — if the message reaches a flash message, JSON `message`/`error` key, or a rendered template variable, it's in scope), validation constraint `message:` options, and literal strings assigned to response/template variables that hold display text
- Exclude: log messages (`$this->logger->...`), exception messages that are only logged/never surfaced to the UI, internal error codes, SQL/DQL strings

**JS:**
- String literals used as UI text: `alert()`/`confirm()` content, toast/notification text, `CommonTable` column `title`/labels, DOM text inserted via `.text()`/`.html()`, validation messages shown to the user
- Exclude: strings already wrapped in `Translator.trans('key')`, route names passed to `Routing.generate()`, selectors, event names, console/debug logging

For every candidate, note: file, line, exact hardcoded string, and surrounding context (what it is — button label, error message, table header, etc.).

## Step 3 — Decide missing vs. reuse

For each candidate string, before minting anything:

1. Search `../duell-pos/app/Resources/translations/messages.en.xliff` for a `<source>`/`<target>` pair whose English text matches the candidate exactly or closely (same concept, minor wording difference — e.g. "Enable X" vs "Activate X" for the same field).
2. If no direct English match, cross-check `../duell-pos/app/Resources/translations/messages.no.xliff` by `trans-unit id` — the same `id` exists in both files, so a NO entry whose id you can map back to an EN key in `messages.en.xliff` may reveal a key that covers the same concept even if the current EN wording differs slightly.
3. **If an equivalent key exists in either file:** reuse that exact key. Do not mint a duplicate. Rewire the source file to reference it (see Step 5).
4. **If no equivalent exists in either file:** the string is genuinely missing — mint a new key (Step 4) and add it to the legacy EN xliff (Step 6).

Only strings that survive step 4 (no legacy equivalent) count as "missing" for the purposes of this skill's report.

## Step 4 — Key naming convention

`<modulename>.<context>.<description>`

- `<modulename>` = lowercase module name (e.g. `tripletex`, `visma`, `fiken`, `fortnox`, `poweroffice`, `24sevenoffice`)
- `<context>` = one of: `switch.label`, `helptext.label`, `button`, `title`, `placeholder`, `tooltip`, `error`, `message`, `modal.title`, `modal.body`, `table.header`
- `<description>` = short camelCase description of the specific field/element (e.g. `save`, `invalidDate`, `confirmDelete`, `customerName`)

Examples: `tripletex.switch.label.autoSync`, `tripletex.button.save`, `tripletex.error.invalidDate`, `tripletex.table.header.customerName`

## Step 5 — Update the source file

Replace the hardcoded text in place with a reference to the (new or reused) key:

**Twig:**
```twig
{{ '<key>'|trans }}
```

**PHP:**
```php
$this->translator->trans('<key>')
```
(or the module's existing injected translator property/method — match what the file already uses; do not introduce a new way of calling the translator)

**JS:**
```javascript
Translator.trans('<key>')
```

Preserve exact surrounding markup/logic — this is a text-wiring change only, not a refactor. If a string spans a Twig conditional or has embedded variables, use ICU/sprintf placeholders consistent with how nearby existing keys in the same file handle interpolation (e.g. `%name%`), not string concatenation around the `trans` call.

## Step 6 — Add missing EN translations to `../duell-pos/app/Resources/translations/messages.en.xliff`

(The legacy-project file that syncs to the translation tool — never duell-admin's `shared/translations/messages.en.xliff`.)

Determine the next available module ID block. Convention:
- 24SevenOffice used `55001001–55001023`
- Next module: `55002001`, then `55003001`, etc.

Append before `</body>`, grouped by context, in the order encountered in Step 4 (switch labels, then helptext, then buttons, then errors/messages, then everything else):

```xml
<!-- <ModuleName> Module -->
<!-- switch labels -->
<trans-unit id="<nextId>">
    <source><modulename>.switch.label.<description></source>
    <target>Enable <Field Label></target>
</trans-unit>
...
<!-- helptext labels -->
<trans-unit id="<nextId>">
    <source><modulename>.helptext.label.<description></source>
    <target>Enable <field description> with <ModuleName>.</target>
</trans-unit>
...
<!-- other new keys -->
<trans-unit id="<nextId>">
    <source><modulename>.<context>.<description></source>
    <target><English text></target>
</trans-unit>
...
<!-- /<ModuleName> Module -->
```

IDs increment by 1 sequentially within the block. Only strings that failed the Step 3 reuse check get a new `trans-unit` here — reused keys are never re-added.

## Step 7 — QA visibility

For every newly minted key (not reused ones), also add it with real Norwegian text directly into `shared/translations/messages_no.json` for immediate QA visibility. Temporary — the tool sync will overwrite it once Peter/the translation tool provides the real synced value.

## Step 8 — Verify and report

- No hardcoded user-facing text remains in the scanned Twig/PHP/JS files (re-run the Step 2 scan patterns to confirm)
- Every reused key resolves to the exact key found in the legacy xliff — no near-duplicates created
- Count of new `trans-unit` entries added to the legacy EN xliff matches the count of strings that failed the Step 3 reuse check
- NO xliff (`messages.no.xliff`) is not touched — EN only in the legacy xliff
- `shared/translations/messages_no.json` still parses (`php8.5 -r 'json_decode(file_get_contents("shared/translations/messages_no.json"), true, 512, JSON_THROW_ON_ERROR);'`)

Report format:

```markdown
## Module Translation Report: <ModuleName>

### Reused (existing legacy key found)
- `<key>` — used at <file>:<line> (was: "<hardcoded text>")

### Missing (new key minted)
- `<key>` — used at <file>:<line> (was: "<hardcoded text>")

### Total
- N hardcoded strings found
- N reused from legacy xliff
- N genuinely missing, added to messages.en.xliff (ids <first>–<last>)
```
