# Superadmin App Reference

> Bundled snapshot of the duell-admin repo's `superadmin/CLAUDE.md`, carried by this plugin so superadmin-app context is available even in checkouts where that file is missing or stale. Treat the target repo's own `superadmin/CLAUDE.md` (if present) as authoritative over this copy.

This file covers the `superadmin/` app specifically. Read the target repo's root `CLAUDE.md` first for the monorepo-wide overview (multi-tenant DB design, legacy `../duell-pos` mapping, shared package, coding conventions) — this file only adds detail that's specific to this app and not worth duplicating there.

## Orientation: check which branch you're on before trusting what's on disk

`superadmin/` is a genuinely new app (ticket #5585) and, as of this writing, **its full source (`src/`, `config/`, `templates/`, `assets/`, `webpack.config.js`, `package.json`, `bin/console`) only exists on the unmerged branch `origin/5585-mega-superadmin`** — it is not present on `development`/`master` or on most feature branches cut from them. If you land in this directory on some other branch, `ls` may show only `composer.json`, `composer.lock`, `symfony.lock`, `.env`, `vendor/`, `node_modules/`, `var/`, and `public/build|bundles/` (leftover local scaffolding/build output, all untracked) with **no `src/`, `config/`, or `templates/`** — that is not a broken checkout, it means the real app isn't checked out here. Before assuming code described below is missing or needs to be written from scratch, check:

```bash
git ls-tree -r origin/5585-mega-superadmin --name-only | grep '^superadmin/'   # confirm the branch has it
git branch --show-current                                                       # confirm what you're actually on
```

If you need to read or modify the real source and it's not on your current branch, read it read-only with `git show origin/5585-mega-superadmin:superadmin/<path>`, or check out/merge that branch, rather than recreating it. Everything below describes that branch's content.

The local `.env` on disk (when present) contains real per-developer secrets (DB passwords, Keycloak client secrets, integration API keys) — it is intentionally untracked (`superadmin/.gitignore` excludes it); never print, log, or copy its contents into commits, docs, or chat.

## Commands

```bash
cd superadmin
composer install && npm install --legacy-peer-deps
npm run watch            # or: npm run dev / npm run build
php8.5 bin/console cache:clear
php8.5 bin/console fos:js-routing:dump --format=json --target=public/js/routes.json
./quick-clean.sh         # composer+npm install / cache-clear / routes-dump / watch loop, one command
```

No `tests/` directory exists yet (only an unused `App\Tests\` PSR-4 mapping in `composer.json`).

Database schema changes are made via `cron/migrations/admin/` and `cron/migrations/client/` (see root CLAUDE.md) — this app has no migrations directory of its own, even though it reads/writes the same admin + per-tenant client DBs.

## Architecture

### No BaseController

Unlike backoffice, there is **no shared `BaseController`** here. Every controller (`ClientController`, `PartnerController`, `AdminUserController`, etc.) extends `Symfony\Bundle\FrameworkBundle\Controller\AbstractController` directly and gets `EntityManagerInterface`, `TranslatorInterface`, `ValidatorInterface`, etc. via typed action arguments (autowired), not constructor injection into a shared parent. Don't go looking for `getClientEntityManager()`/`getAdminEntityManager()`-style helpers here — see the tenant pattern below instead.

### Two entity managers, resolved differently than backoffice

- `admin` EM (`Shared\Entity\Admin\*`) is the default entity manager, wired normally via `doctrine.yaml` and injected as `EntityManagerInterface`.
- `client` EM (`Shared\Entity\Client\*`) is **not** session/request-scoped the way backoffice's `TenantContext` is. Instead, `App\Service\TenantEntityManagerFactory::getEntityManager(Client $client)` opens a fresh connection *per call*, using that specific `Client` row's own stored `databaseHostname`/`databaseName`/`databaseUsername`/`databasePassword` (via `App\Service\TenantContext::setTenant()` → `App\DBAL\TenantAwareConnection::setTenantParams()` → `ManagerRegistry::resetManager('client')`). This exists for the client-edit page's Department/Licenses/Administrator/POS-machine tabs, where a superadmin operator can open any tenant's data by clicking into that client — there's no single "current tenant" for the whole request the way backoffice has. The `CLIENT_DB_HOST_PRIMARY`/`CLIENT_DB_NAME`/`CLIENT_DB_USER`/`CLIENT_DB_PASSWORD` env vars in `config/packages/doctrine.yaml` are structural placeholders only, needed for container compilation — real per-tenant credentials always override them before any actual query runs. Don't "simplify" this to backoffice's shared-credential model; it's an intentional legacy-parity choice (`../duell-pos`'s `getClientEntityManager($clientId)`).

### Auth: Keycloak only, real Passport-based

`App\Security\KeycloakAuthenticator` is the sole authenticator (`config/packages/security.yaml`, firewall `main`) — no `form_login`, no password fallback. Flow:

1. `GET /login` (`SsoController::login`) builds a PKCE URL via `KeycloakUtils` and redirects to Keycloak (profile forced to `'duell_admin'`, which `KeycloakUtils::getKeycloakConfig()` maps to `KEYCLOAK_ADMIN_CLIENT_ID`/`_SECRET` — the `duell-admin` Keycloak client — not the country-based `auth_client` backoffice/tenant login uses).
2. Keycloak redirects back to `GET /admin/sso/tenant-login` (route `app_sso_callback`). `SsoController::callback()` itself is dead code — `KeycloakAuthenticator::supports()` matches this route first and the authenticator intercepts before the controller body runs.
3. `KeycloakAuthenticator::authenticate()` validates the PKCE cache entry (`app.sso.pkce.cache`, a `FilesystemAdapter` pool — same service ID as backoffice's), exchanges the code for tokens, verifies the JWT (`KeycloakTokenVerifier`), requires the `duell_admin` realm role in `realm_access.roles`, then matches `AdminUser` **by `ssoId` only** (`findOneBy(['ssoId' => $keycloakUserId])`) — there is deliberately no auto-provisioning of a new `AdminUser` row on first login; accounts must already exist.
4. Returns a real `SelfValidatingPassport`, so `$this->getUser()`/`access_control` work normally in controllers (contrast with backoffice's `SsoController`, which hand-writes `session->set('authenticated', true)` instead of using an authenticator).

`GET /logout` and the callback route both throw `\LogicException` in their controller bodies by design — the firewall's logout listener and the authenticator intercept those routes before the controller runs; that's not a bug if you see it.

**Permission-check inconsistency to be aware of**: `security.yaml` has no `role_hierarchy` and no permission catalog exists yet, so almost every route is gated only by `access_control: { path: ^/, roles: IS_AUTHENTICATED_FULLY }` (see `ClientController::index()`'s own `TODO(#5585)` comment confirming this is intentional-for-now). However a few controllers (e.g. `PartnerController::addPartner/updatePartner/deletePartner`) already carry `#[IsGranted('ROLE_ADMIN_PARTNER_PROFILE_ADD')]`-style attributes referencing roles nothing currently grants — check `Shared\Entity\Admin\AdminUser::getRoles()` before assuming either pattern is authoritative when touching a controller you haven't read yet.

### Two data-binding styles coexist — check which one a controller uses before extending it

- **Symfony Form**: `PartnerController`, `SettingTemplateController`, `WhiteLabelSettingsController` use `App\Form\{PartnerType,SettingTemplateType,WhiteLabelSettingsType}` (`$this->createForm(...)`) for the edit-page GET, but their add/update POST actions still `json_decode($request->getContent(), true)` by hand and set entity fields manually rather than binding through the form — the Form class only renders initial values, it doesn't handle submission.
- **Manual JSON binding, no Form class**: `ClientController`, `AdminUserController`, `AdminUserGroupController`, `SalesUserController`, `SalesUserGroupController`, `ClientDepartmentController`, `ClientLicenseController`, `ClientManagerController`, `ClientPosMachineController` all decode the raw JSON body and map fields by hand; there's no corresponding `App\Form\*Type` for these at all. `Symfony\Component\Validator\Validator\ValidatorInterface` is still used directly against the entity in both styles.

### Modules, routes, and route-naming split

`templates/_sidebar.html.twig` is a static (server-rendered, no client router) left-nav mirroring `../duell-pos`'s `AdminBundle\Resources\views\topNavHeader.html.twig` structure. Implemented modules and their controllers:

| Sidebar group | Module | Controller(s) | Index route | Notes |
|---|---|---|---|---|
| Clients | Client list/add/edit | `ClientController` | `app_client_list` | Edit page (`app_client_edit`) has Department/Licenses/Administrator/POS-machine tabs backed by `ClientDepartmentController`, `ClientLicenseController`, `ClientManagerController`, `ClientPosMachineController` — these use the per-client tenant EM described above |
| White-label settings | White-label settings | `WhiteLabelSettingsController` | `admin_whitelabelsettings_index` | Route names keep the legacy `admin_*` prefix (parity naming), unlike the rest of the app |
| White-label settings | Partner | `PartnerController` | `app_partner_list` | Sub-actions (`add`/`edit`/`update`/`delete`/`get-data`) keep `admin_partner_*` names |
| White-label settings | Setting template | `SettingTemplateController` | `app_setting_template_list` | Sub-actions keep `admin_settingtemplate_*` names |
| Settings | Admin User / Admin User Group | `AdminUserController`, `AdminUserGroupController` | `app_admin_user_index`, `app_admin_user_group_index` | Fully `app_*`-named |
| Settings | Sales User / Sales User Group | `SalesUserController`, `SalesUserGroupController` | `app_sales_user_index`, `app_sales_user_group_index` | Fully `app_*`-named |

Routes not yet migrated render `templates/coming_soon.html.twig` — check `_sidebar.html.twig` before assuming a nav entry has a real controller behind it. `DefaultController` redirects unmatched `/` to `app_client_list` (there is no SPA shell/landing page the way `../duell-pos`'s AngularJS `index.html.twig` was). `HealthController` (`/health`, public) and `MeController` (`/whoami`, authenticated smoke-test returning the current `AdminUser`) exist purely as infrastructure/auth-plumbing checks, not real features.

### Frontend

- `assets/js/common.js` is **not** a full copy of backoffice's ~3000-line `common.js` — it's a trimmed port containing only `CommonTable` and its direct dependencies (`Loader`, `escapeHtml`) plus the mobile sidebar toggle. Port more of backoffice's `common.js` only when a page actually needs it; don't assume helpers present in backoffice's version exist here.
- One webpack entry per page in `webpack.config.js` (`app`, `clients`, `client-edit`, `white-label-settings`, `partner`, `setting-template`, `admin-users`, `admin-user-groups`, `sales-users`, `sales-user-groups`), same convention as backoffice — add a new entry when adding a new page's JS.
- `Routing.generate()` (FOSJsRoutingBundle) + `CommonTable` + `Select2` + `Translator.trans()` are used the same way as backoffice; JS routes are exposed via `routes_to_expose: ['app_*']` in `config/packages/fos_js_routing.yaml` — routes that keep legacy `admin_*` names (white-label settings, partner, setting-template sub-actions) still get `options: ['expose' => true]` individually and are exposed despite not matching the `app_*` glob, since FOSJsRouting unions explicit `expose: true` routes with the glob.
- `translations/` in this app is empty/gitignored (`translations/.gitignore`) — `TranslatorInterface` (standard Symfony, not backoffice's `Shared\Translator` decorator) only reads `../shared/translations`.
