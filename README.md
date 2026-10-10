# FitBite

Mobile-first web app that helps students eat within their budget, their time and a routine that changes. Tell it about yourself and your week, and it builds a meal plan, turns the plan into a grocery list, and sends that list to a real grocery cart. When the day doesn't go as planned, "My day changed" swaps a meal and updates the shopping. Install it to your phone home screen from the browser menu.

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
| `DEEPSEEK_API_KEY` | Plans are built by DeepSeek (`deepseek-chat`, JSON mode, schema in the prompt), validated server-side, with the built-in planner as fallback. Takes precedence over Groq when both are set |
| `DEEPSEEK_MODEL` | Optional. Another DeepSeek chat model |
| `GROQ_API_KEY` | Plans are built by Groq (`openai/gpt-oss-120b`, strict JSON-schema output), validated server-side, with the built-in planner as fallback. Works on Groq's free plan |
| `GROQ_MODEL` | Optional. Another Groq model with strict structured outputs, e.g. `openai/gpt-oss-20b` |
| `INSTACART_API_KEY` | Enables the real "Send to Instacart", which creates a shopping-list page link. Without it, the button opens FitBite's own demo of the Instacart list page (`public/instacart-demo.html`): nothing is ordered |
| `INSTACART_BASE_URL` | Defaults to the dev environment `https://connect.dev.instacart.tools`. Use `https://connect.instacart.com` for production keys |
| `PUBLIC_URL` | Optional link back to this app, shown on the Instacart page |
| `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | Turn on Clerk sign-in. Both are required; with either missing the app stays open. Plan and checkout then need a signed-in user |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated origins allowed to use session tokens, e.g. `https://fitbite-pi.vercel.app`. Private Vercel preview URLs are then rejected unless added |
| `PORT` | Defaults to 3000 |
| `HOST` | Defaults to `127.0.0.1`. Set `0.0.0.0` to expose it (containers, previews) |
| `PLAN_RATE_LIMIT` | Plan requests per IP per minute when AI is on (default 10) |

## Deploy to Vercel

The repo is ready to deploy as-is: `public/` is served from Vercel's CDN and `api/index.mjs` runs every `/api/*` route as one serverless function (120 s max, which covers the 90 s AI deadline).

1. In Vercel: **Add New → Project → Import** `PedroPerillo/DietAi`. Leave the framework preset as **Other** and the build settings blank.
2. **Use a free-plan Groq key for now.** Free-plan keys can't run up a bill; when the plan's per-minute or daily limit is hit, users get the built-in plan with a note. If you move to a paid Groq plan, set a spend limit in the Groq console first: the app's rate limiter is per function instance and best-effort.
3. Under **Settings → Environment Variables**, add `GROQ_API_KEY` (and optionally `INSTACART_API_KEY`, `INSTACART_BASE_URL`, `PUBLIC_URL`). Without them, the site still works with the built-in planner and the demo cart.
4. Deploy. Every push to `main` redeploys automatically.

On Vercel the rate limiter uses the client IP Vercel's edge sets (`x-vercel-forwarded-for`). Elsewhere behind a proxy that appends to `x-forwarded-for` (nginx, most load balancers), set `TRUST_PROXY=1`; the last hop is used. Limits are kept per function instance, so they're best-effort; use a shared store (e.g. Upstash or Supabase) for strict limits.

## Sign-in (Clerk)

1. Create an application at https://dashboard.clerk.com and enable Email, Google and Apple.
2. Copy the **Publishable key** and **Secret key** from **API keys** into `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Set `CLERK_AUTHORIZED_PARTIES` to the site's origin.
3. Development keys (`pk_test_…`) work on any domain, including `*.vercel.app`. Production keys (`pk_live_…`) need a domain you own, configured in Clerk.

The browser loads Clerk's script-tag SDK from your instance's Frontend API (derived from the publishable key). The server verifies the session token from `Authorization: Bearer …` with `@clerk/backend`. Plans are still stored in the browser, now separately per signed-in user; syncing them across devices needs a database (see PLAN.md).

## Layout

```
lib/http.mjs              request handler: /api/config, /api/plan, /api/checkout, static files
scripts/serve.mjs         local server (npm start)
api/index.mjs             Vercel serverless entry (same handler)
public/shared/catalog.mjs ingredients (unit, pack, price, nutrition, allergens) + recipes (steps,
                          time, equipment, take-away and storage flags); used by server and browser
public/shared/engine.mjs  planning engine, used by server and browser: practical portions, macro
                          fitting, daily routine, budget, inventory, leftovers, validation,
                          grocery summary and "My day changed" alternatives
lib/catalog.mjs           re-exports the shared catalog for server code
lib/profile.mjs           input validation (incl. routine, budget, inventory), calorie/macro targets
lib/ai.mjs                Groq planner: picks recipes from engine-filtered lists (strict output)
lib/auth.mjs              Clerk session verification + public sign-in config
lib/grocery.mjs           checkout input rebuilding and pack rounding
lib/stores/               grocery providers: mock, instacart
public/app.js             mobile-first single-page UI (vanilla JS, no build step, installable manifest)
test/                     node:test suites
```

Nutrition values are approximate. This is a prototype, not medical advice.
