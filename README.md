# DietAI

Tell it about yourself and it builds a meal plan, turns the plan into a grocery list, and sends that list to a real grocery cart.

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
| `PORT` | Defaults to 3000 |

## Layout

```
server.mjs              HTTP server: /api/config, /api/plan, /api/checkout, static files
lib/catalog.mjs         ingredients (unit, pack, price, allergens) + recipes (per-serving macros)
lib/profile.mjs         input validation, calorie/macro targets
lib/plan.mjs            built-in planner, skeleton validation, plan builder
lib/ai.mjs              Claude planner (structured output constrained to allowed recipes)
lib/grocery.mjs         aggregation, pack rounding, checkout input rebuilding
lib/stores/             grocery providers: mock, instacart
public/                 single-page UI (vanilla JS, no build step)
test/                   node:test suites
```

Nutrition values are approximate. This is a prototype, not medical advice.
