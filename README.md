<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/keydrop-wordmark-dark.svg">
    <img src="public/brand/keydrop-wordmark.svg" alt="Keydrop" width="320">
  </picture>
</p>

<p align="center"><a href="https://github.com/all-right-LLC/keydrop/blob/main/README.md">English</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.zh-Hant.md">繁體中文</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.zh-Hans.md">简体中文</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.ja.md">日本語</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.ko.md">한국어</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.it.md">Italiano</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.de.md">Deutsch</a> · <a href="https://github.com/all-right-LLC/keydrop/blob/main/README.ar.md">العربية</a></p>

Self-hosted code distribution for indie developers: redemption codes, discount codes, license keys and App Store promo codes, with claim campaigns, optional Stripe checkout, entitlements, an API, webhooks and an MCP server. Runs on Cloudflare Workers + D1.

This folder is the complete app. If you arrived here through the **Deploy to Cloudflare** button, this is your copy — the full project, documentation and issue tracker live at **[github.com/all-right-LLC/keydrop](https://github.com/all-right-LLC/keydrop)**.

## After deploying

1. Make sure these were set during deployment (Workers → your Worker → Settings → Variables and Secrets):
   - `APP_URL` — the HTTPS origin of this site, without a trailing slash
   - `ADMIN_EMAIL` — the administrator's email
   - `BETTER_AUTH_SECRET`, `SETUP_SECRET`, `CODE_ENCRYPTION_KEY` — three different random values (`openssl rand -hex 32`). **Back up `CODE_ENCRYPTION_KEY`**: without it, stored codes cannot be decrypted.
2. Open `APP_URL/setup`, enter `SETUP_SECRET` and choose the administrator password. Setup can only succeed once.
3. Sign in, create a product, add codes and start a campaign.

Optional services:

- **Stripe** — set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with `pnpm exec wrangler secret put …`, point a Stripe webhook at `APP_URL/api/stripe/webhook` and test in Stripe test mode first.
- **Email** — add a Cloudflare Email Sending binding named `EMAIL` and set `EMAIL_FROM` to a verified sender. Without it, password sign-in, free claims and redemptions still work.

## Local development

Requires Node.js 24+ and pnpm.

```sh
pnpm install --frozen-lockfile
node scripts/create-local-env.mjs "$HOME/.config/keydrop/local.env" you@example.com
pnpm run db:migrate
KEYDROP_DEV_ENV_FILE="$HOME/.config/keydrop/local.env" pnpm dev
```

Then open <http://localhost:3000/setup>. The generator never overwrites an existing file and never prints secrets. For another port, pass the origin as a third argument (e.g. `http://localhost:3100`) and run `pnpm dev --port 3100`.

```sh
pnpm run lint && pnpm run typecheck && pnpm test   # checks
pnpm run build:worker                              # production Worker build
pnpm run deploy                                    # build, apply D1 migrations, deploy
```

Run `pnpm run cf-typegen` after editing `wrangler.jsonc`.

## Customizing

- Copy and branding for every language: `messages/<locale>.json` (keys must match `messages/en.json`)
- Public pages, "My codes" and admin alert emails: `src/config/site.ts`
- Supported languages: `src/i18n/locales.ts`
- Home page layout: `src/app/page.tsx` and `src/app/[section]/page.tsx`

## License

MIT. Bundled beUI components keep their upstream MIT license (`vendor/beui.LICENSE`).
