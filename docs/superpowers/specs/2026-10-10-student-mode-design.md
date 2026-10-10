# FitBite student mode: design

**Positioning.** FitBite helps students organize eating that fits their budget, their available time and a routine that changes. The product loop is: plan → shop → adapt when the day changes → learn from what the user actually managed to follow.

**Constraints.** Keep the current look and existing features. UI stays in English with strings centralized for later translation. Mobile first. No technical details (env var names, model ids) in the UI. Nothing simulated is presented as real. Everything must work with no API keys (built-in planner, demo store), so the deterministic planner is the primary engine and the AI path is an optional upgrade that goes through the same validator.

**Persistence.** Browser `localStorage`, per signed-in user (as today). The server stays stateless; every computation that produces nutrition, cost or grocery data happens on the server from a small client-held *skeleton*. A database is a documented follow-up.

## Deliveries

- **Delivery 1 (this spec's implementation plan):** fixes to calculations, portions and recipe details; student mode and weekly routine; weekly budget and pantry inventory; "My day changed" with plan and grocery updates; demo profile.
- **Delivery 2:** progress log with reasons feeding the next plan; favorites, pins and the flexible meal; portable-meal filters, labels and storage guidance; roommates mode.

## 1. Catalog (`lib/catalog.mjs`)

**Ingredients** gain, per canonical unit:
- `per: { kcal, protein, carbs, fat }` nutrition per 1 unit (1 g, 1 ml, 1 each, 1 slice, 1 can, 1 clove).
- `step`: smallest practical portion in canonical units. `g`/`ml` → 5; whole items as appropriate (egg 1, tortilla 1, bread slice 1, avocado 0.5, onion 0.25, lemon 0.25, can 0.5, garlic clove 1).
- `storage`: `pantry` | `fridge` | `freezer`; `fridgeDays` for perishables (used by meal-prep scheduling and storage guidance).

**Recipes** gain: `steps[]`, `equipment[]` (subset of `stove`, `oven`, `microwave`, `airfryer`; empty = no cooking), `activeMinutes`, `reheatMinutes` (meal-prep recipes), `skill` (`beginner` | `comfortable` | `confident`), `style` (`quick` | `homemade` | `bought`), `tags` (`portable`, `no-reheat`, `needs-fridge`, `eat-in-10`, `meal-prep`), `storage` (`{ fridgeDays, freezer: bool, note }` with guidance grounded in USDA FoodKeeper ranges). Per-serving macros are **derived** from the ingredient quantities, never hand-entered.

The catalog grows from 27 to roughly 45 recipes so each slot has 5-minute, no-equipment, portable and bought options. Bought meals (ready-to-eat items like a deli wrap or a protein bar) are recipes whose single ingredient is a `Ready to eat` catalog item with a unit price.

**Eating-out catalog** (`lib/eatout.mjs`): a small list of demo meals with nutrition and price, every item `demo: true`. The UI labels them "Demo data" and never presents them as a real restaurant.

## 2. Practical portions (`lib/portions.mjs`)

`materialize(recipe, servings)` scales each ingredient by `servings`, rounds the quantity to the ingredient `step` (nearest; never zero), and recomputes nutrition and consumed cost from the rounded quantities. A materialized meal carries its ingredient list; grocery aggregation sums those lists, so the list can never show 6.75 eggs. Servings stay on the 0.5–3 grid in 0.25 steps; the rounding happens on ingredients.

## 3. Profile, routine, inventory (`lib/profile.mjs`)

`parseProfile` keeps today's fields and adds (all optional; strict validation, safety fields rejected when malformed):

```
student: { budgetWeekly: number|null, equipment: ['stove','oven','microwave','airfryer'], skill, prepDays: ['sun', ...], mealsPerDay: 3|4, stylePref: 'quick'|'homemade'|'bought'|'mixed' }
week:    { startDate: 'YYYY-MM-DD', days: [ { weekday: 'mon', busy: bool, fridge: bool, microwave: bool,
             meals: ['breakfast','lunch','dinner','snack'], slots: { lunch: { minutes, where: 'home'|'away' }, ... } } ] }
inventory: [ { ingredientId, quantity } ]
pins:      [ { day, slot, recipeId } ]        // delivery 2 uses it; accepted now
```

Defaults when `week` is absent (old clients, tests): `days` consecutive days from today, every meal at home with generous minutes (breakfast 15, lunch 25, dinner 40, snack 5), fridge and microwave available, all equipment. `profile.days` is derived from `week.days.length` (1–7). Each day gets a real date and weekday label from `startDate`.

Targets (`computeTargets`) are unchanged.

## 4. Planner (`lib/planner.mjs`, replaces `heuristicSkeleton`)

**Candidates.** For each day and slot: allowed recipes (diet, allergies, dislikes) for that slot, then context filters:
- time: `minutes ≤ slot.minutes`, or the recipe is `meal-prep` with `reheatMinutes ≤ slot.minutes` and a prep day falls within `storage.fridgeDays` before this day (the same day counts); such a meal is scheduled with `prepOn: <day index>`;
- equipment: `recipe.equipment ⊆ student.equipment`; a meal eaten `away` must be `portable` and either `no-reheat` or the day has `microwave`; a day without `fridge` excludes `needs-fridge` for away meals;
- skill: recipes above the user's skill level are dropped.
If the pool is empty the planner relaxes in order: style preference → time +5 min → equipment and skill → any allowed recipe. Each relaxation is recorded as a note for that meal (`fit: 'relaxed:time'` etc.) and explained in the UI.

**Choice.** Each slot keeps its top-K (6) candidates by a pre-score: style match, ingredient reuse with the week so far and with the inventory, marginal pack cost, repeat penalty (per use this week), pins/favorites. The day's combination is chosen from the cartesian product of those lists by the lowest loss: `fitPortions` loss + cost weight − reuse bonus + repeat penalty.

**Portions.** `fitPortions(recipes, targets)` chooses servings on the 0.5–3 grid by coordinate descent on a weighted squared relative error over kcal (4), protein (2, ×1.5 when under), carbs (1) and fat (1), computed from materialized (rounded) ingredients; the day never ends below the 1200 kcal floor.

**Budget.** With a weekly budget, after the week is chosen the planner computes the purchase total (section 5). While it exceeds the budget it applies the swap (meal → cheaper candidate) with the best savings per unit of added macro loss, bounded by a loss ceiling, up to 60 swaps. If still over, the plan carries a note stating the gap and listing up to three concrete further swaps with their savings; it never claims the budget is met.

**Explained deviations.** Per day, any macro more than 15 % off target produces a plain-language note naming the macro, the direction, and the binding reason (time or equipment limits that day, diet/allergy pool, budget swaps, or catalog range), plus what was prioritized (calories, then protein).

**Validation.** `validateSkeleton` keeps the hard gate (days, slots present per that day's meals, known recipe, allowed, servings range, kcal floor, ±10 % kcal band) and additionally requires every recipe to be in that day-slot's candidate pool at the relaxation level the planner would use, so an AI plan cannot ignore the routine.

**AI path (`lib/ai.mjs`).** The structured-output schema becomes per-day (`day1..dayN`) with per-slot enums restricted to that slot's candidate pool; the prompt receives the routine, budget, inventory and style preference. Output passes through the same validator and materialization. The user never sees the model id, only "AI planner" or "Built-in planner".

## 5. Groceries, inventory, budget (`lib/grocery.mjs`)

`groceries(plan, { inventory, have, bought })` returns one line per ingredient:

```
{ ingredientId, name, category, unit, need, fromInventory, toBuy, packs, packSize, unitPrice,
  packCost, consumedCost, leftover, status: 'buy'|'have'|'bought' }
```
- `fromInventory` consumes inventory quantity first; `toBuy = need − fromInventory`; `packs = ceil(toBuy / packSize)`.
- `have` ids (user ticked "I have it" without a quantity) cover the full need. `bought` ids are purchased: packs and `packCost` count as **spent**, the line stays visible as bought.
- `packCost` is what the store charges (whole packs); `consumedCost` is `toBuy × unitPrice` capped at the pack cost, the share eaten this week; `leftover = packs × packSize − toBuy` carries to next week.

Totals: `toBuy` (packs still to purchase), `spent` (bought), `purchase = toBuy + spent`, `consumed`, `leftoverValue`, `budget`, `diff = budget − purchase`, `perMeal = consumed / mealsCount` plus per-meal consumed cost on each meal.

When a swap removes the last use of a bought ingredient, the client moves it to the inventory (quantity = packs × packSize) instead of dropping it.

## 6. "My day changed" (`lib/adapt.mjs`)

`alternatives({ profile, skeleton, day, slot, reason, missingIngredientId, inventory, have, bought })` returns up to three options:
- reasons: `five_min` (effective minutes ≤ 5), `ten_min` (≤ 10), `missing_ingredient` (excludes recipes using it; prefers recipes covered by what the user has), `another` (any other allowed recipe, similar nutrition). All keep diet, allergies, dislikes, that day's equipment and `away` constraints. The current recipe is excluded.
- servings are chosen to land nearest the replaced meal's calories.
- availability: an ingredient counts as available if it is in the inventory, in `have`, in `bought`, or already on the list to buy; `cost.newPurchase` is the pack cost of ingredients not available, `cost.consumed` the eaten share.
- ranking: nutrition distance to the replaced meal, then new purchase cost, then minutes; ties broken by reuse.
- `why`: up to two true statements chosen from templates ("Ready in 5 minutes", "Uses only what you already have", "No new groceries", "Similar protein to the meal it replaces", "Cheapest option", "Portable, no reheating needed").
- empty result returns a message suggesting "Eat out" or a manual meal.

`eat_out` is handled on the client: the user picks a demo catalog item or enters a meal by hand (name and calories required; macros and cost optional). The skeleton slot becomes `{ eatOut: { name, kcal, protein, carbs, fat, cost, source: 'manual'|'demo' } }`; the builder materializes it with `estimated: true` and no ingredients.

**Applying.** The client replaces the slot in its skeleton, pushes the previous skeleton onto an undo stack, and calls the builder. Confirm/cancel happens before anything changes. Undo pops the stack and rebuilds.

## 7. API (stateless)

| Route | Purpose |
|---|---|
| `GET /api/config` | public options: allergens, diets, activity, goals, equipment, skills, styles, slots, min kcal, max days; `ai: bool`; providers; auth; `ingredients` summary for the pantry picker (id, name, unit, category, step); `eatOut` demo catalog. No model id, no env names. |
| `POST /api/plan` | profile → skeleton (planner, or AI validated with planner fallback) → built result. |
| `POST /api/plan/build` | `{ profile, skeleton, have, bought }` → `{ plan, groceries, notes }`. The single builder; every mutation (swap, eat out, undo, have/bought toggle) goes through it. |
| `POST /api/alternatives` | section 6. |
| `POST /api/checkout` | unchanged; receives `{ ingredientId, quantity }` for lines to buy. |

Responses carry `source: 'ai'|'builtin'`. Rate limiting applies to AI-backed `/api/plan` only.

Plan shape: `{ targets, days: [ { index, date, weekday, label, meals: [ meal ], totals, deviations: [text] } ], notes: [ { kind, text } ] }` where `meal = { slot, recipeId|null, eatOut|null, name, servings, minutes, activeMinutes, effectiveMinutes, prepOn, equipment, tags, skill, style, steps, storage, ingredients: [{ id, name, quantity, unit }], kcal, protein, carbs, fat, cost, allergens, context: { minutes, where }, fit, estimated }`.

## 8. Frontend (`public/`)

`app.js` becomes ES modules under `public/js/` with no build step: `strings.js` (`t(key, vars)`; every JS-generated string), `dom.js`, `api.js`, `format.js`, `state.js` (versioned `fitbite:v2`, migration from v1, undo stack), `sheet.js` (shared bottom sheet), `wizard.js`, `home.js`, `recipe.js`, `adapt.js`, `groceries.js`, `auth.js`, `app.js`. Static HTML copy stays English; externalizing it is a follow-up.

**Wizard** (7 steps, short forms, details optional): About you → Your goal → How you eat → **Student life** (weekly budget, equipment, kitchen confidence, prep days, meals per day, quick/homemade/bought preference) → **Your week** (start date; "same every day" defaults with per-slot minutes, or expand a day to set minutes per meal, home/away, fridge, microwave, meals included, busy) → **Pantry** (search + chips with optional quantity) → Final (summary of what the plan will use).

**Home:** day picker shows weekday and date. Meal cards show time, cost, calories, protein and badges (prepped on…, portable, estimated). Tapping a card opens the recipe sheet: ingredients with quantities, steps, time, equipment, servings, nutrition, storage, plus the **My day changed** button. Budget chip and notes (deviations, relaxations, budget) appear under the title. Source badge reads "AI planner" or "Built-in planner".

**My day changed sheet:** five reasons; results show time, cost (new purchase and consumed), nutrition and why; confirm/cancel; after confirming the plan, totals and groceries update, a toast offers Undo.

**Groceries:** have / bought toggles per line (distinct), budget bar (purchase vs budget, difference), to-buy vs spent, estimated cost per meal, leftovers for next week, "Prices are estimates" and "Demo store (simulated)" labels. Checkout sends only `buy` lines.

**Demo profile:** a "Try the demo student" button on the empty home prefills the wizard with a fictional student (labelled as such): $55 weekly budget, stove and microwave, beginner, Sunday prep, pantry with rice, oats, eggs and peanut butter, Tuesday and Thursday lunches away in 10 minutes without a microwave. The user still presses "Build my plan".

**States:** loading, success, error and empty states on every async action; sheets trap focus and close on Escape; everything works at 390 px.

## 9. Tests (`node:test`)

- portions: rounding by step, never zero, nutrition recomputed from rounded quantities.
- planner: constraints respected on every day; day kcal within ±10 %; macro deviations either within 15 % or explained; Tuesday 10-minute away lunch without microwave gets a portable no-reheat recipe ≤ 10 min; meal-prep scheduling uses a prep day within shelf life; budget search lowers purchase and warns honestly when it cannot meet the budget; deterministic output.
- groceries: inventory deduction with quantities, have vs bought, pack vs consumed cost, leftovers, totals.
- adapt: reasons filter correctly, restrictions preserved, no new purchase when covered, servings near the old calories, at most three results, empty result message.
- http: build endpoint round trip, alternatives, config has no technical details, old-style profile still works.
- ai: fake client still validates request shape and fallbacks with the new schema.

UI is checked in the built-in browser at phone width on the full demo flow.

## Out of scope for delivery 1

Progress log and learning, favorites/pins/flexible meal, portable filters UI, roommates, database sync, translations of static HTML, real restaurant data, real price feeds.
