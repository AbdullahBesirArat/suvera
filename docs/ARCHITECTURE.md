# Suvera storefront - architecture, local setup and release notes

Suvera is a static HTML/CSS/JS storefront. All data comes from the Panelya multi-tenant API (Node/Express,
raw `pg`, PostgreSQL with row-level security). The browser never talks to Panelya directly: it calls same-origin
`/api/*`, which a thin proxy forwards.

## System overview

```mermaid
flowchart LR
  B[Browser<br/>static pages + JS] -->|same-origin /api/*| P[Vercel serverless proxy<br/>(catch-all /api route)]
  P -->|public access token +<br/>validated Idempotency-Key| A[Panelya API<br/>Express + JWT/RBAC]
  A -->|tenant-scoped<br/>set_config + FORCE RLS| D[(PostgreSQL)]
  A -->|derivatives: thumbnail, card, detail| S[(Object storage<br/>S3-compatible)]
  A -.->|reservation expiry worker<br/>off by default| D
```

Trust boundaries: browser -> proxy (same-site check, header allow-list), proxy -> API (public access token,
`Origin` must be in the API CORS allow-list), API -> database (every tenant query runs with the tenant context
set inside the transaction; tables use FORCE RLS), API -> storage (credentials only in the API environment).

## Checkout and idempotency

```mermaid
sequenceDiagram
  participant U as Browser
  participant X as Proxy
  participant A as Panelya API
  participant D as PostgreSQL
  U->>U: fingerprint = SHA-256(whole order request + gift selection)
  U->>U: key = stored key for this fingerprint, else new UUID (persist + read back)
  Note over U: crypto or storage unavailable -> stop before sending, Turkish error
  U->>X: POST /api/orders + Idempotency-Key
  X->>A: forward the key (POST orders / payment/initialize only, format-checked)
  A->>D: replay lookup by (tenant, key); compare request fingerprint
  alt first request
    A->>D: create order, reserve stock, store fingerprint
    A-->>U: order created
  else exact retry
    A-->>U: stored order (idempotentReplay)
  else same key, different request
    A-->>U: 409 IDEMPOTENCY_KEY_REUSED
  end
  U->>U: success clears the stored key; errors and timeouts keep it for the retry
```

Client rules (`siparis.html`): only a SHA-256 digest is stored in `sessionStorage` (never phone, address or tax id);
keys come from `crypto.randomUUID()` (no `Math.random` fallback); if the key cannot be persisted and read back the
order is not sent, because a retry with a different key could duplicate an order that the server already accepted.

## Local setup (Windows, PowerShell)

Requirements: Node 24, npm, Docker Desktop (for the isolated test stack).

```powershell
npm ci
npm run check            # build, performance budget, syntax
npm test                 # build + unit tests
npx playwright install chromium
npx playwright test      # E2E on a disposable PostgreSQL + local Panelya API (mock payments)
```

`npm run dev` needs `UPSTREAM_API` (see `.env.example`). It refuses to start without it, and a non-loopback upstream
requires `ALLOW_REMOTE_UPSTREAM=1`, so local development can never silently write to production data.

## Test matrix

| Layer | Command | Scope |
|---|---|---|
| Unit / static | `node --test js/*.test.js` | proxy header rules, dev-upstream guard, checkout key and fingerprint behaviour, address-book readiness, CSP drift, build |
| Build gates | `npm run check` | page build, performance budget, `node --check` of shipped scripts |
| E2E | `npx playwright test` | storefront, cart, checkout, address book, accessibility, CSP, security headers, tenant isolation (disposable stack, mock payments) |
Coverage percentages are not claimed. Real checkout/payment against production is intentionally not tested.

## Threat model (short)

| Asset | Threat | Mitigation | Residual |
|---|---|---|---|
| Orders | duplicate or stale-replayed order after a lost response | client fingerprint + key; server stores a request fingerprint and answers 409 on mismatch | pre-073 rows replay (documented) |
| Customer data | PII persisted in the browser or logs | digest-only `sessionStorage`; no payload logging; header forwarded only on two POST routes | none known |
| Tenants | cross-tenant access | FORCE RLS, tenant context per transaction, tenant-bound keys | system-pool paths are explicit and reviewed |
| Production data | local development hitting production | `UPSTREAM_API` required, loopback-only by default | opt-in flag exists |
| Supply chain | vulnerable dependencies | audit ledger, lockfiles per deployable | 5 moderate advisories documented |

## Release notes

Deployed (Suvera `main` at `ea245c5`): R9 `Idempotency-Key` forwarding; R1 fail-closed dev proxy; checkout
fingerprint, secure keys and fail-closed behaviour.
Locally ready, not deployed: address-book readiness fix (this change set); Panelya request-fingerprint idempotency
(migration 073), dependency security updates, CORS denial as 403 and the expiry-worker readiness tests.
The Panelya expiry worker stays disabled in production.
