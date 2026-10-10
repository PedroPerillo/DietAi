# FitBite

Mobile-first web app: tell it about yourself and it builds a meal plan, turns the plan into a grocery list, and sends that list to a real grocery cart. Install it to your phone home screen from the browser menu.

See [PLAN.md](PLAN.md) for the feasibility analysis (which grocery APIs can do what), the architecture, and the roadmap.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm test
```

Copy `.env.example` to `.env` to configure it. It works with no configuration: plans come from the built-in planner, and checkout creates a simulated cart. Set these to turn on the real integrations:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Plans are built by Claude (`claude-opus-5-5`), validated server-side, with the built-in planner as fallback |
| `INSTACART_API_KEY` | Enables "Send to Instacart", which creates a shopping-list page link |
| `INSTACART_BASE_URL` | Defaults to the dev environment `https://connect.dev.instacart.tools`. Use `https://connect.instacart.com` for production keys |
| `PUBLIC_URL` | Optional link back to this app, shown on the Instacart page |
| `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | Turn on Clerk sign-in. Both are required; with either missing the app stays open. Plan and checkout then need a signed-in user |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated origins allowed to use session tokens, e.g. `https://fitbite-pi.vercel.app`. Private Vercel preview URLs are then rejected unless added |
| `PORT` | Defaults to 3000 |
| `HOST` | Defaults to `127.0.0.1`. Set `0.0.0.0` to expose it (containers, previews) |
| `PLAN_RATE_LIMIT` | Plan requests per IP per minute when AI is on (default 10) |

## Deploy to Vercel

The repo is ready to deploy as-is: `public/` is served from Vercel's CDN and `api/index.mjs` runs every `/api/*` route as one serverless function (120 s max, which covers the 90 s Claude deadline).

1. In Vercel: **Add New → Project → Import** `PedroPerillo/DietAi`. Leave the framework preset as **Other** and the build settings blank.
2. **Before adding a Claude key to a public site, set a monthly spend limit** on the Anthropic workspace that owns it (Console → Settings → Limits). The rate limiter is per function instance and best-effort, so it won't stop traffic spread across many IPs or instances.
3. Under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` (and optionally `INSTACART_API_KEY`, `INSTACART_BASE_URL`, `PUBLIC_URL`). Without them, the site still works with the built-in planner and the demo cart.
4. Deploy. Every push to `main` redeploys automatically.

On Vercel the rate limiter uses the client IP Vercel's edge sets (`x-vercel-forwarded-for`). Elsewhere behind a proxy that appends to `x-forwarded-for` (nginx, most load balancers), set `TRUST_PROXY=1`; the last hop is used. Limits are kept per function instance, so they're best-effort; use a shared store (e.g. Upstash or Supabase) for strict limits.

## Sign-in (Clerk)

1. Create an application at https://dashboard.clerk.com and enable Email, Google and Apple.
2. Copy the **Publishable key** and **Secret key** from **API keys** into `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Set `CLERK_AUTHORIZED_PARTIES` to the site's origin.
3. Development keys (`pk_test_…`) work on any domain, including `*.vercel.app`. Production keys (`pk_live_…`) need a domain you own, configured in Clerk.

The browser loads Clerk's script-tag SDK from your instance's Frontend API (derived from the publishable key). The server verifies the session token from `Authorization: Bearer …` with `@clerk/backend`. Plans are still stored in the browser, now separately per signed-in user; syncing them across devices needs a database (see PLAN.md).

## Layout

```
lib/http.mjs            request handler: /api/config, /api/plan, /api/checkout, static files
scripts/serve.mjs       local server (npm start)
api/index.mjs           Vercel serverless entry (same handler)
lib/catalog.mjs         ingredients (unit, pack, price, allergens) + recipes (per-serving macros)
lib/profile.mjs         input validation, calorie/macro targets
lib/plan.mjs            built-in planner, skeleton validation, plan builder
lib/auth.mjs            Clerk session verification + public sign-in config
lib/ai.mjs              Claude planner (structured output constrained to allowed recipes)
lib/grocery.mjs         aggregation, pack rounding, checkout input rebuilding
lib/stores/             grocery providers: mock, instacart
public/                 mobile-first single-page UI (vanilla JS, no build step, installable manifest)
test/                   node:test suites
```

Nutrition values are approximate. This is a prototype, not medical advice.
