---
name: tenant-context-guard
description: Ensure tenant context is initialized correctly before any client database access. Use when Claude is asked to fix tenant errors, cross-tenant data leaks, missing tenant session state, client DB connection issues, or tenant setup in subscribers, controllers, services, or commands.
user-invocable: true
disable-model-invocation: true
---

# Tenant Context Guard

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: tenant-context-guard`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Fix tenant issues, cross-tenant data leaks, and client DB access errors by guaranteeing tenant context is set before any client-DB touchpoint.

## Steps

1. Read `CLAUDE.md` first, then inspect the full request or command flow (controller/subscriber/service/command) end-to-end.
2. Identify every client-DB touchpoint and verify tenant setup happens before those calls.
3. Use project-native entry points for tenant setup:
   - In backoffice controllers, use base-controller helpers like `setupTenantFromDatabase()` where applicable.
   - In services/commands, ensure `TenantContext` is resolved and applied before client repositories are used.
4. Keep admin/client boundaries explicit:
   - Admin entity manager for shared metadata and tenant lookup.
   - Client entity manager only after tenant context is active.
5. Preserve session assumptions used by current flows:
   - Validate expected keys (`tenant_id`, `tenant_config`, locale, permission/session values) before refactoring.
   - Keep existing redirects/denials for unauthenticated or tenant-missing cases unless asked to change behavior.
6. Guard against unsafe fallback behavior:
   - Do not allow silent default-tenant behavior.
   - Fail fast with an explicit redirect or error response when tenant context is missing/invalid.
7. Keep compatibility with subscribers:
   - Respect `TenantSubscriber` (priority 20) and locale/security subscriber ordering expectations.
   - Avoid introducing logic that fights subscriber-managed state.

## Validation

- Run syntax checks on touched PHP files (`php8.5 -l <file>`).
- Verify at least one authenticated and one unauthenticated flow.
- Confirm no client query runs before tenant setup.
- To confirm a tenant actually resolves to the DB you expect — or to prove a suspected cross-tenant leak by checking which DB the data really lives in — use the `db-access` skill. It owns DB credentials and the `kasse_admin.client` tenant→DB registry, including per-tenant hosts and credentials. Never derive a tenant's DB name from its client ID.

## Report

Explain what changed, where tenant context is now guaranteed, and any residual risk.
