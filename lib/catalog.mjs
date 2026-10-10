// Ingredient + recipe catalog. Every ingredient has exactly one canonical unit,
// so quantities from different recipes can be summed without unit conversion.
// Nutrition values are approximate per-serving estimates for the prototype.

export const DIET_RANK = { vegan: 0, vegetarian: 1, pescatarian: 2, omnivore: 3 };
export const ALLERGENS = ['gluten', 'dairy', 'egg', 'nuts', 'peanuts', 'soy', 'sesame', 'fish', 'shellfish'];
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

// allergens/diet are tagged per ingredient (diet defaults to vegan) and rolled up
// to recipes below, so a recipe can never contain an allergen it doesn't declare.
// labelRisk: packaged items whose brands vary on hidden gluten or animal ingredients
// (e.g. barley in tempeh, shrimp paste in curry paste); Instacart filters target these.
// unit: canonical unit used everywhere. pack: retail pack size in that unit. price: USD per pack.
// instacartUnit: unit string Instacart understands for this ingredient.
export const INGREDIENTS = {
  oats:            { name: 'Rolled oats',            unit: 'g',    category: 'Pantry',  pack: 1000, price: 4.49, instacartUnit: 'gram', allergens: ['gluten'] },
  banana:          { name: 'Bananas',                unit: 'each', category: 'Produce', pack: 1,    price: 0.29, instacartUnit: 'each', allergens: [] },
  blueberries:     { name: 'Blueberries',            unit: 'g',    category: 'Produce', pack: 170,  price: 3.99, instacartUnit: 'gram', allergens: [] },
  greek_yogurt:    { name: 'Plain Greek yogurt',     unit: 'g',    category: 'Dairy',   pack: 907,  price: 5.99, instacartUnit: 'gram', allergens: ['dairy'], diet: 'vegetarian' },
  milk:            { name: 'Milk (2%)',              unit: 'ml',   category: 'Dairy',   pack: 1890, price: 3.79, instacartUnit: 'milliliter', allergens: ['dairy'], diet: 'vegetarian' },
  soy_milk:        { name: 'Unsweetened soy milk',   unit: 'ml',   category: 'Dairy',   pack: 1890, price: 3.99, instacartUnit: 'milliliter', allergens: ['soy'] },
  oat_milk:        { name: 'Unsweetened oat milk',   unit: 'ml',   category: 'Dairy',   pack: 1890, price: 4.29, instacartUnit: 'milliliter', allergens: ['gluten'] },
  eggs:            { name: 'Large eggs',             unit: 'each', category: 'Dairy',   pack: 12,   price: 3.99, instacartUnit: 'each', allergens: ['egg'], diet: 'vegetarian' },
  whole_wheat_bread:{ name: 'Whole wheat bread',     unit: 'slice',category: 'Bakery',  pack: 20,   price: 3.49, instacartUnit: 'package', allergens: ['gluten'], labelRisk: ['vegan'] },
  avocado:         { name: 'Avocados',               unit: 'each', category: 'Produce', pack: 1,    price: 1.25, instacartUnit: 'each', allergens: [] },
  spinach:         { name: 'Baby spinach',           unit: 'g',    category: 'Produce', pack: 142,  price: 3.49, instacartUnit: 'gram', allergens: [] },
  tomato:          { name: 'Tomatoes',               unit: 'each', category: 'Produce', pack: 1,    price: 0.69, instacartUnit: 'each', allergens: [] },
  cucumber:        { name: 'Cucumbers',              unit: 'each', category: 'Produce', pack: 1,    price: 0.79, instacartUnit: 'each', allergens: [] },
  bell_pepper:     { name: 'Bell peppers',           unit: 'each', category: 'Produce', pack: 1,    price: 1.19, instacartUnit: 'each', allergens: [] },
  broccoli:        { name: 'Broccoli',               unit: 'g',    category: 'Produce', pack: 340,  price: 2.49, instacartUnit: 'gram', allergens: [] },
  sweet_potato:    { name: 'Sweet potatoes',         unit: 'g',    category: 'Produce', pack: 1360, price: 3.99, instacartUnit: 'gram', allergens: [] },
  onion:           { name: 'Yellow onions',          unit: 'each', category: 'Produce', pack: 1,    price: 0.89, instacartUnit: 'each', allergens: [] },
  garlic:          { name: 'Garlic',                 unit: 'clove',category: 'Produce', pack: 10,   price: 0.79, instacartUnit: 'head', allergens: [] },
  lemon:           { name: 'Lemons',                 unit: 'each', category: 'Produce', pack: 1,    price: 0.69, instacartUnit: 'each', allergens: [] },
  apple:           { name: 'Apples',                 unit: 'each', category: 'Produce', pack: 1,    price: 0.99, instacartUnit: 'each', allergens: [] },
  carrot:          { name: 'Carrots',                unit: 'g',    category: 'Produce', pack: 907,  price: 1.79, instacartUnit: 'gram', allergens: [] },
  mixed_greens:    { name: 'Mixed salad greens',     unit: 'g',    category: 'Produce', pack: 142,  price: 3.99, instacartUnit: 'gram', allergens: [] },
  chicken_breast:  { name: 'Chicken breast',         unit: 'g',    category: 'Meat & Seafood', pack: 680, price: 7.99, instacartUnit: 'gram', allergens: [], diet: 'omnivore' },
  ground_turkey:   { name: 'Lean ground turkey',     unit: 'g',    category: 'Meat & Seafood', pack: 454, price: 5.99, instacartUnit: 'gram', allergens: [], diet: 'omnivore' },
  salmon:          { name: 'Salmon fillet',          unit: 'g',    category: 'Meat & Seafood', pack: 454, price: 11.99, instacartUnit: 'gram', allergens: ['fish'], diet: 'pescatarian' },
  shrimp:          { name: 'Shrimp (peeled)',        unit: 'g',    category: 'Meat & Seafood', pack: 454, price: 9.99, instacartUnit: 'gram', allergens: ['shellfish'], diet: 'pescatarian' },
  tuna_can:        { name: 'Canned tuna in water',   unit: 'can',  category: 'Pantry',  pack: 1,    price: 1.49, instacartUnit: 'can', allergens: ['fish'], diet: 'pescatarian' },
  tofu:            { name: 'Extra-firm tofu',        unit: 'g',    category: 'Produce', pack: 397,  price: 2.49, instacartUnit: 'gram', allergens: ['soy'] },
  tempeh:          { name: 'Tempeh',                 unit: 'g',    category: 'Produce', pack: 227,  price: 3.49, instacartUnit: 'gram', allergens: ['soy'], labelRisk: ['gluten'] },
  chickpeas:       { name: 'Canned chickpeas',       unit: 'can',  category: 'Pantry',  pack: 1,    price: 1.19, instacartUnit: 'can', allergens: [] },
  black_beans:     { name: 'Canned black beans',     unit: 'can',  category: 'Pantry',  pack: 1,    price: 1.09, instacartUnit: 'can', allergens: [] },
  lentils:         { name: 'Dry red lentils',        unit: 'g',    category: 'Pantry',  pack: 454,  price: 2.29, instacartUnit: 'gram', allergens: [] },
  quinoa:          { name: 'Quinoa',                 unit: 'g',    category: 'Pantry',  pack: 340,  price: 4.49, instacartUnit: 'gram', allergens: [] },
  brown_rice:      { name: 'Brown rice',             unit: 'g',    category: 'Pantry',  pack: 907,  price: 2.99, instacartUnit: 'gram', allergens: [] },
  ww_pasta:        { name: 'Whole wheat pasta',      unit: 'g',    category: 'Pantry',  pack: 454,  price: 1.99, instacartUnit: 'gram', allergens: ['gluten'] },
  ww_tortilla:     { name: 'Whole wheat tortillas',  unit: 'each', category: 'Bakery',  pack: 8,    price: 3.29, instacartUnit: 'package', allergens: ['gluten'], labelRisk: ['vegan'] },
  corn_tortilla:   { name: 'Corn tortillas',         unit: 'each', category: 'Bakery',  pack: 30,   price: 2.99, instacartUnit: 'package', allergens: [], labelRisk: ['gluten', 'vegan'] },
  olive_oil:       { name: 'Extra virgin olive oil', unit: 'ml',   category: 'Pantry',  pack: 500,  price: 8.99, instacartUnit: 'milliliter', allergens: [] },
  soy_sauce:       { name: 'Low-sodium soy sauce',   unit: 'ml',   category: 'Pantry',  pack: 296,  price: 2.99, instacartUnit: 'milliliter', allergens: ['soy', 'gluten'] },
  peanut_butter:   { name: 'Natural peanut butter',  unit: 'g',    category: 'Pantry',  pack: 454,  price: 3.99, instacartUnit: 'gram', allergens: ['peanuts'] },
  almonds:         { name: 'Raw almonds',            unit: 'g',    category: 'Pantry',  pack: 340,  price: 6.99, instacartUnit: 'gram', allergens: ['nuts'] },
  chia_seeds:      { name: 'Chia seeds',             unit: 'g',    category: 'Pantry',  pack: 340,  price: 5.49, instacartUnit: 'gram', allergens: [] },
  hummus:          { name: 'Hummus',                 unit: 'g',    category: 'Deli',    pack: 283,  price: 3.99, instacartUnit: 'gram', allergens: ['sesame'] },
  feta:            { name: 'Feta cheese',            unit: 'g',    category: 'Dairy',   pack: 170,  price: 4.49, instacartUnit: 'gram', allergens: ['dairy'], diet: 'vegetarian' },
  cheddar:         { name: 'Cheddar cheese',         unit: 'g',    category: 'Dairy',   pack: 227,  price: 3.99, instacartUnit: 'gram', allergens: ['dairy'], diet: 'vegetarian' },
  cottage_cheese:  { name: 'Low-fat cottage cheese', unit: 'g',    category: 'Dairy',   pack: 680,  price: 4.29, instacartUnit: 'gram', allergens: ['dairy'], diet: 'vegetarian' },
  salsa:           { name: 'Salsa',                  unit: 'g',    category: 'Pantry',  pack: 454,  price: 3.29, instacartUnit: 'gram', allergens: [] },
  coconut_milk:    { name: 'Light coconut milk',     unit: 'ml',   category: 'Pantry',  pack: 400,  price: 2.49, instacartUnit: 'milliliter', allergens: [] },
  curry_paste:     { name: 'Vegan red curry paste',        unit: 'g',    category: 'Pantry',  pack: 113,  price: 3.49, instacartUnit: 'gram', allergens: [], labelRisk: ['gluten', 'vegan'] },
  protein_powder_pea: { name: 'Pea protein powder',  unit: 'g',    category: 'Pantry',  pack: 907,  price: 24.99, instacartUnit: 'gram', allergens: [], labelRisk: ['gluten', 'vegan'] },
  edamame:         { name: 'Frozen shelled edamame', unit: 'g',    category: 'Frozen',  pack: 340,  price: 2.99, instacartUnit: 'gram', allergens: ['soy'] },
  seitan:          { name: 'Seitan',                 unit: 'g',    category: 'Produce', pack: 227,  price: 4.99, instacartUnit: 'gram', allergens: ['gluten'] },
  pumpkin_seeds:   { name: 'Pumpkin seeds',          unit: 'g',    category: 'Pantry',  pack: 283,  price: 4.99, instacartUnit: 'gram', allergens: [] },
};

