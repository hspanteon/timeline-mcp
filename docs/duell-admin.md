# Duell Admin Architecture & Rules

This rule provides architecture guidelines, coding conventions, and operational rules for AI agents working across the **Duell Admin** Symfony monorepo.

---

## Monorepo Architecture Overview

Duell Admin is organized into specialized applications and a shared library:

| Directory | Role | Framework / Stack | Detailed Doc |
|---|---|---|---|
| [`backoffice/`](../docs/backoffice.md) | Main Admin UI (nearly all feature work) | Symfony 8, Twig + jQuery 3.7 + Bootstrap 5 | [`docs/backoffice.md`](../docs/backoffice.md) |
| [`superadmin/`](../docs/superadmin.md) | Cross-Tenant Superadmin Panel (ticket #5585) | Symfony 8, Server-rendered Twig, Keycloak | [`docs/superadmin.md`](../docs/superadmin.md) |
| [`cron/`](../docs/cron.md) | Background Console & Migrations Engine | Symfony 8 Console App | [`docs/cron.md`](../docs/cron.md) |
| [`shared/`](../docs/shared.md) | Shared Entities, Repositories & Services | Composer Path Repo (`duell/shared`) | [`docs/shared.md`](../docs/shared.md) |
| [`api/`](../docs/api.md) | REST API Application | Symfony 8 REST | [`docs/api.md`](../docs/api.md) |

---

## Core Operational Rules & Conventions

### 1. Dual-Database Multi-Tenant Architecture
- **Admin Database (`admin` connection)**: Shared database for clients, system users, partners, and global settings (`Shared\Entity\Admin\*`).
- **Tenant Database (`client` connection)**: Isolated database for each active client/department (`Shared\Entity\Client\*`).
- **Context Guard**: Always ensure `TenantContext` is initialized before querying tenant repositories.

### 2. Entity Location Rule
- **All entities belong in `shared/src/Entity/` exclusively.**
- Never create entity classes inside `backoffice/src/Entity/`, `superadmin/src/Entity/`, `cron/src/Entity/`, or `api/src/Entity/`.

### 3. Centralized Database Migrations
- **All database migrations run from `cron/`** (`cron/migrations/admin/` and `cron/migrations/client/`).
- `backoffice/migrations/` is empty and unused.
- Run migrations using custom commands:
  ```bash
  cd cron
  php8.5 bin/console app:migrations:migrate-admin [--dry-run]
  php8.5 bin/console app:migrations:migrate-tenants [--client-id=ID] [--dry-run]
  ```

### 4. Symfony 8 Baseline
- CLI binary is strictly **`php8.5`** (not `php`).
- Use PHP attributes for routing (`#[Route(..., methods: [...], options: ['expose' => true])]`) and security (`#[IsGranted(...)]`).
- Do not use legacy annotations, `getRequest()`, `kernel.root_dir`, or bundle notations (`Bundle:Section:view.html.twig`).
- Prefer constructor dependency injection and typed action arguments.

### 5. Legacy Reference (`../duell-pos`)
- The legacy monolith is located in sibling directory `../duell-pos`.
- Use it as the primary behavioral and data-contract reference when migrating controllers, queries, and business logic.
- Angular.js in legacy is rewritten to jQuery 3.7 + Bootstrap 5.3 in backoffice.

### 6. Build Loop & JS Route Sync
- Always dump JavaScript routes and build after changing `expose: true` routes:
  ```bash
  # Root helper
  ./bo-duell.sh              # cache clear + routes dump + webpack watch

  # Or manual steps
  php8.5 bin/console fos:js-routing:dump --format=json --target=public/js/routes.json
  npm run dev
  ```
- JS files import `../../public/js/routes.json` via `Routing.generate('route_name')`.
- All user-facing text must use `Translator.trans('key')` (BazingaJsTranslationBundle) and `messages.*.xliff` / `messages_*.json`.
