# Shared Package Reference (`shared/`)

The `shared/` directory is a central shared PHP library (`duell/shared`) loaded as a **Composer path repository** (`../shared`) by `backoffice/`, `superadmin/`, and `cron/`.

Because it is loaded as a local path repository, any modifications to classes or translations in `shared/` take effect immediately across all apps without running `composer update`.

---

## Structure & Namespace Layout

```
shared/
├── src/
│   ├── Entity/
│   │   ├── Admin/         # Shared admin DB entities (~28 entities)
│   │   └── Client/        # Per-tenant client DB entities (~300 entities)
│   ├── Repository/
│   │   ├── Admin/         # Centralized admin repositories
│   │   └── Client/        # Centralized tenant repositories
│   ├── Service/           # Core shared services
│   ├── Translation/       # Translator service & decorators
│   ├── Utils/             # Common helper utilities & formatters
│   └── Helper/            # Utility helpers
└── translations/          # Master translation files
    ├── messages.en.xliff  # English (PHP/Twig)
    ├── messages.no.xliff  # Norwegian (PHP/Twig)
    ├── messages_en.json   # English (JS Translator)
    └── messages_no.json   # Norwegian (JS Translator)
```

---

## Entity Placement Rule

> [!IMPORTANT]
> **All Doctrine entity classes MUST reside in `shared/src/Entity/`.**
> Never create entity classes inside `backoffice/src/Entity/`, `superadmin/src/Entity/`, `cron/src/Entity/`, or `api/src/Entity/`. PreToolUse quality hooks actively enforce this boundary.

- **`Shared\Entity\Admin\*`**: Mapped to the `admin` entity manager and the shared `kasse_admin` DB (e.g., `Client`, `AdminUser`, `AdminUserGroup`, `WhiteLabelSetting`, `Partner`).
- **`Shared\Entity\Client\*`**: Mapped to the `client` entity manager and tenant databases (`kasse_client_*`) (e.g., `Product`, `Order`, `Invoice`, `Customer`, `Department`, `Employee`).

---

## Centralized Repositories (`shared/src/Repository/`)

- All business queries, custom DQL, and data retrieval functions must be placed in `shared/src/Repository/` rather than individual application directories.
- Repositories are extending `Doctrine\ORM\EntityRepository`. When modernizing legacy queries:
  - Preserve result shapes (keys, associative arrays) expected by existing controller actions.
  - Maintain type safety and explicit parameter bindings.
  - Do not introduce breaking schema changes or silently alter query pagination logic.

---

## Core Shared Services (`shared/src/Service/`)

- **`AdminService`**: Operations and queries on the shared admin database.
- **`ClientReadService` / `ClientWriteService`**: Standard read and write abstractions on tenant databases.
- **`CsrfValidatorService`**: Unified CSRF token verification across endpoints.
- **`MosquittoService`**: MQTT broker communication for POS terminal sync.
- **`UploadService`**: File upload handler and cloud storage dispatcher.
- **`Translator`**: Translation decorator providing unified i18n access.
