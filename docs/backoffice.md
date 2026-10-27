# Backoffice App Reference (`backoffice/`)

The `backoffice/` directory contains the main web administration interface of Duell Admin. Almost all day-to-day feature development occurs here.

---

## Technical Stack & Architecture

- **Framework**: Symfony 8.0, PHP 8.5 (`php8.5` binary)
- **Frontend**: Twig templates, jQuery 3.7, Bootstrap 5.3, Webpack Encore
- **Routing & i18n in JS**:
  - `FOSJsRoutingBundle`: Exposes routes with `options: ['expose' => true]`. Generated via `Routing.generate('route_name', params)`.
  - `BazingaJsTranslationBundle`: `Translator.trans('key')`
- **Authentication**: Keycloak SSO (`App\Security\KeycloakAuthenticator` / `SsoController`) with session fallback (`SessionUserProvider`).

---

## Controllers & BaseController

Most backoffice controllers (~100 controllers) extend `App\Controller\BaseController`:

- **Entity Manager Helpers**:
  - `$this->getClientEntityManager()` (or `getEntityManager()`) — tenant-specific client DB manager (`Shared\Entity\Client\*`).
  - `$this->getAdminEntityManager()` — shared admin DB manager (`Shared\Entity\Admin\*`).
- **Tenant Context**:
  - `setupTenantFromDatabase()`: Sets up the multi-tenant connection from session `tenant_id`.
- **Permissions**:
  - `getAllPermissions()`: Route `app_base_getallpermissions`. Cached on client side per page load.
- **Customer Integrations**:
  - `getAllCustomerIntegrations()`, `getCustomerIntegration()`: Single source of truth for customer integration entity lookups.
- **Injected Services**:
  - `AdminService`, `Translator`, `Logger`, `TokenStorage`, `Validator`, `HtmlSanitizer`, `CsrfValidatorService`, `MosquittoService`, `TenantContext`, `UserPasswordHasher`.

---

## Frontend Architecture & Assets

- **Webpack Entries**: Configured in `backoffice/webpack.config.js` (~80 entries). Each page has its own bundle. When creating a new page, add its entry point here and include it in Twig via `encore_entry_script_tags` and `encore_entry_link_tags`.
- **Shared Utilities (`assets/js/common.js`)**:
  - `CommonTable`: Reusable data table component supporting server-side pagination, search/filtering, sorting, column visibility, and checkbox selections.
  - `getPermissionData()`: Fetches user permissions and caches in cookies/global state.
  - `Loader.start()` / `Loader.stop()`: Global loading overlay.
  - `openModalById(id)` / `closeModalById(id)`: Bootstrap 5 modal helpers.

---

## Common Development Commands

```bash
cd backoffice

# Install dependencies
composer install && npm install

# Build assets
npm run dev            # Development build
npm run watch          # Watch mode with hot reload
npm run build          # Production webpack build

# Clear cache
php8.5 bin/console cache:clear

# Dump JavaScript routes (REQUIRED after adding/updating routes with expose=true)
php8.5 bin/console fos:js-routing:dump --format=json --target=public/js/routes.json
```

---

## Key Gotchas

1. **JS Routes Dump**: `assets/js/app.js` imports `../../public/js/routes.json`. Always dump to `public/js/routes.json` and run `npm run dev` after changing route attributes. The legacy `assets/js/fos_js_routes.json` is unused.
2. **CSRF Tokens**: All AJAX POST requests must include valid CSRF tokens.
3. **Tenant Context**: Always verify tenant initialization before querying client repositories.
