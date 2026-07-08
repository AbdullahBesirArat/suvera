# Panelya and Suvera Commerce Platform

## Short Description

A full-stack commerce portfolio project that combines Panelya, a multi-tenant SaaS operations platform, with Suvera, a customer-facing e-commerce storefront powered by the Panelya API.

## Key Features

- Multi-tenant SaaS operations dashboard for products, orders, customers, content, teams and analytics.
- Node.js / Express REST API with PostgreSQL persistence, JWT authentication, RBAC and tenant isolation.
- Customer-facing Suvera storefront with product listing, product detail, cart, checkout, account and order tracking.
- Panelya API integration through same-origin `/api` proxy routes for the storefront.
- Customer session cookies, favorites, dynamic sitemap, Open Graph metadata, JSON-LD and clean URLs.
- iyzico-ready payment flow, manual payment support and payment callback handling.
- Production-oriented setup with Vercel, Railway, Swagger docs and deployment checklists.
- Security-minded defaults for environment handling, API proxying, rate limits and deployment headers.

## Tech Stack

- Frontend dashboard: Next.js, React, TypeScript, Tailwind CSS, React Query, Zustand.
- Storefront: Static HTML, CSS and vanilla JavaScript.
- Backend: Node.js, Express, PostgreSQL, JWT, Swagger/OpenAPI.
- Payments: iyzico integration path plus local/mock payment modes.
- DevOps: Vercel and Railway.

## Architecture / Folder Structure

```text
.
|-- panelya/                 # Separate nested repository for the SaaS platform
|   |-- apps/web/            # Next.js / TypeScript operations dashboard
|   |-- panelya-api/         # Express REST API, PostgreSQL layer, auth and payments
|   `-- docs/                # Deployment and verification notes
|-- api/                     # Suvera Vercel proxy and dynamic sitemap functions
|-- assets/                  # Public storefront assets
|-- css/                     # Page-specific storefront styles
|-- js/                      # Storefront API, cart, SEO and page logic
|-- *.html                   # Static storefront pages
|-- tools/                   # Local project utilities
|-- OPTIMIZATIONS.md         # Optimization audit notes
`-- SECURITY.md              # Security review notes
```

Panelya and Suvera are deployed separately. Suvera browser calls intentionally keep using same-origin `/api` unless the deployment plan explicitly changes the proxy.

## Installation

Install dependencies inside each deployable workspace:

```bash
npm install

cd panelya
npm install
```

## Environment Variables

Never commit real `.env` files. Use example files as templates:

- `.env.example`
- `panelya/apps/web/.env.example`
- `panelya/panelya-api/.env.example`
- `panelya/panelya-api/.env.production.example`

Suvera local storefront variables:

```bash
UPSTREAM_API=https://panelya-api.example.com/api
SUVERA_PUBLIC_ACCESS_TOKEN=replace_with_public_storefront_access_token
SUVERA_SITE_ORIGIN=http://localhost:4173
SUVERA_ORGANIZATION_SLUG=suvera
HOST=127.0.0.1
PORT=4173
MAX_PROXY_BODY_BYTES=1048576
```

Production secrets such as database URLs, JWT secrets, payment keys, callback secrets and email API keys must be configured only in the hosting provider.

`js/config.js` keeps browser API calls on same-origin `/api`:

```js
window.PANELYA_API_BASE = window.PANELYA_API_BASE || "/api";
window.SUVERA_API_BASE = window.PANELYA_API_BASE;
```

## Running Locally

Run the Suvera storefront with its local API proxy:

```bash
npm run dev
```

Run Panelya API and dashboard in separate terminals:

```bash
cd panelya
npm run dev:api
npm run dev:web
```

## Available Scripts

Suvera:

```bash
npm run dev
npm run check
```

Panelya:

```bash
npm run check:api
npm run lint:web
npm run typecheck:web
npm run build:web
npm run db:migrate
npm run demo:seed
npm run suvera:seed
npm run smoke:auth
npm run smoke:payment
```

## Deployment

- Suvera storefront: deploy this repository root as the `suvera-web` Vercel static project.
- Panelya dashboard: deploy `panelya/apps/web/` to Vercel as `panelya-web`.
- Panelya API: deploy `panelya/panelya-api/` or the Panelya root API start scripts to Railway.
- Database: provision PostgreSQL and run migrations before deploying API code that depends on new database objects.

Required Suvera Vercel environment variables:

- `SUVERA_PUBLIC_ACCESS_TOKEN`
- `UPSTREAM_API` if the proxy should target a custom Panelya API URL
- `SUVERA_SITE_ORIGIN` for canonical sitemap URLs
- `SUVERA_ORGANIZATION_SLUG=suvera`

Keep the Panelya dashboard/API deployment separate from the Suvera storefront deployment.

## Author

Arat - Junior Full-Stack Developer
