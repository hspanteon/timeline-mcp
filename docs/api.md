# API App Reference (`api/`)

The `api/` directory is the dedicated REST API application for the Duell system.

---

## Technical Stack & Architecture

- **Framework**: Symfony 8.0, PHP 8.5
- **Design Goal**: Stateless REST API services for integrations, external clients, and mobile POS terminals.
- **Dependencies**: Depends on the centralized `shared/` package (`duell/shared`) for Doctrine entities, repositories, and shared services.

---

## Conventions & Rules

1. **Entities & Models**:
   - Must import entities from `Shared\Entity\Admin\` and `Shared\Entity\Client\`.
   - Do not define entity classes in `api/src/Entity/`.
2. **Response Shapes**:
   - API endpoints should return standardized JSON responses with consistent error structures, HTTP status codes, and pagination metadata.
3. **Authentication**:
   - Stateless authentication using JWT / Keycloak Bearer tokens.
