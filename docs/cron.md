# Cron App Reference (`cron/`)

The `cron/` directory contains the scheduled task runner, background console commands, and the centralized database migration engine for Duell Admin.

---

## Technical Stack & Architecture

- **Framework**: Symfony 8.0 Console App, PHP 8.5 (`php8.5` binary)
- **Database Access**: Uses both `admin` and `client` Doctrine connections, sharing entities and repositories from `shared/src/`.
- **Primary Role**:
  1. Centralized runner for Doctrine database migrations (both shared admin DB and tenant DBs).
  2. Scheduled batch jobs, data synchronization, background imports, and XML/XLS exports.

---

## Database Migrations Engine

> [!IMPORTANT]
> All database migrations in the monorepo run from `cron/`, **not** from `backoffice/` (where `migrations/` is empty).

Migration files live in:
- `cron/migrations/admin/` (Namespace: `DoctrineMigrations\Admin`) — Changes to shared `kasse_admin` DB (clients, users, white-label settings).
- `cron/migrations/client/` (Namespace: `DoctrineMigrations\Client`) — Changes to tenant databases (`kasse_client_*`).

### Migration Commands

```bash
cd cron

# 1. Generate a new blank migration class
php8.5 bin/console doctrine:migrations:generate --namespace=DoctrineMigrations\\Admin
php8.5 bin/console doctrine:migrations:generate --namespace=DoctrineMigrations\\Client

# 2. Run migrations for Admin Database
php8.5 bin/console app:migrations:migrate-admin [--dry-run] [--down=VersionYYYYMMDDHHmmss]

# 3. Run migrations for Tenant Databases (iterates over all active clients)
php8.5 bin/console app:migrations:migrate-tenants [--client-id=ID] [--dry-run] [--down=VersionYYYYMMDDHHmmss]
```

### Writing Safe Migrations
Because tenants do not all migrate at the same moment, write migrations and the application code depending on them such that old and new schema states can temporarily coexist safely without downtime.

---

## Key Background Console Commands (`src/Command/`)

- **Data Imports**:
  - `ImportProdCommand`: High-volume product and inventory batch importer.
  - `ImportProductUnitBarcodeCommand`: Barcode and product unit mapper.
- **Data Exports**:
  - `XlsExportProductCommand`, `XlsExportStockCommand`, `XlsExportStockAllDepartmentCommand`: Excel export generation.
  - `XmlExportCustomerCommand`, `XmlExportInvoiceCommand`, `XmlExportZreportCommand`: Accounting XML exports.
- **Infrastructure & Storage**:
  - `MoveEntityUploadtoS3BucketCommand`, `MoveProductImportImagesToS3BucketCommand`: S3 cloud storage asset migration.
  - `BackfillManagerUsersToKeycloakCommand`: Keycloak SSO user account synchronization.
