# Suvera Storefront

Public Suvera e-commerce storefront managed from Panelya.

This project is intentionally separate from the Panelya operations panel. Panelya owns the API, products, content, orders and customers; Suvera is the public storefront that reads and writes data through that API.

## Deploy

Deploy this directory as a separate Vercel project.

- Source of truth: `C:\Users\Arat\Desktop\proje\suvera`
- Root Directory: `.`
- Framework Preset: Other
- Build Command: leave empty
- Output Directory: `.`
- Install Command: leave empty

## API Connection

The storefront reads catalog, content, cart/order and payment data from Panelya API.

`js/config.js` uses the same-origin `/api` path. The local `api/[...path].js` Vercel function proxies that path to the live Panelya API, so the browser stays on the Suvera domain:

```js
window.PANELYA_API_BASE = window.PANELYA_API_BASE || "/api";
window.SUVERA_API_BASE = window.PANELYA_API_BASE;
```

The Panelya workspace slug for this storefront is `suvera`.

For local API-connected testing, run the project through Vercel dev or another static server that also proxies `/api/*` to Panelya API. Opening the HTML with a plain static server is useful for layout checks, but API-backed catalog and checkout calls need the proxy.

## Local Development

Run the built-in dependency-free dev server:

```bash
npm run dev
```

It serves the storefront at `http://127.0.0.1:4173` and proxies `/api/*` to Panelya API. You can override the upstream with:

```bash
UPSTREAM_API=http://localhost:3000/api npm run dev
```

For API-backed catalog, checkout and order tracking, also provide the Suvera workspace public access token:

```powershell
$env:SUVERA_PUBLIC_ACCESS_TOKEN="..."
npm run dev
```

## Production checklist

- Keep the Vercel `api/[...path].js` proxy route active for the storefront.
- Add `SUVERA_PUBLIC_ACCESS_TOKEN` to the Vercel project environment variables.
- Set `UPSTREAM_API` if the storefront should proxy to a custom Panelya API domain.
- Add final admin/API domains to Panelya settings when custom domains are ready.
- When a custom API domain is ready, update `js/config.js`.
- Keep Panelya admin/dashboard deployment separate from this storefront.
- Verify `anasayfa`, `urunler`, `js/storefront.js` and `js/site-pages.js` are deployed together.
- Run end-to-end checks for slider, campaigns, collection filters, checkout, thank-you and order tracking flows.

See also: `DEPLOY-CHECKLIST.md`
