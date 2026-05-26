# Southwest Acoustics Inventory

The shop-floor source of truth for [Southwest Acoustics](https://southwestacoustics.com).
Tracks every part, build, and Leo Jaymez consignment; pushes the public-facing
subset to Squarespace as a one-way derived feed.

Companion to (not replacement for) [Listing Studio](https://github.com/jus24194971/southwestlistingstudio)
— Listing Studio handles marketplace listings on Reverb / eBay / Etsy, this
handles physical inventory.

## Stack

- **Frontend & API**: [SvelteKit 2](https://svelte.dev/docs/kit) on Cloudflare Pages
- **Database**: Cloudflare D1 (edge SQLite)
- **Photos & label PDFs**: Cloudflare R2
- **Auth**: Cloudflare Access (Google sign-in, email allowlist)
- **Background jobs**: Cloudflare Workers Cron Triggers
- **Styling**: Tailwind CSS v4

All on the Cloudflare free tier. See `wrangler.toml` for the bindings.

## Local development

```bash
# Install
npm install

# One-time: create the D1 database. Wrangler will print the database_id —
# paste it into wrangler.toml's [[d1_databases]] block.
npx wrangler d1 create inventory

# One-time: create the R2 buckets.
npx wrangler r2 bucket create sw-acoustics-photos
npx wrangler r2 bucket create sw-acoustics-photos-preview

# Apply migrations to the LOCAL D1 dev database.
npm run db:migrate:local

# Run the dev server with Cloudflare bindings emulated.
# (Plain `npm run dev` works for UI-only iteration but the D1 calls error out.)
npm run preview
```

## Project layout

```
migrations/             SQL files applied in order to D1
src/
├── app.css             Tailwind entry + brand tokens
├── app.d.ts            App.Platform types (D1, R2 bindings)
├── app.html            HTML shell
├── lib/server/         Server-only modules (DB helper, SKU generator)
└── routes/             SvelteKit file-based routing
```

## SKU scheme

VIN-style: `CAT-BRAND-MODEL-COND-YY-SEQ`. See `src/lib/server/sku.ts`
for the spec and `migrations/0001_init.sql` for the seeded category codes.

## Deploy

```bash
npm run deploy
```

Pushes to Cloudflare Pages. First deploy needs a Cloudflare account login:
`npx wrangler login`.
