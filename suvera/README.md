# Suvera Storefront

## Project Title

Suvera Storefront

## Short Description

Suvera is a customer-facing e-commerce storefront built with static HTML, CSS and JavaScript. It consumes catalog, content, customer, order and checkout data from the Panelya API through a same-origin `/api` proxy.

## Key Features

- Static storefront pages for home, catalog, product detail, cart, checkout, account and order tracking.
- Panelya API integration with organization slug `suvera`.
- Product listing, product detail, favorites, cart state and customer checkout flows.
- iyzico-ready card payment flow plus manual payment support.
- Same-origin `/api` proxy for browser API calls and customer session cookies.
- Dynamic sitemap route, clean URLs, Open Graph metadata and JSON-LD SEO helpers.
- Vercel-ready routing, security headers and immutable asset caching.

## Tech Stack

- HTML, CSS and vanilla JavaScript
- Node.js local dev server
- Vercel serverless functions for API proxy and sitemap
- Panelya REST API integration
- iyzico payment flow via the Panelya backend

## Architecture / Folder Structure

```text
suvera/
|-- api/                 # Vercel proxy and dynamic sitemap functions
|-- assets/              # Public brand/editorial assets
|-- css/                 # Page-specific styles
|-- js/                  # API client, cart, SEO and page behavior
|-- *.html               # Static storefront pages
|-- dev-server.js        # Local static server with /api proxy
|-- vercel.json          # Clean URLs, rewrites and security headers
`-- .env.example         # Safe local env template
```

## Installation

```bash
npm install
```

## Environment Variables

Create a local `.env` only for development if needed. Do not commit real values.

```bash
UPSTREAM_API=https://panelya-api.example.com/api
SUVERA_PUBLIC_ACCESS_TOKEN=replace_with_public_storefront_access_token
SUVERA_SITE_ORIGIN=http://localhost:4173
SUVERA_ORGANIZATION_SLUG=suvera
HOST=127.0.0.1
PORT=4173
MAX_PROXY_BODY_BYTES=1048576
```

`js/config.js` keeps browser API calls on same-origin `/api`:

```js
window.PANELYA_API_BASE = window.PANELYA_API_BASE || "/api";
window.SUVERA_API_BASE = window.PANELYA_API_BASE;
```

## Running Locally

```bash
npm run dev
```

The dev server serves the storefront at `http://127.0.0.1:4173` and proxies `/api/*` to the configured Panelya API.

## Available Scripts

```bash
npm run dev
npm run check
```

## Deployment

Deploy this directory as a separate Vercel project:

- Root Directory: `suvera`
- Framework Preset: Other
- Build Command: leave empty
- Output Directory: `.`
- Install Command: `npm install`

Required Vercel environment variables:

- `SUVERA_PUBLIC_ACCESS_TOKEN`
- `UPSTREAM_API` if the proxy should target a custom Panelya API URL
- `SUVERA_SITE_ORIGIN` for canonical sitemap URLs
- `SUVERA_ORGANIZATION_SLUG=suvera`

Keep the Panelya dashboard/API deployment separate from the Suvera storefront deployment.

## Screenshots

Add screenshots before publishing:

- Home page
- Product listing
- Product detail
- Cart and checkout
- Order tracking

## Live Demo

- Storefront: `TODO`

## Author

Arat - Junior Full-Stack Developer
