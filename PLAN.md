# FitBite: feasibility and plan

**Question:** can an app use AI to build a diet plan and then buy the groceries through an API?

**Answer:** yes, with one honest caveat. The AI part is straightforward. For groceries, today's public APIs let an app **build a ready-to-buy cart or list at a real retailer**. The user still taps "check out" and pays on the retailer's side. No mainstream grocer lets a third-party app pay for an order on its own, and keeping a human approving the payment is a good thing for an app that spends people's money.

## Grocery API landscape (Oct 2026)

| Provider | What the API does | Checkout | Onboarding | Verdict |
|---|---|---|---|---|
| **Instacart Developer Platform** | `POST /idp/v1/products/products_link` takes line items (name + `line_item_measurements`) and returns a hosted shopping-list URL. Instacart matches products at the store the user picks. | User picks a store and checks out on Instacart | Self-serve dev keys; production keys need approval | **Build first.** Most stores, least work. *Implemented in the prototype.* |
| **Kroger Public API** | Product search (returns UPCs and prices by location), plus `PUT /cart/add` into the user's own Kroger cart (OAuth2, `cart.basic:write`) | User finishes in the Kroger app or site | Self-serve developer account | **Second.** A "real cart" demo, but only for Kroger-family stores. Needs user OAuth. |
| **MealMe** (B2B aggregator) | Claims end-to-end ordering across many stores | Can be fully programmatic | Sales-led, paid | Consider later if fully hands-off ordering is a hard requirement. |
| Walmart / Amazon Fresh / Whole Foods | No public grocery-ordering API (Walmart has affiliate/product-lookup APIs only) | — | — | Not viable without a partnership. |

## How the prototype works

```
Browser (public/)                     Server (lib/http.mjs, Node, no framework)
─────────────────                     ───────────────────────────────────────
wizard (profile + routine)
  ── POST /api/plan ─────────────────▶ parseProfile → computeTargets (Mifflin-St Jeor, 1200 kcal floor)
                                      engine.generate (always: proves the constraints can be met; fallback)
                                      aiSkeleton (Groq, if GROQ_API_KEY): picks recipes from candidatePools
                                        → engine.planWeek fits portions → validatePlan
plan (recipe ids + portions) ◀───────
engine.hydratePlan / grocerySummary   (in the browser: nutrition, costs, leftovers, budget)
"My day changed" → alternativesFor → applyMealChange   (in the browser, nothing sent)
"have it" / "bought" ── POST /api/checkout ▶ parseCheckoutItems (rebuild from catalog) → provider.checkout
link / cart ◀────────────────────────     mock (simulated cart) | instacart (shopping-list link)
```

`public/shared/` (catalog + engine) is plain ES modules imported by both the server and the browser, so portions, nutrition, costs and restriction checks are computed by the same code everywhere.

Key design decisions:

1. **The AI chooses; the code does the math.** The model picks recipes from per-day lists the engine already filtered for the user's diet, kitchen, time and take-away needs. The engine then fits portions to the calorie and macro targets in practical amounts (whole eggs, half cans, 5 g steps) and recalculates nutrition from the rounded amounts. Foods, quantities and nutrition can't be hallucinated.
2. **Allergies are enforced in code, twice.** Allergen and diet tags live on *ingredients* and roll up to recipes automatically. The structured-output schema only offers the model the recipe IDs the user is allowed to eat, and `validatePlan` re-checks every meal afterward. The same `isRecipeAllowed` check filters "My day changed" alternatives. Any failure falls back to the deterministic planner, with a visible warning.
3. **One canonical unit per ingredient.** Summing "200 g + 0.5 kg chicken" never happens, because every recipe uses the ingredient's canonical unit. Units Instacart doesn't support (bread slices, garlic cloves) are sent as whole packs (`package`, `head`).
4. **The server never trusts the client's cart.** Checkout receives only `{ingredientId, quantity}`. Names, units, pack counts, and prices are rebuilt from the catalog.
5. **Keys stay on the server.** The app runs fully without keys (built-in planner and demo cart). Adding `GROQ_API_KEY` and/or `INSTACART_API_KEY` turns the real integrations on.
6. **AI call:** Groq's OpenAI-compatible API with `openai/gpt-oss-120b` in strict JSON-schema mode (constrained decoding, so replies always match the schema), `reasoning_effort: low`, and a compact catalog prompt to fit the free plan's per-minute token budget. Rate limits (429), rejected keys, truncation, malformed JSON and constraint violations all surface as a friendly warning plus the built-in plan.

