# StockTrace V2.4.3 — Login Render Stability Fix

## Scope
This patch addresses only the login-page unstyled flash and the avoidable flash of the initial session-check screen.

- `login.html` now uses self-contained critical CSS. It no longer depends on Tailwind CDN, the global dashboard stylesheet, Google Fonts, or an icon CDN to render the login form correctly.
- The Supabase client CDN remains because the existing authentication flow requires it. The submit button starts disabled and is enabled only after the client and public configuration are ready.
- The existing `/api/id-login` exchange, Supabase `setSession`, profile lookup in `public.users`, role/name session hints, and redirect to `index.html` are retained.
- `index.html` keeps the auth-pending guard that hides the dashboard until authentication and authorization checks complete. The boot card is revealed only after a 180 ms grace period, avoiding a visible loading card for quick checks without weakening the guard.

## No backend or data changes
This patch does not change Supabase tables, RLS, SQL migrations, webhooks, Google Sheets, Google Drive, Vercel environment variables, or operational modules.

## Install
Extract the release ZIP directly into `Downloads\StockTrace_V2.4.3_Login_Render_Fix`, then run the PowerShell command supplied in the chat from the StockTrace repository's `main` branch.

The installer creates a backup branch, verifies that local `main` matches `origin/main`, applies only `login.html`, `index.html`, the focused test, and release notes, then runs the full test suite. It asks for the exact word `PUSH` only after all checks pass.
