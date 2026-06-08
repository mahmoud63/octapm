# Octa PM Frontend

Octa PM frontend is a React + TypeScript dashboard for construction project management.
It is built with Vite, TanStack Router, TanStack Query, and a Shadcn-based component system.

## What This App Covers

- Authentication flows (sign in, sign up, token refresh handling)
- User management (engineer listing and account actions)
- Project management (list, create, edit, delete)
- Project detail with activities, materials, and equipment sections
- Shared dashboard shell with sidebar, command/search, and theme support

## Stack

- React 19 + TypeScript
- Vite
- TanStack Router
- TanStack Query
- Axios API client
- Shadcn UI + Tailwind CSS
- Zustand for auth/session state
- Zod + React Hook Form for validation

## Prerequisites

- Node.js 20+
- npm 10+
- Backend API running (default expected API base: http://localhost:5000/api/v1)

## Environment

Create a local env file in frontend:

```bash
cp .env.example .env
```

If .env.example does not exist, create .env with:

```bash
VITE_API_URL=http://localhost:5000/api/v1
```

## Development

From the frontend directory:

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Preview Production Build

```bash
npm run preview
```

## Important Paths

- src/routes: route definitions
- src/features: domain modules (auth, users, projects, activities, etc.)
- src/services: API clients and typed service wrappers
- src/components: reusable UI and layout components
- src/stores: global state (auth/session)

## Notes

- API responses are expected in envelope format:
  - success: { success: true, data: ... }
  - error: { success: false, error: { code, message } }
- Authenticated pages are guarded via route-level checks.
- Sidebar and page metadata are branded for Octa PM.
