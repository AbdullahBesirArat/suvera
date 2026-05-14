# Optimization Report

Date: 2026-04-30

Scope: root Suvera storefront plus a read-only check of the nested `panelya` repo. Panelya code was not changed because it is a separate gitlink and its nested worktree is clean.

## Summary

- Current optimization health: Medium.
- Applied high-impact fixes: short-lived GET dedupe, fewer duplicate product requests, API-side supported catalog/search filters, bounded proxy request bodies, optimized hero image variants, local asset cache headers, and lower localStorage parsing cost.
- Remaining larger work: full server-side facets/sort/pagination, responsive image variants, script splitting, and streaming large upstream proxy responses.

## Applied Fixes

### High - Duplicate catalog API requests

- Files: `suvera/js/api.js:11`, `suvera/js/storefront.js:282`
- Before: page renderers independently called `/api/products` for grids and featured strips.
- After: `SuveraAPI.request` dedupes short-lived GETs and `renderFeaturedStrip` can reuse an already-loaded product array.
- Why: removes repeated requests during one page load and reduces storefront/API latency.

### High - Browser-only catalog/search filtering

- Files: `suvera/js/storefront.js:373`, `suvera/js/site-pages.js:563`
- Before: catalog/search pages fetched broad product lists and filtered everything in the browser.
- After: supported `q` and `category_id` filters are pushed into the Panelya products API before client-side facets run.
- Why: reduces payload size and client work while preserving existing color/size/price filtering behavior.

### High - Unbounded proxy body buffering

- Files: `suvera/api/[...path].js:3`, `suvera/dev-server.js:11`
- Before: proxied request bodies were buffered without a byte limit, and invalid env input could leave the limit ineffective.
- After: both production proxy and local dev proxy enforce a positive `MAX_PROXY_BODY_BYTES` limit, defaulting to 1 MB.
- Why: limits memory pressure from large or abusive requests.

### Medium - Favorite button refresh cost

- File: `suvera/shared.js:257`
- Before: each favorite button refresh could parse and scan localStorage repeatedly.
- After: favorites are loaded once per refresh and compared through a `Set`.
- Why: cuts main-thread work on product grids.

### Medium - Account order lookup fan-out

- File: `suvera/js/site-pages.js:190`
- Before: local order history lookups used unbounded `Promise.all`.
- After: lookup input is capped and fetched with concurrency 4.
- Why: prevents bursty API traffic from corrupted/imported localStorage.

### Low - Static media cache headers

- Files: `suvera/dev-server.js:170`, `suvera/vercel.json:20`, `suvera/vercel.json:29`
- Before: image/static media cache policy was implicit.
- After: `/assets/*` and `/uploads/*` receive immutable cache headers.
- Why: improves repeat visits and CDN behavior without long-caching HTML/JS/CSS.

### Medium - Large editorial PNG transfer

- Files: `suvera/index.html:163`, `suvera/index.html:341`, `suvera/index.html:517`, `suvera/assets/suvera-istanbul-editorial-1200.avif`, `suvera/assets/suvera-istanbul-editorial-1200.webp`, `suvera/assets/suvera-istanbul-editorial-800.avif`, `suvera/assets/suvera-istanbul-editorial-800.webp`
- Before: first-viewport and editorial backgrounds referenced the 2.0 MB PNG directly.
- After: CSS `image-set` serves AVIF/WebP variants with the PNG preserved as fallback.
- Why: cuts the main editorial image transfer to about 21-53 KB on modern browsers.

## Watch List

- Medium: color/size/price facets still need browser-side filtering; add API facet metadata and DB indexes before removing the client fallback.
- Medium: proxy upstream responses are still buffered in parts of the local/prod proxy flow; streaming should be added with runtime-specific tests.
- Low: frontend helper duplication (`money`, `escapeHtml`, asset URL helpers) remains across page modules.
- Low: Panelya nested repo contains a tracked `apps/web/tsconfig.tsbuildinfo`; do not stage new generated cache files.

## Validation Plan

- Required Suvera check: `npm run check` from `C:\Users\Arat\Desktop\proje\suvera`.
- API-connected checkout/catalog smoke: set `SUVERA_PUBLIC_ACCESS_TOKEN` in the local process environment, run `npm run dev` from `C:\Users\Arat\Desktop\proje\suvera`, then test home products, `urunler.html`, `arama.html`, `urun.html`, cart, checkout init, and order tracking through same-origin `/api`.
- Metrics to compare before/after: duplicate `/api/products` count, transferred KB, product grid render time after filters, favorite refresh time on 50+ cards, and `413` behavior for oversized proxy bodies.
