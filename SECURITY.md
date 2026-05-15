# Security Report

Date: 2026-04-30

Scope: root Suvera storefront plus read-only review of the nested `panelya` repo. No real `.env` or local secret files were created or staged.

## Summary

- Critical findings: 0
- High findings fixed: 3
- Medium findings fixed: 4
- Remaining watch items: 3

## Applied Fixes

### High - Unsafe checkout redirect URL

- File: `suvera/siparis.html:333`
- Before: `result.paymentPageUrl` from the API was assigned directly to `window.location.href`.
- After: checkout only redirects to parsed `http:` or `https:` URLs.
- Why: blocks `javascript:`/`data:` redirect injection if an API response or integration payload is compromised.

### High - Unsafe dynamic link protocols

- Files: `suvera/js/storefront.js:23`, `suvera/js/site-pages.js:27`
- Before: collection links, favorite URLs, and tracking URLs were escaped but protocol-unvalidated.
- After: dynamic hrefs are allowed only when they parse as `http:`/`https:` or known relative site paths.
- Why: escaping prevents attribute breakouts, but protocol validation is needed to block clickable script URLs.

### High - Unbounded proxy request bodies

- Files: `suvera/api/[...path].js:3`, `suvera/dev-server.js:11`
- Before: proxy body buffering had no robust positive size limit.
- After: both proxies enforce bounded request bodies and return controlled errors for oversized input.
- Why: reduces denial-of-service memory risk.

### Medium - Local dev path traversal guard

- File: `suvera/dev-server.js:153`
- Before: local file serving used a string prefix check.
- After: it resolves the path and checks `path.relative` against the storefront root.
- Why: prevents sibling-directory prefix bypasses in the local API-connected server.

### Medium - Local proxy origin mismatch

- File: `suvera/dev-server.js:74`
- Before: local API smoke tests forwarded `Origin: http://127.0.0.1:4173` to the production Panelya API.
- After: localhost and Vercel preview hosts map to `https://suvera.com.tr`, matching the production storefront proxy.
- Why: keeps same-origin `/api` locally while satisfying the upstream CORS allow-list used by Panelya production.

### Medium - Missing baseline CSP hardening

- Files: `suvera/dev-server.js:13`, `suvera/vercel.json:54`
- Before: security headers lacked CSP directives.
- After: `base-uri 'self'; object-src 'none'; frame-ancestors 'self'` is sent locally and on Vercel.
- Why: adds protection that does not break the current inline-script static site.

### Medium - Unsafe asset URL schemes

- File: `suvera/js/api.js:146`
- Before: API-provided asset URLs allowed `data:` values.
- After: unknown explicit schemes, including `data:`, `javascript:`, and `file:`, are rejected before DOM insertion.
- Why: reduces XSS and local-file style injection surfaces in product/media content.

### Medium - Inline related-product navigation id injection

- File: `suvera/js/product-detail.js:413`
- Before: related product IDs were inserted into inline navigation without URL encoding.
- After: IDs are encoded with `encodeURIComponent`.
- Why: preserves navigation while preventing malformed IDs from altering the inline handler string.

## Watch List

- Medium: The static site still relies on inline scripts and inline event handlers, so a strict `script-src` CSP is not currently safe to enable. Move inline handlers into JS modules before tightening CSP.
- Medium: Suvera stores customer/session tokens in `localStorage`; this is common for this static architecture but increases impact if any XSS lands. Prefer httpOnly cookies if the deployment model changes.
- Low: Panelya nested repo appears to have production gates for mock payments, JWT secrets, CORS, authz, and tenant scoping. Keep running its own validation commands before changing it.

## Validation Plan

- Run `npm run check` in `C:\Users\Arat\Desktop\proje\suvera`.
- Run `npm run dev` in Suvera and test API-backed catalog/search/product/checkout paths through same-origin `/api`.
- Manual security probes: oversized proxy request expects `413`; `javascript:` dynamic link test should fall back; unsafe `paymentPageUrl` should not execute; encoded related product IDs should still open valid products.
