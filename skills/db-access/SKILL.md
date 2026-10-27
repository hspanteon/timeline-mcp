---
name: db-access
description: "DB credentials and structure for kasse_admin + all tenant kasse_client_* DBs. Reads credentials directly from the root .env file variables (ADMIN_DATABASE, CLIENT_DB_HOST_PRIMARY, CLIENT_DB_USER, CLIENT_DB_PASSWORD, CLIENT_DB_NAME) and runs read-only MySQL CLI queries. Use when Claude needs to query the local MySQL databases, look up a tenant DB name, check live table schema, or verify data."
argument-hint: "[database-name | query]"
---

# DB Access (Read-Only)

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: db-access`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

Use SELECT/SHOW/DESCRIBE/EXPLAIN only. Never run INSERT/UPDATE/DELETE/DROP/ALTER without explicit user permission.

## 1. Credentials from Root `.env`

Read database credentials **strictly from the repository root `.env` file** (`.env`).

**Hard rule:** Never read credentials from subfolder `.env` files (do not read `backoffice/.env`, `superadmin/.env`, `api/.env`, or `cron/.env`). Always use the root `.env`.

```env
ADMIN_DATABASE=kasse_admin
CREATE_DATABASE_FOR_CLIENT=true
CLIENT_DB_HOST_PRIMARY="127.0.0.1"
CLIENT_DB_NAME="kasse_client_2_v7"
CLIENT_DB_USER="helios"
CLIENT_DB_PASSWORD="helios"
CLIENT_DB_HOST_REPLICA="127.0.0.1"
CLIENT_DB_USER_REPLICA="helios"
CLIENT_DB_PASSWORD_REPLICA="helios"
```

Extract the following values:
- **Host:** `$CLIENT_DB_HOST_PRIMARY` (default: `127.0.0.1`)
- **User:** `$CLIENT_DB_USER`
- **Password:** `$CLIENT_DB_PASSWORD`
- **Admin DB:** `$ADMIN_DATABASE` (default: `kasse_admin`)
- **Default Client DB:** `$CLIENT_DB_NAME` (e.g. `kasse_client_2_v7`)

**Security rule:** Never print, echo, or copy raw password values into visible chat messages or committed docs.


## 2. Execute MySQL CLI Queries

Run queries with `mysql` using the extracted environment variables via `MYSQL_PWD`:

```bash
# General query format
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "$ADMIN_DATABASE" -e "<SQL_QUERY>"
```

### Admin DB — `kasse_admin`
Central DB managing all tenants, admin users, permissions, and system config:
```bash
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "$ADMIN_DATABASE" -e "<SQL_QUERY>"
```

### Default Client DB — `$CLIENT_DB_NAME`
Default dev/test tenant DB read from `.env` (`$CLIENT_DB_NAME`, e.g. `kasse_client_2_v7`):
```bash
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "$CLIENT_DB_NAME" -e "<SQL_QUERY>"
```

### Specific Tenant DB — `kasse_client_*`
Each tenant (client) has its own DB. Pattern: `kasse_client_<id>_<timestamp>` or `kasse_client_<id>`. Query via the resolved tenant DB name:
```bash
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "<tenant_db_name>" -e "<SQL_QUERY>"
```

## 3. Tenant → DB Mapping

Stored in `kasse_admin.client` table. Query it to discover any tenant's active database name:

```sql
SELECT client_id, client_name, database_name, database_hostname
FROM kasse_admin.client
WHERE is_active = 1 AND is_deleted = 0
ORDER BY client_id;
```

Key columns:
| Column | Description |
|---|---|
| `client_id` | Tenant ID |
| `client_name` | Tenant name |
| `database_name` | Actual DB name to connect to (`kasse_client_*`) |
| `database_hostname` | Host (usually `localhost` / `127.0.0.1`) |
| `database_username` | DB user for that tenant |
| `database_password` | DB password for that tenant |

### Lookup tenant DB by name or ID

```bash
# Lookup by client name
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "$ADMIN_DATABASE" -e "SELECT client_id, client_name, database_name FROM client WHERE client_name LIKE '%<search>%';"

# Lookup by client_id
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "$ADMIN_DATABASE" -e "SELECT client_id, client_name, database_name FROM client WHERE client_id = <id>;"
```

## 4. Schema & Live Data Inspection

Use these standard commands when inspecting live tables or checking if migrations landed:

```bash
# Check table structure
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "<db_name>" -e "DESCRIBE <table_name>;"

# Check indexes
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "<db_name>" -e "SHOW INDEX FROM <table_name>;"

# Explain query execution plan
MYSQL_PWD="$CLIENT_DB_PASSWORD" mysql -h "$CLIENT_DB_HOST_PRIMARY" -u "$CLIENT_DB_USER" "<db_name>" -e "EXPLAIN <query>;"
```

