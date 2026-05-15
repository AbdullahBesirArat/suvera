# Panelya and Suvera Commerce Platform

## Short Description

A full-stack commerce portfolio project that combines Panelya, a multi-tenant SaaS operations platform, with Suvera, a customer-facing e-commerce storefront powered by the Panelya API.

## Key Features

- Multi-tenant SaaS operations dashboard for products, orders, customers, content, teams and analytics.
- Node.js / Express REST API with PostgreSQL persistence, JWT authentication, RBAC and tenant isolation.
- Customer-facing Suvera storefront with product listing, product detail, cart, checkout and order tracking.
- Panelya API integration through same-origin `/api` proxy routes for the storefront.
- iyzico-ready payment flow, manual payment support and payment callback handling.
- SEO-focused storefront pages with sitemap, Open Graph metadata, JSON-LD and clean URLs.
- Production-oriented setup with Docker, GitHub Actions, Vercel, Railway, Swagger docs and Prometheus-style metrics where available.
- Security-minded defaults for environment handling, API proxying, rate limits and deployment headers.

## Tech Stack

- Frontend dashboard: Next.js, React, TypeScript, Tailwind CSS, React Query, Zustand.
- Storefront: Static HTML, CSS and vanilla JavaScript.
- Backend: Node.js, Express, PostgreSQL, JWT, Swagger/OpenAPI.
- Payments: iyzico integration path plus local/mock payment modes.
- DevOps: Docker Compose, GitHub Actions, Vercel and Railway.

## Architecture / Folder Structure

```text
.
|-- panelya/                 # Separate nested repository for the SaaS platform
|   |-- apps/web/            # Next.js / TypeScript operations dashboard
|   |-- panelya-api/         # Express REST API, PostgreSQL layer, auth and payments
|   `-- docs/                # Deployment and verification notes
|-- suvera/                  # Public storefront source tracked by this root repo
|   |-- api/                 # Vercel proxy and dynamic sitemap functions
|   |-- assets/              # Public storefront assets
|   |-- css/                 # Page-specific styles
|   |-- js/                  # Storefront API, cart, SEO and page logic
|   `-- *.html               # Static storefront pages
|-- tools/                   # Local project utilities
|-- OPTIMIZATIONS.md         # Optimization audit notes
`-- SECURITY.md              # Security review notes
```

Panelya and Suvera are deployed separately. Suvera browser calls intentionally keep using same-origin `/api` unless the deployment plan explicitly changes the proxy.

## Installation

Install dependencies inside each deployable workspace:

```bash
cd suvera
npm install

cd ../panelya
npm install
```

## Environment Variables

Never commit real `.env` files. Use the example files as templates:

- `suvera/.env.example`
- `panelya/apps/web/.env.example`
- `panelya/panelya-api/.env.example`
- `panelya/panelya-api/.env.production.example`

Production secrets such as database URLs, JWT secrets, payment keys, callback secrets and email API keys must be configured only in the hosting provider.

## Running Locally

Run the Suvera storefront with its local API proxy:

```bash
cd suvera
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

- Suvera storefront: deploy `suvera/` as a separate Vercel static project (root directory: `suvera/`).
- Panelya dashboard: deploy `panelya/apps/web/` to Vercel.
- Panelya API: deploy `panelya/panelya-api/` to Railway or another Node.js host.
- Database: provision PostgreSQL and run migrations before deploying API code that depends on new database objects.

## Author

Arat - Junior Full-Stack Developer