// Per-serving nutrition (kcal, protein/carbs/fat in grams) and ingredients per serving.
const RECIPE_DEFS = [
  { id: 'overnight-oats', name: 'Blueberry overnight oats', slot: 'breakfast',
    kcal: 420, protein: 24, carbs: 62, fat: 9, minutes: 5,
    ingredients: [['oats', 60], ['greek_yogurt', 150], ['blueberries', 75], ['milk', 100], ['chia_seeds', 10]] },
  { id: 'vegan-protein-oats', name: 'Pea-protein oat bowl', slot: 'breakfast',
    kcal: 430, protein: 30, carbs: 60, fat: 8, minutes: 5,
    ingredients: [['oats', 60], ['protein_powder_pea', 25], ['oat_milk', 200], ['banana', 1], ['chia_seeds', 10]] },
  { id: 'veggie-scramble', name: 'Spinach & pepper egg scramble with toast', slot: 'breakfast',
    kcal: 390, protein: 24, carbs: 30, fat: 19, minutes: 12,
    ingredients: [['eggs', 3], ['spinach', 40], ['bell_pepper', 0.5], ['whole_wheat_bread', 1], ['olive_oil', 5]] },
  { id: 'avocado-toast-egg', name: 'Avocado toast with eggs', slot: 'breakfast',
    kcal: 450, protein: 20, carbs: 34, fat: 26, minutes: 10,
    ingredients: [['whole_wheat_bread', 2], ['avocado', 0.5], ['eggs', 2], ['tomato', 0.5]] },
  { id: 'tofu-scramble', name: 'Turmeric tofu scramble', slot: 'breakfast',
    kcal: 340, protein: 26, carbs: 14, fat: 20, minutes: 12,
    ingredients: [['tofu', 200], ['spinach', 40], ['tomato', 0.5], ['onion', 0.25], ['olive_oil', 5]] },
  { id: 'yogurt-parfait', name: 'Greek yogurt parfait', slot: 'breakfast',
    kcal: 380, protein: 28, carbs: 40, fat: 12, minutes: 3,
    ingredients: [['greek_yogurt', 200], ['blueberries', 75], ['almonds', 15], ['banana', 0.5]] },

  { id: 'chicken-quinoa-bowl', name: 'Lemon chicken quinoa bowl', slot: 'lunch',
    kcal: 560, protein: 45, carbs: 52, fat: 18, minutes: 25,
    ingredients: [['chicken_breast', 150], ['quinoa', 60], ['cucumber', 0.5], ['tomato', 0.5], ['lemon', 0.5], ['olive_oil', 10]] },
  { id: 'chickpea-salad', name: 'Mediterranean chickpea salad', slot: 'lunch',
    kcal: 480, protein: 19, carbs: 52, fat: 21, minutes: 10,
    ingredients: [['chickpeas', 0.75], ['cucumber', 0.5], ['tomato', 1], ['feta', 30], ['lemon', 0.5], ['olive_oil', 10]] },
  { id: 'tuna-wrap', name: 'Tuna & greens wrap', slot: 'lunch',
    kcal: 430, protein: 38, carbs: 36, fat: 14, minutes: 8,
    ingredients: [['tuna_can', 1], ['ww_tortilla', 1], ['mixed_greens', 40], ['avocado', 0.25], ['lemon', 0.25]] },
  { id: 'turkey-chili', name: 'Turkey & black bean chili', slot: 'lunch',
    kcal: 520, protein: 42, carbs: 44, fat: 17, minutes: 35,
    ingredients: [['ground_turkey', 125], ['black_beans', 0.5], ['tomato', 1], ['onion', 0.5], ['bell_pepper', 0.5], ['garlic', 1]] },
  { id: 'lentil-soup', name: 'Red lentil & carrot soup', slot: 'lunch',
    kcal: 410, protein: 22, carbs: 62, fat: 8, minutes: 30,
    ingredients: [['lentils', 80], ['carrot', 100], ['onion', 0.5], ['garlic', 1], ['olive_oil', 5], ['spinach', 30]] },
  { id: 'tempeh-grain-bowl', name: 'Tempeh brown rice bowl', slot: 'lunch',
    kcal: 590, protein: 32, carbs: 66, fat: 21, minutes: 25,
    ingredients: [['tempeh', 110], ['brown_rice', 60], ['broccoli', 100], ['carrot', 50], ['soy_sauce', 10]] },
  { id: 'seitan-bean-bowl', name: 'Seitan, black bean & quinoa bowl', slot: 'lunch',
    kcal: 560, protein: 44, carbs: 60, fat: 13, minutes: 20,
    ingredients: [['seitan', 100], ['black_beans', 0.5], ['quinoa', 50], ['bell_pepper', 0.5], ['salsa', 40], ['olive_oil', 5]] },

  { id: 'salmon-sweet-potato', name: 'Roast salmon, sweet potato & broccoli', slot: 'dinner',
    kcal: 610, protein: 40, carbs: 48, fat: 26, minutes: 30,
    ingredients: [['salmon', 150], ['sweet_potato', 200], ['broccoli', 120], ['olive_oil', 5], ['lemon', 0.25]] },
  { id: 'chicken-stir-fry', name: 'Chicken & veggie stir-fry with rice', slot: 'dinner',
    kcal: 590, protein: 46, carbs: 62, fat: 14, minutes: 25,
    ingredients: [['chicken_breast', 150], ['brown_rice', 60], ['broccoli', 100], ['bell_pepper', 0.5], ['soy_sauce', 15], ['garlic', 1]] },
  { id: 'shrimp-tacos', name: 'Garlic shrimp tacos', slot: 'dinner',
    kcal: 520, protein: 36, carbs: 50, fat: 18, minutes: 20,
    ingredients: [['shrimp', 150], ['corn_tortilla', 3], ['avocado', 0.5], ['salsa', 50], ['garlic', 1], ['lemon', 0.25]] },
  { id: 'chickpea-curry', name: 'Chickpea & spinach coconut curry', slot: 'dinner',
    kcal: 560, protein: 18, carbs: 72, fat: 22, minutes: 30,
    ingredients: [['chickpeas', 0.75], ['coconut_milk', 100], ['curry_paste', 15], ['spinach', 60], ['onion', 0.5], ['brown_rice', 50]] },
  { id: 'turkey-pasta', name: 'Turkey bolognese with whole wheat pasta', slot: 'dinner',
    kcal: 620, protein: 44, carbs: 70, fat: 17, minutes: 30,
    ingredients: [['ground_turkey', 125], ['ww_pasta', 85], ['tomato', 1.5], ['onion', 0.5], ['garlic', 2], ['olive_oil', 5]] },
  { id: 'tofu-broccoli', name: 'Crispy tofu & broccoli with quinoa', slot: 'dinner',
    kcal: 540, protein: 32, carbs: 50, fat: 22, minutes: 30,
    ingredients: [['tofu', 200], ['broccoli', 150], ['quinoa', 50], ['soy_sauce', 10], ['garlic', 1], ['olive_oil', 10]] },
  { id: 'veggie-burrito-bowl', name: 'Black bean burrito bowl', slot: 'dinner',
    kcal: 580, protein: 24, carbs: 80, fat: 18, minutes: 20,
    ingredients: [['black_beans', 0.75], ['brown_rice', 60], ['bell_pepper', 0.5], ['salsa', 60], ['cheddar', 25], ['avocado', 0.25]] },
  { id: 'lentil-bolognese', name: 'Lentil bolognese with quinoa', slot: 'dinner',
    kcal: 520, protein: 28, carbs: 80, fat: 9, minutes: 35,
    ingredients: [['lentils', 75], ['quinoa', 50], ['tomato', 1.5], ['carrot', 60], ['onion', 0.5], ['garlic', 2], ['olive_oil', 5]] },

  { id: 'apple-pb', name: 'Apple with peanut butter', slot: 'snack',
    kcal: 280, protein: 8, carbs: 30, fat: 16, minutes: 2,
    ingredients: [['apple', 1], ['peanut_butter', 32]] },
  { id: 'hummus-veg', name: 'Hummus & veggie sticks', slot: 'snack',
    kcal: 200, protein: 7, carbs: 22, fat: 10, minutes: 5,
    ingredients: [['hummus', 70], ['carrot', 80], ['cucumber', 0.5]] },
  { id: 'cottage-berries', name: 'Cottage cheese & berries', slot: 'snack',
    kcal: 210, protein: 26, carbs: 18, fat: 3, minutes: 2,
    ingredients: [['cottage_cheese', 200], ['blueberries', 50]] },
  { id: 'edamame-snack', name: 'Steamed edamame', slot: 'snack',
    kcal: 190, protein: 17, carbs: 13, fat: 8, minutes: 5,
    ingredients: [['edamame', 150]] },
  { id: 'almonds-banana', name: 'Banana & almonds', slot: 'snack',
    kcal: 270, protein: 8, carbs: 30, fat: 15, minutes: 1,
    ingredients: [['banana', 1], ['almonds', 25]] },
  { id: 'pumpkin-seed-apple', name: 'Apple & pumpkin seeds', slot: 'snack',
    kcal: 250, protein: 10, carbs: 28, fat: 13, minutes: 1,
    ingredients: [['apple', 1], ['pumpkin_seeds', 28]] },
];

