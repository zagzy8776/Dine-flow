# DineFlow

Production-ready table ordering and kitchen workflow app for:

- **Frontend:** Vercel
- **Backend:** Render
- **Database:** Neon PostgreSQL

## Architecture

- `src/` - Vite + React frontend
- `server/` - Node backend API for Render
- `database/schema.sql` - Neon PostgreSQL schema + demo seed

The frontend runs in two modes:

- **API mode** when `VITE_API_BASE_URL` is set
- **Demo mode** fallback using browser localStorage when no API URL is provided

## Features

- Guest table ordering
- Menu browsing by category
- Cart with quantity and notes
- Kitchen order board
- Admin menu and table management
- Staff sign-in using backend session cookies
- Neon-backed order, menu, table, and staff data

## Local development

### 1. Install dependencies

```bash
cd C:\Users\ZAGZY\Desktop\eatery-ordering-mvp
npm install
cd server
npm install
cd ..
```

### 2. Configure environment

Use `.env.example` as your reference.

Frontend:

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_EATERY_SLUG=demo-eatery
VITE_EATERY_NAME=Demo Eatery
```

Backend:

```env
DATABASE_URL=your_neon_connection_string
FRONTEND_ORIGIN=http://localhost:5173
```

### 3. Set up Neon

1. Create a Neon project.
2. Open the SQL editor.
3. Run `database/schema.sql`.

This creates:

- eateries
- tables
- menu items
- orders
- order items
- staff members
- staff sessions

Demo staff accounts seeded by the schema:

- `owner@demo-eatery.com` / `ChangeMe123!`
- `kitchen@demo-eatery.com` / `ChangeMe123!`

### 4. Run locally

Frontend:

```bash
npm run dev
```

Backend:

```bash
npm run server:dev
```

Open:

```text
Frontend: http://localhost:5173
Backend health: http://localhost:4000/healthz
```

## App routes

```text
Guest ordering:
http://localhost:5173/?view=customer

Kitchen board:
http://localhost:5173/?view=kitchen

Owner dashboard:
http://localhost:5173/?view=admin

Example table link:
http://localhost:5173/?view=customer&table=table-1
```

## Deploy to Vercel

Use the repository root for Vercel.

Recommended settings:

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Set Vercel environment variables:

```env
VITE_API_BASE_URL=https://your-render-service.onrender.com
VITE_EATERY_SLUG=demo-eatery
VITE_EATERY_NAME=Demo Eatery
```

`vercel.json` includes:

- SPA rewrites
- baseline security headers

## Deploy to Render

Use the `server/` folder for the backend service.

Recommended settings:

```text
Runtime: Node
Root Directory: server
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
```

Render environment variables:

```env
DATABASE_URL=your_neon_connection_string
FRONTEND_ORIGIN=https://your-vercel-project.vercel.app
NODE_ENV=production
```

`render.yaml` is included for Blueprint deployment.

## Neon notes

- Never expose `DATABASE_URL` in the frontend.
- Keep `DATABASE_URL` only in Render or another trusted server environment.
- Run schema updates directly in Neon or through your migration workflow.

## Quality checks

Frontend:

```bash
npm run typecheck
npm run lint
npm run build
```

Backend smoke check:

```bash
cd server
node index.js
```

## Production readiness covered in this setup

- Dedicated backend for database access
- Frontend decoupled from database credentials
- Render-ready API health endpoint
- Vercel-ready SPA deployment config
- Staff session auth via HttpOnly cookies
- CORS controlled by `FRONTEND_ORIGIN`
- Neon schema with staff/session tables and demo seed

## Recommended next upgrades

- Add rate limiting on login and order submission
- Add audit logs for admin actions
- Add QR code generation for tables
- Add order history filters and exports
- Add password reset flow
- Add monitoring and alerting on Render and Neon