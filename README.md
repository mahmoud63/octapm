# PMcopilots / OCTAPM

AI-assisted construction project management platform for activity-linked schedule,
cost, commercial, quality, document-control, and field workflows.

## Toolchain

Use the repository-pinned Node.js version in `.nvmrc`.

- Node.js: `24.14.0`
- npm: `11.9.0`

Recommended setup:

```bash
nvm install
nvm use
npm ci
```

On Windows without `nvm`, install Node.js `24.14.0` from the official Node.js
distribution and verify:

```bash
node --version
npm --version
```

## Local Release Gates

Run these from the repository root before certifying a release baseline:

```bash
npm run prisma:validate --workspace=backend
npm run openapi:validate --workspace=backend
npm test --workspace=backend -- --forceExit
npm run lint --workspace=frontend
npm run build --workspace=frontend
npm run security:validate:secret-hygiene
npm run security:validate:private-storage
npm run infra:validate:api-origin
npm run infra:validate:rds-backups
npm run infra:validate:deployment-readiness
npm run test:e2e:uat:validate
```

The UAT validation command checks the UAT suite definition only. A controlled
pilot also requires live browser UAT evidence, backup/restore evidence, rollback
evidence, and monitoring/alert evidence for the exact release commit.

## Development

```bash
npm run dev
```

Or run workspaces separately:

```bash
npm run dev --workspace=backend
npm run dev --workspace=frontend
```

Runtime `.env` files, uploads, logs, PID files, generated evidence, and local
storage folders must remain untracked.
