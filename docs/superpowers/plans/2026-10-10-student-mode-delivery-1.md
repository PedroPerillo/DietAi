# Student mode, delivery 1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the planner's calculations and portions, add recipe details, student mode with a weekly routine, weekly budget with pantry inventory, and "My day changed" swaps that keep nutrition, groceries and costs consistent.

**Architecture:** The server stays stateless and owns every calculation; the browser holds a small plan *skeleton* and rebuilds the materialized plan through one `/api/plan/build` endpoint after every change. The deterministic planner is the primary engine (context-filtered candidate pools, multi-objective portion fit, budget local search); the AI path produces a skeleton under the same validator. The vanilla front end is split into ES modules.

**Tech Stack:** Node 22 (ESM, `node:test`, no framework), vanilla JS modules in `public/`, `@anthropic-ai/sdk`, Clerk, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-10-student-mode-design.md`

## Global Constraints

- UI in English; every JS-generated string goes through `t()` in `public/js/strings.js`.
- No env var names, model ids or provider internals in the UI or in `/api/config`.
- Nothing simulated is labelled as real: "Demo store (simulated)", "Prices are estimates", "Demo data" for eating-out items, "Demo profile (fictional)".
- Allergies, diet and dislikes enforced by `isRecipeAllowed` on every path (plan, AI, swap, alternatives).
- Mobile first at 390 px; existing brand tokens in `public/styles.css`; no build step.
- Node `engines` stays `22.x`; no new runtime dependencies.
- Every mutation of the plan goes through `buildResult` (server) so nutrition, inventory, groceries and costs are always recomputed together.

## Review Focus

1. A day whose every slot is `away` with no microwave and 5-minute slots: planner must still return a plan (relaxed, with notes), never throw. Test in Task 4.
2. Inventory quantity larger than the need, and inventory in `each` units for a `g` ingredient id that does not exist: rejected by `parseProfile`, not silently ignored. Test in Task 3.
3. A `bought` ingredient that a swap no longer needs: it must not disappear; the client moves it into the inventory. Test in Task 10 (client logic unit-tested through a pure function in `public/js/state.js` exercised by `test/client-state.test.mjs`).
4. Old `localStorage` state (`fitbite:v1`) must still load: migrated to v2 with defaults, never cleared. Test in Task 10.
5. `/api/plan/build` with a skeleton that references a recipe the profile forbids (e.g. after editing allergies): rejected with 422 listing the offending meal. Test in Task 7.

---

### Task 1: Catalog with per-ingredient nutrition, practical steps, recipe details

**Files:** Modify `lib/catalog.mjs`; create `lib/eatout.mjs`; test `test/catalog.test.mjs`.

**Produces:** `INGREDIENTS[id] = { name, unit, category, pack, price, instacartUnit, allergens, diet?, labelRisk?, per: {kcal, protein, carbs, fat}, step, storage, fridgeDays? }`; `RECIPES[i] = { id, name, slot, minutes, activeMinutes, reheatMinutes?, equipment[], skill, style, tags[], steps[], storage: {fridgeDays, freezer, note}, ingredients: [[id, qty]], kcal, protein, carbs, fat, cost, diet, allergens }` (macros and cost derived); `EQUIPMENT`, `SKILLS`, `STYLES`, `TAGS` constants; `EAT_OUT_DEMO` in `lib/eatout.mjs` with `demo: true` on every item.

- [ ] Test: every recipe's derived kcal is within ±15 % of the previous hand-entered value for the 27 existing recipes (guards against data-entry mistakes); every ingredient has `per`, `step > 0`, `storage`; each slot has ≥ 1 recipe with `minutes ≤ 5`, ≥ 1 with `equipment = []`, ≥ 1 tagged `portable` + `no-reheat`, ≥ 1 `meal-prep` for lunch and dinner; every `EAT_OUT_DEMO` item has `demo: true`.
- [ ] Implement data; `RECIPES` derives `kcal/protein/carbs/fat/cost` from ingredients; keep `getRecipe`, `getIngredient`, `isRecipeAllowed`, `allowedRecipes`.
- [ ] Run `npm test` (older tests may break on exact numbers; fix in Task 2+). Commit.

### Task 2: Practical portions

**Files:** Create `lib/portions.mjs`; test `test/portions.test.mjs`.

**Produces:** `materialize(recipe, servings) → { recipeId, servings, ingredients: [{ id, name, quantity, unit }], kcal, protein, carbs, fat, cost }`; `roundToStep(qty, step)`; `nutritionOf(ingredients)`.

- [ ] Tests: 3 eggs × 1.25 → 4 eggs (not 3.75); 60 g oats × 1.25 → 75 g; quantity never 0 when recipe uses the ingredient; nutrition equals Σ quantity × `per`; cost equals Σ quantity × price/pack.
- [ ] Implement. Commit.

### Task 3: Profile, routine, inventory parsing

**Files:** Modify `lib/profile.mjs`; test `test/domain.test.mjs` (extend).

**Produces:** `parseProfile(body)` adds `student`, `week` (with `days[]` carrying `date`, `weekday`, `label`), `inventory`, `pins`; `defaultWeek({ startDate, days, snacks })`; `WEEKDAYS`, `SLOT_DEFAULT_MINUTES`; `profile.days === week.days.length`.

- [ ] Tests: body without `week` → 7 days from today, all slots home with default minutes; body with `week.days` of 3 → `days === 3`; invalid equipment value → 400; inventory with unknown ingredient id → 400; negative quantity → 400; `mealsPerDay: 3` drops snack from default days; `budgetWeekly: 0` → rejected; dates and labels correct for a given `startDate`.
- [ ] Implement. Commit.

### Task 4: Planner

**Files:** Create `lib/planner.mjs` (replaces `heuristicSkeleton`/`fitServings` in `lib/plan.mjs`); modify `lib/plan.mjs` (`buildPlan` uses `materialize`, day dates, `prepOn`, `eatOut`, `fit`, deviations; `validateSkeleton` uses candidate pools); tests `test/planner.test.mjs`, update `test/domain.test.mjs`.

**Produces:**
- `candidates(profile, dayIndex, slot) → { pool: Recipe[], level: 'strict'|'style'|'time'|'equipment'|'any', prepOnByRecipe: Map }`
- `fitPortions(recipes, targets, { floor }) → number[]` (servings)
- `planWeek(profile, targets) → { skeleton, notes: [{ kind: 'relaxed'|'budget'|'deviation', day?, slot?, text }] }`
- `buildPlan(skeleton, profile, targets) → plan` (shape in spec §7), `validateSkeleton(skeleton, profile, targets) → string[]`, `macroDeviations(totals, targets) → [{ macro, pct }]`, `MACRO_TOLERANCE = 0.15`.

- [ ] Tests: default profile → every day within ±10 % kcal and each macro within 15 % *or* a deviation note names it; Tuesday lunch `{ minutes: 10, where: 'away' }` with `microwave: false` → recipe has `portable` + `no-reheat` and `minutes ≤ 10`; `equipment: ['microwave']` only → no recipe needs stove/oven; meal-prep: lunch 10 min at home with Sunday prep day → a `meal-prep` recipe may appear with `prepOn` pointing to Sunday within `fridgeDays`; budget 40 vs unconstrained purchase ≈ 90 → purchase decreases and a `budget` note states the remaining gap with ≥ 1 concrete swap if still over; all-`away`, no-microwave, 5-minute days → plan returned with `relaxed` notes, no throw; deterministic: same input → same skeleton; vegan + nuts + soy allergy still produces a plan or a 422 with a clear message.
- [ ] Implement `candidates`, `fitPortions`, `planWeek`, update `buildPlan`/`validateSkeleton`; delete `heuristicSkeleton`/`fitServings`. Update old tests. Commit.

### Task 5: Groceries, inventory, budget totals

**Files:** Modify `lib/grocery.mjs`; test `test/grocery.test.mjs` (new; move grocery cases out of `domain.test.mjs`).

**Produces:** `groceries(plan, { inventory = [], have = [], bought = [], budget = null }) → { lines, totals }` (spec §5); `parseCheckoutItems` unchanged; `cartTotal` unchanged.

- [ ] Tests: inventory 500 g rice vs need 300 g → `fromInventory 300, toBuy 0, packs 0, packCost 0`; inventory 100 g vs need 300 g → `toBuy 200`; `have` covers need regardless of quantity; `bought` counted in `spent` not `toBuy`; `consumedCost ≤ packCost`; `leftover = packs×packSize − toBuy`; totals `diff = budget − purchase`; `perMeal` = consumed / meals; eat-out meals add their `cost` to `totals.eatingOut`, not to purchase.
- [ ] Implement. Commit.

### Task 6: Alternatives ("My day changed")

**Files:** Create `lib/adapt.mjs`; test `test/adapt.test.mjs`.

**Produces:** `REASONS = ['five_min','ten_min','missing_ingredient','another']`; `alternatives({ profile, skeleton, day, slot, reason, missingIngredientId, inventory, have, bought }) → { alternatives: [{ recipeId, name, servings, minutes, effectiveMinutes, nutrition: {kcal,protein,carbs,fat}, cost: { newPurchase, consumed }, newIngredients: [name], why: [text], tags }], message?: text }`.

- [ ] Tests: `five_min` → all results `effectiveMinutes ≤ 5`; `missing_ingredient: 'eggs'` → no result uses eggs; vegan profile → every result vegan; results exclude the current recipe; ≤ 3 results; when every ingredient of a result is in `bought`/inventory → `newPurchase === 0` and `why` includes "No new groceries"; servings chosen so `|kcal − old.kcal|` is minimal on the grid; impossible filter → `alternatives: []` with `message`.
- [ ] Implement. Commit.

### Task 7: HTTP routes and AI schema

**Files:** Modify `lib/http.mjs` (`generatePlan` → `planFromProfile`, add `buildResult`, routes `/api/plan/build`, `/api/alternatives`, config without `model`), `lib/ai.mjs` (per-day schema, routine in prompt), `lib/stores/mock.mjs` (message copy); tests `test/integration.test.mjs`, `test/ai.test.mjs`, `test/auth.test.mjs` (shape updates).

**Produces:** `buildResult({ profile, skeleton, have, bought }) → { profile, plan, groceries, notes }`; `POST /api/plan` → `{ ...buildResult, skeleton, source: 'ai'|'builtin', summary, warning }`; `POST /api/plan/build`; `POST /api/alternatives`; `GET /api/config` adds `equipment, skills, styles, slots, weekdays, ingredients, eatOut`.

- [ ] Tests: build round trip returns same totals as `/api/plan`; build with forbidden recipe → 422 naming day/slot; alternatives route validates `reason`; config JSON has no key named `model` and no string containing `API_KEY`; old-style body (no `week`) still returns a 7-day plan; AI fake: request schema has `day1..dayN` keys with enums limited to candidate pools; invalid AI output falls back with warning.
- [ ] Implement. Commit.

### Task 8: Front-end foundation (modules, strings, state v2, sheet)

**Files:** Create `public/js/{strings,dom,api,format,state,sheet,auth,app}.js`; modify `public/index.html` (script tag, new views/sheets markup), `public/styles.css`; delete `public/app.js`; test `test/client-state.test.mjs` (imports `public/js/state.js` pure helpers: `migrate`, `applySwapToState`).

- [ ] Tests: `migrate(v1State)` → v2 with `have = owned`, `bought = []`, `inventory = []`, `undo = []`; `applySwapToState(state, newSkeleton, newResult)` pushes old skeleton to `undo` (max 20) and moves no-longer-needed bought ingredients to inventory.
- [ ] Implement modules; app loads and renders existing flows exactly as before (manual check). Commit.

### Task 9: Wizard steps 4–6 and demo profile

**Files:** Create `public/js/wizard.js`, `public/js/demo.js`; modify `index.html`, `styles.css`, `strings.js`.

- [ ] Steps: Student life, Your week (same-every-day defaults + expandable days with per-slot minutes/where/fridge/microwave/meals/busy, start date), Pantry (search + chips + optional quantity). `toProfile(form)` emits `student`, `week`, `inventory`. "Try the demo student" button on empty home prefills form with `DEMO_PROFILE` and shows the "Demo profile (fictional)" notice.
- [ ] Manual check at 390 px: all steps navigable, validation messages, build succeeds. Commit.

### Task 10: Home, recipe sheet, My day changed, groceries

**Files:** Create `public/js/{home,recipe,adapt,groceries}.js`; modify `index.html`, `styles.css`, `strings.js`.

- [ ] Home: weekday + date picker, meal cards (time, cost, kcal, protein, badges), notes (deviations/relaxed/budget), budget chip, source badge "AI planner"/"Built-in planner".
- [ ] Recipe sheet: ingredients, steps, time, equipment, servings, nutrition, storage note, "My day changed" button.
- [ ] Adapt sheet: 5 reasons; missing-ingredient picker from the meal's ingredients; alternatives cards with time/cost/nutrition/why; confirm/cancel; eat out (demo catalog labelled, manual form); apply → `/api/plan/build` → state update; toast with Undo; loading/error/empty states.
- [ ] Groceries: have/bought toggles, budget bar + diff, to-buy vs spent, per-meal cost, leftovers list, labels for estimates and simulated store; checkout sends only `buy` lines.
- [ ] Manual check of the full demo flow at 390 px. Commit.

### Task 11: Docs, cleanup, push

- [ ] README: new routes, layout, demo flow, pending integrations. PLAN.md roadmap ticks. Remove dead code. `npm test` green. Push to `main`.
