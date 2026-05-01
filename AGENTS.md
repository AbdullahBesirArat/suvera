# AGENTS.md

## Must-follow constraints

- `panelya` is a separate nested repo/gitlink; read and obey `panelya/AGENTS.md` before editing anything under it.
- Do not commit real `.env` files or local secrets. Keep only examples tracked.
- Keep the Suvera storefront deployment separate from the Panelya dashboard/API deployment.
- Suvera browser API calls must keep using same-origin `/api` unless the deployment plan explicitly changes the proxy.

## Validation before finishing

- For `suvera` changes, run `npm run check` from `C:\Users\Arat\Desktop\proje\suvera`.
- For `panelya` changes, use the validation commands in `C:\Users\Arat\Desktop\proje\panelya\AGENTS.md`.
- For API-connected Suvera checkout/catalog changes, test through `npm run dev`; plain file/static serving is only enough for layout checks.

## Repo-specific conventions

- Use npm scripts in both workspaces; do not introduce pnpm/yarn lockfiles.
- `suvera` is the public static storefront for Panelya data; the Panelya workspace slug is `suvera`.
- `suvera/api/[...path].js` proxies `/api/*` to the Panelya API; do not remove it when editing static pages.
- `suvera/js/config.js` and `suvera/js/config.example.js` should stay aligned when API/base-url behavior changes.
- `panelya/suvera-storefront` is not the root-tracked storefront; root-tracked Suvera source lives at `C:\Users\Arat\Desktop\proje\suvera`.

## Change safety rules

- For optimization-audit requests, write the report to `OPTIMIZATIONS.md` and do not patch code unless explicitly asked.
- For security-audit requests, review the relevant git diff/staged diff and report findings only; do not apply fixes unless explicitly asked.
- Preserve existing user changes in the worktree; do not revert unrelated edits.
