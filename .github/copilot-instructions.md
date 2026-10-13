# Chợ Nhà workspace notes

- Keep the project JavaScript-only and preserve the monorepo split: Cloudflare Worker API in `apps/api`, mobile-first HTML/CSS/vanilla JS in `apps/storefront`.
- Treat D1 migrations in `migrations/` as the source of truth for schema changes; update `README.md` when setup or scripts change.
- Keep public storefront routes separate from `/api/admin/*`; admin endpoints must require the `ADMIN_TOKEN` bearer secret.
- Never treat the current checkout flow as an online payment integration. A real provider needs server-side verification and payment-status handling.
- Before finishing changes, run `node --check` for modified JavaScript and validate relevant Wrangler/D1 behavior when available.