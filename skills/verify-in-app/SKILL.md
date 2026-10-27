---
name: verify-in-app
description: Run and smoke-test duell-admin in the local browser environment to see a change actually working. Use when Claude is asked to verify a change end-to-end, screenshot a page, check a module in the running app, or confirm a fix works beyond lint/build.
user-invocable: true
disable-model-invocation: true
---

# Verify In App

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: verify-in-app`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

How to observe a duell-admin change working in the real local app — the project-specific companion to the built-in `verify` / `run` / `webapp-testing` skills.

## Environment map

| Thing | Value |
|---|---|
| Backoffice URL | `https://new.panteon-kasse.devhost` (NO locale) |
| Locale variants | `https://new-dk.panteon-kasse.devhost`, `https://new-se.panteon-kasse.devhost` |
| Legacy app (parity checks) | `https://panteon-kasse.devhost` (serves `../duell-pos`) |
| Serving | Apache vhost → `backoffice/public` directly; **no server to start**, PHP changes are live in `APP_ENV=dev` |
| TLS | Self-signed wildcard cert — use `curl -k`; in Playwright set `ignoreHTTPSErrors: true` |
| Auth | `/login` redirects to Keycloak SSO (`auth-staging.gba.no`, realm `authentication`) |
| Tenant switch | visit `/sso-login/{clientNo}` after login (`sso_client_switch` route) — `{clientNo}` is the `client_number` column, **not** `client_id` |
| Default test tenant | Resolve it, don't assume it: look up `client_id`, `client_number`, and `database_name` together via the `db-access` skill. IDs do not match DB names here — `client_id 1` is DB `kasse_client_2`, while `client_id 2` is `kasse_client_2_nxt` |
| Error logs | newest `backoffice/var/log/dev.error-*.log` |

## Test login

Credentials are **never stored in this file or pasted into chat**. They live in `~/.duell-test-login` (mode 600, outside the repo): line 1 = username, line 2 = password, for a dedicated staging-only Keycloak test account **without 2FA**.

Read them at runtime only:

```bash
TEST_USER=$(sed -n 1p ~/.duell-test-login)
TEST_PASS=$(sed -n 2p ~/.duell-test-login)
```

In a Playwright script, read the file the same way (e.g. `fs.readFileSync(os.homedir() + '/.duell-test-login', 'utf8').split('\n')`) and pass the values straight into the login form fill.

Rules:
- If the file is missing, stop and tell the user to create it themselves in their own terminal (`printf 'USER\nPASS\n' > ~/.duell-test-login && chmod 600 ~/.duell-test-login`). Never ask them to paste credentials into the conversation.
- Never echo, log, or screenshot the credential values; don't include them in reports or commit them anywhere.
- After a successful login, prefer saving Playwright storage state to the scratchpad and reusing it for later runs in the same session instead of re-entering credentials.

## Steps

### 1. Make the change visible

- PHP/Twig: usually live immediately in dev; if stale, `php bin/console cache:clear` in `backoffice/` (or `./quick-clean.sh` at repo root for a full clean).
- JS/CSS: `npm run dev` in `backoffice/` — a change is invisible until rebuilt.
- Route changes consumed by JS: re-dump `public/js/routes.json` first, then rebuild (see the JS-facing route checklist in `CLAUDE.md`).

### 2. Cheap pre-browser checks (no login needed)

```bash
# App boots and routing works: unauthenticated page must redirect toward SSO login, not 500
curl -k -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://new.panteon-kasse.devhost/<module-path>
# Exposed AJAX route is registered
php bin/console debug:router | grep <route_name>
```

A `500` here means broken before auth even matters — go straight to the error log.

### 3. Drive the flow in a browser

Use the `webapp-testing` skill (Playwright) with `ignoreHTTPSErrors: true`.

Confirmed working live (2026-07-13): the Keycloak login page uses the default theme selectors — fill `#username`, `#password`, click `#kc-login`; after submit the browser lands back on the backoffice at `/` with a full session. A reusable script exists from that run (`verify_login.py` pattern: login → navigate → screenshot → save `storage_state`). Note: the dev error log timestamps are Europe/Oslo time, not local IST — convert before deciding whether an entry belongs to your run.

1. Open the backoffice URL → follow the Keycloak redirect → log in with the test account.
2. If the change is tenant-specific, switch via `/sso-login/{clientNo}`.
3. Navigate to the changed page via the top nav (menu entries live in `templates/topNavHeader.html.twig`) or direct path.
4. Exercise the changed behavior specifically: the filter you added, the column you changed, the button you fixed — not just page load.
5. Screenshot the result; watch the browser console for JS errors and failed AJAX calls (4xx/5xx in the network log).

### 4. Check the server side afterwards

```bash
ls -t backoffice/var/log/dev.error-*.log | head -1   # then tail it
```

A page can render while an AJAX endpoint quietly 500s — always check the newest error log after driving the flow. To verify data effects, query the tenant DB read-only per the `db-access` skill.

## Rules

- **Do not run this skill proactively.** Only drive the browser/login/screenshot flow when the user explicitly asks to verify, test, or screenshot the change. After making a code change, stop and report what changed — don't automatically follow up with a live verification pass. If the user wants confirmation, they'll ask.
- Verification means the changed behavior was exercised and observed — "page loads" is not verification of a filter fix.
- Report what was actually observed (screenshot, response code, log state), including failures — never claim a pass without driving the flow.
- Stay read-only in the DB; create test data through the UI, not SQL inserts, unless the user approves.
- Never point verification at a non-`devhost` (production/staging) URL.
