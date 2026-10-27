---
name: keycloak-auth-integration
description: Implement, fix, or modernize Keycloak SSO integration while preserving session, tenant, fallback auth, redirect, logout, and permission behavior in this Symfony monorepo. Use when Claude is asked to add or fix Keycloak/SSO login, callback, logout, token, or session-auth flows.
argument-hint: "[flow-name | controller-path]"
user-invocable: true
disable-model-invocation: true
---

# Keycloak Auth Integration

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: keycloak-auth-integration`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Add or fix Keycloak authentication flows without breaking session, tenant, fallback auth, redirect, logout, or permission behavior.

## Steps

1. Read `CLAUDE.md` first, then inspect the full auth chain: security config, subscribers, controller entry points, and session usage.
2. Map current behavior before changing it:
   - Login entry route, callback route, post-login redirect, logout behavior, and the fallback session auth path (`SessionUserProvider`).
   - Required session data (user identity, tenant, locale, permission/module payload).
3. Preserve existing contracts:
   - Keep route names and redirect behavior unless explicitly asked to break compatibility.
   - Keep permission checks and user-facing error handling consistent.
4. Apply Symfony 8-first patterns:
   - Use attributes and typed signatures in touched controllers.
   - Avoid legacy service-location or annotation-era patterns.
5. Session and identity hygiene:
   - Ensure token-derived identity maps cleanly to local users.
   - When an SSO login fails on identity matching (`ssoId` with no corresponding `AdminUser`, or a user existing in Keycloak but not locally), confirm against the admin DB with the `db-access` skill — it owns DB credentials and read-only query patterns. Never log or echo token payloads or credential values while doing so.
   - Ensure tenant and permission state are hydrated before protected client-DB actions.
   - Handle expired/invalid tokens with deterministic cleanup and redirect.
6. Security guardrails:
   - Validate state/nonce where relevant.
   - Avoid logging sensitive token payloads.
   - Keep CSRF and session protections intact for auth-adjacent forms/actions.
7. Subscriber compatibility:
   - Verify `TenantSubscriber`, `LocaleSubscriber`, and `SecuritySubscriber` still execute with expected order-sensitive behavior.

## Validation

- Run syntax checks on touched files (`php8.5 -l <file>`).
- Verify the success path, token-expired path, unauthenticated redirect path, and logout path.

## Report

Produce a structured report following this format:

```markdown
## Keycloak Auth Integration Report

### Changes Made
| Component | File | Action Taken |
|---|---|---|
| Controller / Route | `<file>` | <summary of changes> |
| Subscriber / Security | `<file>` | <summary of changes> |

### Preserved Contracts
- **Routes & Redirects:** <status/details>
- **Session & Tenant Context:** <status/details>
- **Fallback Authentication:** <status/details>

### Open Risks / Remaining Gaps
- <any pending items, or "None — full auth flow verified">
```

