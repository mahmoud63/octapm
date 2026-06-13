# PMcopilots API Docs

The public REST API is published through the backend Swagger/OpenAPI routes:

- Swagger UI: `/api/v1/docs`
- OpenAPI JSON: `/api/v1/openapi.json`
- Legacy Swagger UI alias: `/api/docs`

Use `/api/v1/` as the base path for all clients. The API uses JWT bearer access tokens for most endpoints and a refresh cookie for session refresh.

Before publishing a release candidate, run:

```bash
npm run openapi:validate --workspace=backend
```

See `docs/help-center/api-docs.md` for the API consumer guide and `docs/api/mobile-site-reporting.md` for the mobile site reporting supplement.
