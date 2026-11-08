# StockTrace V2.1 — Mobile Navigation Update

## Changes
- Desktop (>= 1024px): original 256px navy sidebar remains visible.
- Tablet (768–1023px): sidebar remains visible with a 220px width.
- Mobile (<= 767px): sidebar is hidden off-canvas by default.
- Mobile header includes a hamburger button.
- Tapping hamburger opens the left drawer with a dimmed backdrop.
- Drawer closes from its X button, backdrop, Escape key, or after selecting a navigation item.
- Dashboard content uses the full mobile viewport; KPI labels and headings are more readable.
- Existing table horizontal scrolling is retained.

## Files changed
- `index.html`
- `stocktrace-professional-rose.css`
- `app.js`
- `tests/professional-rose-ui.test.mjs`

## Preserved
No changes were made to Supabase schema, RLS, API routes, Google Drive upload, Google Sheets sync, OAuth, or role authorization.

## Deploy
Upload/commit this ZIP's contents to the existing `v2-1-staging` branch and deploy a Preview build first. Test at desktop and mobile widths before merging to `main`.