// Derived: `diet` is the most permissive diet any ingredient requires (e.g. one egg
// makes the recipe vegetarian), `allergens` is the union across ingredients.
export const RECIPES = RECIPE_DEFS.map((r) => {
  const ings = r.ingredients.map(([id]) => INGREDIENTS[id]);
  const diet = ings.reduce((d, i) => (DIET_RANK[i.diet ?? 'vegan'] > DIET_RANK[d] ? i.diet : d), 'vegan');
  const allergens = [...new Set(ings.flatMap((i) => i.allergens))].sort();
  return { ...r, diet, allergens };
});

export const RECIPES_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// Own-property lookups so untrusted ids like "__proto__" or "constructor" never resolve.
export const getRecipe = (id) => (Object.hasOwn(RECIPES_BY_ID, id) ? RECIPES_BY_ID[id] : undefined);
export const getIngredient = (id) => (Object.hasOwn(INGREDIENTS, id) ? INGREDIENTS[id] : undefined);

// The single source of truth for "may this person eat this recipe?". Used by both
// the deterministic planner and the validator that checks Claude's output.
export function isRecipeAllowed(recipe, { diet, allergies = [], dislikes = [] }) {
  if (DIET_RANK[recipe.diet] > DIET_RANK[diet]) return false;
  if (recipe.allergens.some((a) => allergies.includes(a))) return false;
  if (dislikes.length) {
    const words = dislikes.map((d) => d.toLowerCase());
    const haystack = [recipe.name, ...recipe.ingredients.map(([id]) => INGREDIENTS[id].name)].join(' ').toLowerCase();
    if (words.some((w) => haystack.includes(w))) return false;
  }
  return true;
}

export function allowedRecipes(profile) {
  return RECIPES.filter((r) => isRecipeAllowed(r, profile));
}
