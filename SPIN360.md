# Optional PDP 360° media

The normal gallery remains the default. The PDP consumes `product.details.spin360`
as one logical asset, separate from `product.images`:

```json
{
  "frameCount": 12,
  "poster": "/api/media/<first-asset-uuid>/detail",
  "frames": ["/api/media/<first-asset-uuid>/detail", "/api/media/<second-asset-uuid>/detail"]
}
```

The example abbreviates `frames`; its real length must equal `frameCount`.
Frames are unique, equally spaced, clockwise sequence entries; the poster must be
the first frame. Two through 72 frames are supported. No automatic rotation occurs.

Panelya stores this in its existing `products.details` JSONB field. No migration is
needed. `PUT /products/:id/spin360` accepts `{ "spin360": <manifest> }`, or explicit
`null` to remove the association. It requires authenticated owner/admin permissions,
checks workspace ownership, locks the product, and updates only this details key
plus `updated_at`. It maintains `media_references` under field `spin360` so storage
cleanup cannot delete live frames. Ordinary product saves preserve this key and
cannot bypass the dedicated association checks. Product deletion removes references.

The product editor's **360° Görünüm** section uploads ordered WebP files through the
existing managed media upload pipeline. It shows selected filenames in numeric order
before saving, checks equal dimensions, uses the first frame as poster, and supports
replace/remove independently of the main product form. Upload failures leave the old
association intact; unassociated uploads follow existing media cleanup policy.

The storefront requests only the poster before activation. Activation keeps cached
frames usable while loading 0, +1, -1, +2, -2 and the rest with bounded concurrency.
A failed poster suppresses the control. Failed individual frames retain the last
valid view; a set with fewer than two successful frames returns to the normal gallery.
There is a 15-second per-frame timeout. No URLs or product data are logged.

Horizontal Pointer Events belong to the viewer; `touch-action: pan-y` preserves page
scroll. Arrow keys rotate, and the live region announces only keyboard/release results.
Fullscreen reuses the existing modal and its focus trap, Escape handler and scroll lock.

## Supplied source and mapping

`elbise-360-interaktif (1).zip` is preserved outside the repository. It contains twelve
unique PNGs at 000, 030, …, 330 degrees. Frames 000/030 are 1087×1446; others are
1087×1447. Optimization pads the one-pixel difference without cropping.

Optimized fixtures in `e2e/fixtures/spin360` are the actual supplied sequence, used by
browser regression tests. They are **not** copied into the storefront build, and no
production product is automatically associated with them. The relative test manifest
must not be sent directly to the API: the editor uploads the WebPs and obtains managed
URLs. Managed delivery already supplies immutable caching for versioned assets.

**PRODUCT_MAPPING_REQUIRED:** the strongest candidate is product 77, **Actuel Nervürlü
Elbise 35134-KT**, Kiremit. Its canonical `source_folder` and local import receipt both
identify `051-actuel-nervurlu-elbise-35134-kt`. The canonical photo resembles the spin,
but the ZIP has no source/product identifier proving that relationship. Its demo title
is not canonical evidence. Confirm the source relationship before attaching anything.
The product also has a Kahverengi variant: the present manifest is a product-level
view, so review that color context before attaching this Kiremit-only sequence.

## Reproduction and validation

From the storefront root (this checkout does not have a `suvera/` child directory):

```powershell
npm run prepare:spin360 -- <extracted-assets-directory> <output-directory>
npm run check
npm test
npm run test:spin360
```

Preparation reuses Sharp from the nested Panelya installation. It writes WebP quality
88, retains 1087×1447 resolution, and puts content hashes in filenames. Originals total
17,706,898 bytes; optimized fixtures total 536,138 bytes (96.97% smaller). Poster:
51,958 bytes; additional frame bodies after activation: 484,180 bytes. Actual managed
upload derivatives are encoded by the existing pipeline and must be measured after
the confirmed attachment; these fixture totals are not a production transfer claim.

The isolated browser suite starts `npm run dev`, mocks only API data/media responses,
and uses the actual WebP sequence. It covers five viewport sizes, mouse, real Chromium
touch events, keyboard wrapping, lazy loading, photo return, modal geometry and failure
fallback. No orders or payments are submitted. The general full-stack E2E suite is
separate and is not implied by this targeted run.

Panelya checks: `npm run check:api`, `npm run test:api`, `npm run lint:web`,
`npm run typecheck:web`, `npm run build:web`. Release through normal Git pushes and
automatic deployments, with Panelya released before the storefront gitlink update.