## Roadmap

**Phase 1: prototype (this repo)**
- [x] Profile → calorie/macro targets with a safety floor
- [x] AI planner grounded in a 37-recipe catalog, plus a deterministic fallback planner
- [x] Allergy / diet / dislike enforcement in code
- [x] Aggregated grocery list with pack rounding, "already have it" toggles, and an estimated total
- [x] Demo cart and an Instacart shopping-list link
- [x] Mobile-first UI: bottom tab bar, swipeable day cards, sticky checkout bar, installable to home screen
- [x] Tests: unit, HTTP round trip, fake Instacart (success/500/timeout), fake Groq (request shape, refusal, truncation, bad JSON, constraint violations)

**Student mode (done)**
- [x] Planner fits calories and all three macros, with practical portions and a per-meal portion range; explains when targets can't all be met
- [x] Recipe details: ingredients, steps, time, equipment, portions, nutrition, estimated cost, storage tips
- [x] Routine per weekday (time per meal, home or packed, fridge/microwave where it's eaten, busy and prep days), kitchen equipment, cooking skill and meal style
- [x] Weekly budget: cost pressure until the plan fits, honest advice when it can't; whole-pack spend vs food eaten this week vs leftovers
- [x] What's already at home is used first; groceries track "have it" and "bought"
- [x] "My day changed" on every meal (5 or 10 minutes, missing ingredient, eating out, another option), with reasons, day totals and extra shopping, confirmed before applying
- [ ] Learn from swaps (the log is kept on the device), progress, favorites, roommates

**Phase 2: MVP**
- Accounts and persistence (Postgres): `users`, `profiles`, `plans`, `plan_meals`, `grocery_lists`, `orders` (provider, external id/link, status)
- Regenerate one day, lock favorite meals
- Bigger recipe catalog with nutrition from USDA FoodData Central rather than hand-entered values. Let the AI propose *new* recipes, but run them through a nutrition calculator and an allergen check before use
- Kroger adapter: OAuth connect, UPC search by store, cart add
- Instacart production approval; `partner_linkback_url` back to the app; affiliate revenue
- Weekly reorder reminder; carry leftovers and pantry across weeks so staples (oil, spices) aren't re-bought

**Phase 3: growth**
- Live prices from Kroger product search for the budget planner (prices are estimates today)
- Progress tracking (weight, adherence) feeding back into targets
- Native/mobile wrapper; household plans (multiple people, scaled portions)

## Risks and open questions

- **Medical and liability.** The app shows calorie/macro *estimates* and a "not medical advice" notice, and enforces a 1200 kcal/day floor. Before launch: get a dietitian to review the catalog and targets, add screening for eating-disorder risk and pregnancy, and write terms of service.
- **Allergen accuracy depends on catalog tagging.** Store products vary (e.g. cross-contamination, brand-specific soy sauce). Instacart `health_filters` (e.g. `GLUTEN_FREE`, `VEGAN`) should be added to line items for allergic users.
- **Dislikes match by substring** ("egg" also excludes "eggplant"). Fine for a prototype; use ingredient-level tags in the MVP.
- **Product matching.** Instacart matches by name, so "Rolled oats" may pick a different brand or size than expected. Kroger UPCs are exact but store-specific.
- **AI cost, limits and latency.** One plan is a single Groq call (typically a few seconds). The free plan caps requests and tokens per minute and per day, so heavy use falls back to the built-in planner. Moving to a paid Groq plan or caching plans per profile would lift that.
