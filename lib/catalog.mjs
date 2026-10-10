// Ingredient + recipe catalog. Every ingredient has exactly one canonical unit,
// so quantities from different recipes can be summed without unit conversion.
// Nutrition is stored per ingredient unit and rolled up to recipes, so a recipe's
// macros always match its (rounded) ingredient quantities. Values are approximate
// estimates for the prototype (USDA FoodData Central ranges).

export const DIET_RANK = { vegan: 0, vegetarian: 1, pescatarian: 2, omnivore: 3 };
export const ALLERGENS = ['gluten', 'dairy', 'egg', 'nuts', 'peanuts', 'soy', 'sesame', 'fish', 'shellfish'];
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const EQUIPMENT = ['stove', 'oven', 'microwave', 'airfryer'];
export const SKILLS = ['beginner', 'comfortable', 'confident'];
export const SKILL_RANK = { beginner: 0, comfortable: 1, confident: 2 };
export const STYLES = ['quick', 'homemade', 'bought'];
// portable: travels well in a bag. no-reheat: good cold or at room temperature.
// needs-fridge: perishable, keep chilled until eaten. eat-in-10: ready to eat in ten
// minutes or less. meal-prep: cook once on a prep day, reheat on the day (reheatMinutes).
export const TAGS = ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10', 'meal-prep'];
export const STORAGE = ['pantry', 'fridge', 'freezer'];

// USDA FoodKeeper guidance used for every perishable: refrigerate within 2 hours
// (1 hour above 90 °F / 32 °C); cooked leftovers keep 3–4 days in the fridge.
export const STORAGE_RULE = 'Refrigerate perishable food within 2 hours (1 hour in hot weather). Cooked leftovers keep 3–4 days in the fridge.';

// allergens/diet are tagged per ingredient (diet defaults to vegan) and rolled up
// to recipes below, so a recipe can never contain an allergen it doesn't declare.
// labelRisk: packaged items whose brands vary on hidden gluten or animal ingredients
// (e.g. barley in tempeh, shrimp paste in curry paste); Instacart filters target these.
// unit: canonical unit used everywhere. pack: retail pack size in that unit. price: USD per pack.
// per: nutrition per 1 unit [kcal, protein g, carbs g, fat g]. step: smallest practical
// portion in canonical units (whole eggs, half an avocado, 5 g of rice).
// storage: where it lives at home; fridgeDays: how long once opened/cut (FoodKeeper).
const I = (name, unit, category, pack, price, instacartUnit, per, step, storage, extra = {}) => ({
  name, unit, category, pack, price, instacartUnit, allergens: [], step, storage,
  per: { kcal: per[0], protein: per[1], carbs: per[2], fat: per[3] }, ...extra,
});

export const INGREDIENTS = {
  oats:            I('Rolled oats',            'g',    'Pantry',  1000, 4.49, 'gram',        [3.89, 0.169, 0.66, 0.069], 5, 'pantry', { allergens: ['gluten'] }),
  banana:          I('Bananas',                'each', 'Produce', 1,    0.29, 'each',        [105, 1.3, 27, 0.4],       0.5, 'pantry'),
  blueberries:     I('Blueberries',            'g',    'Produce', 170,  3.99, 'gram',        [0.57, 0.007, 0.145, 0.003], 5, 'fridge', { fridgeDays: 5 }),
  greek_yogurt:    I('Plain Greek yogurt',     'g',    'Dairy',   907,  5.99, 'gram',        [0.73, 0.099, 0.039, 0.019], 5, 'fridge', { allergens: ['dairy'], diet: 'vegetarian', fridgeDays: 7 }),
  milk:            I('Milk (2%)',              'ml',   'Dairy',   1890, 3.79, 'milliliter',  [0.5, 0.033, 0.048, 0.02],  5, 'fridge', { allergens: ['dairy'], diet: 'vegetarian', fridgeDays: 7 }),
  soy_milk:        I('Unsweetened soy milk',   'ml',   'Dairy',   1890, 3.99, 'milliliter',  [0.35, 0.03, 0.01, 0.02],   5, 'fridge', { allergens: ['soy'], fridgeDays: 7 }),
  oat_milk:        I('Unsweetened oat milk',   'ml',   'Dairy',   1890, 4.29, 'milliliter',  [0.4, 0.01, 0.065, 0.015],  5, 'fridge', { allergens: ['gluten'], fridgeDays: 7 }),
  eggs:            I('Large eggs',             'each', 'Dairy',   12,   3.99, 'each',        [72, 6.3, 0.4, 4.8],       1, 'fridge', { allergens: ['egg'], diet: 'vegetarian', fridgeDays: 21 }),
  whole_wheat_bread: I('Whole wheat bread',    'slice','Bakery',  20,   3.49, 'package',     [80, 4, 14, 1],            1, 'pantry', { allergens: ['gluten'], labelRisk: ['vegan'] }),
  avocado:         I('Avocados',               'each', 'Produce', 1,    1.25, 'each',        [240, 3, 13, 22],          0.5, 'pantry'),
  spinach:         I('Baby spinach',           'g',    'Produce', 142,  3.49, 'gram',        [0.23, 0.029, 0.036, 0.004], 5, 'fridge', { fridgeDays: 5 }),
  tomato:          I('Tomatoes',               'each', 'Produce', 1,    0.69, 'each',        [22, 1.1, 4.8, 0.2],       0.5, 'pantry'),
  cucumber:        I('Cucumbers',              'each', 'Produce', 1,    0.79, 'each',        [45, 2, 11, 0.3],          0.5, 'fridge', { fridgeDays: 7 }),
  bell_pepper:     I('Bell peppers',           'each', 'Produce', 1,    1.19, 'each',        [31, 1, 7, 0.3],           0.5, 'fridge', { fridgeDays: 7 }),
  broccoli:        I('Broccoli',               'g',    'Produce', 340,  2.49, 'gram',        [0.34, 0.028, 0.07, 0.004], 5, 'fridge', { fridgeDays: 5 }),
  sweet_potato:    I('Sweet potatoes',         'g',    'Produce', 1360, 3.99, 'gram',        [0.86, 0.016, 0.2, 0.001], 5, 'pantry'),
  potato:          I('Russet potatoes',        'g',    'Produce', 2270, 3.99, 'gram',        [0.77, 0.02, 0.17, 0.001], 5, 'pantry'),
  onion:           I('Yellow onions',          'each', 'Produce', 1,    0.89, 'each',        [44, 1.2, 10, 0.1],        0.25, 'pantry'),
  garlic:          I('Garlic',                 'clove','Produce', 10,   0.79, 'head',        [4, 0.2, 1, 0],            1, 'pantry'),
  lemon:           I('Lemons',                 'each', 'Produce', 1,    0.69, 'each',        [17, 0.6, 5, 0.2],         0.25, 'pantry'),
  apple:           I('Apples',                 'each', 'Produce', 1,    0.99, 'each',        [95, 0.5, 25, 0.3],        1, 'pantry'),
  carrot:          I('Carrots',                'g',    'Produce', 907,  1.79, 'gram',        [0.41, 0.009, 0.1, 0.002], 5, 'fridge', { fridgeDays: 14 }),
  mixed_greens:    I('Mixed salad greens',     'g',    'Produce', 142,  3.99, 'gram',        [0.2, 0.02, 0.03, 0.003],  5, 'fridge', { fridgeDays: 4 }),
  chicken_breast:  I('Chicken breast',         'g',    'Meat & Seafood', 680, 7.99, 'gram',  [1.2, 0.225, 0, 0.026],    5, 'fridge', { diet: 'omnivore', fridgeDays: 2 }),
  ground_turkey:   I('Lean ground turkey',     'g',    'Meat & Seafood', 454, 5.99, 'gram',  [1.5, 0.187, 0, 0.08],     5, 'fridge', { diet: 'omnivore', fridgeDays: 2 }),
  deli_turkey:     I('Sliced turkey breast',   'g',    'Deli',    227,  5.99, 'gram',        [1.0, 0.17, 0.03, 0.02],   5, 'fridge', { diet: 'omnivore', fridgeDays: 5 }),
  salmon:          I('Salmon fillet',          'g',    'Meat & Seafood', 454, 11.99, 'gram', [2.08, 0.2, 0, 0.13],      5, 'fridge', { allergens: ['fish'], diet: 'pescatarian', fridgeDays: 2 }),
  shrimp:          I('Shrimp (peeled)',        'g',    'Meat & Seafood', 454, 9.99, 'gram',  [0.85, 0.2, 0, 0.005],     5, 'fridge', { allergens: ['shellfish'], diet: 'pescatarian', fridgeDays: 2 }),
  tuna_can:        I('Canned tuna in water',   'can',  'Pantry',  1,    1.49, 'can',         [120, 27, 0, 1],           1, 'pantry', { allergens: ['fish'], diet: 'pescatarian' }),
  tofu:            I('Extra-firm tofu',        'g',    'Produce', 397,  2.49, 'gram',        [1.4, 0.16, 0.03, 0.08],   5, 'fridge', { allergens: ['soy'], fridgeDays: 5 }),
  tempeh:          I('Tempeh',                 'g',    'Produce', 227,  3.49, 'gram',        [1.92, 0.2, 0.08, 0.11],   5, 'fridge', { allergens: ['soy'], labelRisk: ['gluten'], fridgeDays: 7 }),
  seitan:          I('Seitan',                 'g',    'Produce', 227,  4.99, 'gram',        [1.3, 0.25, 0.05, 0.015],  5, 'fridge', { allergens: ['gluten'], fridgeDays: 5 }),
  chickpeas:       I('Canned chickpeas',       'can',  'Pantry',  1,    1.19, 'can',         [400, 20, 65, 6],          0.5, 'pantry'),
  black_beans:     I('Canned black beans',     'can',  'Pantry',  1,    1.09, 'can',         [240, 15, 42, 1],          0.5, 'pantry'),
  lentils:         I('Dry red lentils',        'g',    'Pantry',  454,  2.29, 'gram',        [3.52, 0.25, 0.6, 0.011],  5, 'pantry'),
  quinoa:          I('Quinoa',                 'g',    'Pantry',  340,  4.49, 'gram',        [3.68, 0.14, 0.64, 0.06],  5, 'pantry'),
  brown_rice:      I('Brown rice',             'g',    'Pantry',  907,  2.99, 'gram',        [3.62, 0.075, 0.76, 0.027], 5, 'pantry'),
  microwave_rice:  I('Microwave rice pouch',   'each', 'Pantry',  1,    2.29, 'each',        [350, 7, 72, 3],           0.5, 'pantry'),
  ww_pasta:        I('Whole wheat pasta',      'g',    'Pantry',  454,  1.99, 'gram',        [3.48, 0.14, 0.73, 0.015], 5, 'pantry', { allergens: ['gluten'] }),
  ramen:           I('Instant ramen (noodles only)', 'each', 'Pantry', 1, 0.49, 'each',     [380, 8, 52, 14],          1, 'pantry', { allergens: ['gluten'] }),
  ww_tortilla:     I('Whole wheat tortillas',  'each', 'Bakery',  8,    3.29, 'package',     [130, 4, 22, 3],           1, 'pantry', { allergens: ['gluten'], labelRisk: ['vegan'] }),
  corn_tortilla:   I('Corn tortillas',         'each', 'Bakery',  30,   2.99, 'package',     [60, 1.5, 12, 1],          1, 'pantry', { labelRisk: ['gluten', 'vegan'] }),
  pita:            I('Whole wheat pita',       'each', 'Bakery',  6,    2.99, 'package',     [165, 5.5, 33, 1],         1, 'pantry', { allergens: ['gluten'], labelRisk: ['vegan'] }),
  rice_cakes:      I('Rice cakes',             'each', 'Pantry',  14,   2.49, 'package',     [35, 0.7, 7, 0.3],         1, 'pantry'),
  crackers:        I('Whole grain crackers',   'g',    'Pantry',  200,  3.29, 'gram',        [4.2, 0.09, 0.7, 0.12],    5, 'pantry', { allergens: ['gluten'] }),
  granola:         I('Granola',                'g',    'Pantry',  340,  4.49, 'gram',        [4.71, 0.1, 0.64, 0.2],    5, 'pantry', { allergens: ['gluten'], labelRisk: ['vegan'] }),
  olive_oil:       I('Extra virgin olive oil', 'ml',   'Pantry',  500,  8.99, 'milliliter',  [8.1, 0, 0, 0.92],         5, 'pantry'),
  soy_sauce:       I('Low-sodium soy sauce',   'ml',   'Pantry',  296,  2.99, 'milliliter',  [0.6, 0.1, 0.05, 0],       5, 'pantry', { allergens: ['soy', 'gluten'] }),
  peanut_butter:   I('Natural peanut butter',  'g',    'Pantry',  454,  3.99, 'gram',        [5.88, 0.25, 0.2, 0.5],    5, 'pantry', { allergens: ['peanuts'] }),
  almonds:         I('Raw almonds',            'g',    'Pantry',  340,  6.99, 'gram',        [5.79, 0.21, 0.22, 0.5],   5, 'pantry', { allergens: ['nuts'] }),
  chia_seeds:      I('Chia seeds',             'g',    'Pantry',  340,  5.49, 'gram',        [4.86, 0.17, 0.42, 0.31],  5, 'pantry'),
  pumpkin_seeds:   I('Pumpkin seeds',          'g',    'Pantry',  283,  4.99, 'gram',        [5.59, 0.3, 0.11, 0.49],   5, 'pantry'),
  hummus:          I('Hummus',                 'g',    'Deli',    283,  3.99, 'gram',        [1.66, 0.08, 0.14, 0.1],   5, 'fridge', { allergens: ['sesame'], fridgeDays: 7 }),
  feta:            I('Feta cheese',            'g',    'Dairy',   170,  4.49, 'gram',        [2.64, 0.14, 0.04, 0.21],  5, 'fridge', { allergens: ['dairy'], diet: 'vegetarian', fridgeDays: 7 }),
  cheddar:         I('Cheddar cheese',         'g',    'Dairy',   227,  3.99, 'gram',        [4.03, 0.23, 0.013, 0.33], 5, 'fridge', { allergens: ['dairy'], diet: 'vegetarian', fridgeDays: 21 }),
  cottage_cheese:  I('Low-fat cottage cheese', 'g',    'Dairy',   680,  4.29, 'gram',        [0.72, 0.12, 0.03, 0.01],  5, 'fridge', { allergens: ['dairy'], diet: 'vegetarian', fridgeDays: 7 }),
  salsa:           I('Salsa',                  'g',    'Pantry',  454,  3.29, 'gram',        [0.36, 0.015, 0.07, 0.002], 5, 'pantry', { fridgeDays: 14 }),
  coconut_milk:    I('Light coconut milk',     'ml',   'Pantry',  400,  2.49, 'milliliter',  [0.7, 0.005, 0.02, 0.065], 5, 'pantry'),
  curry_paste:     I('Vegan red curry paste',  'g',    'Pantry',  113,  3.49, 'gram',        [1.2, 0.02, 0.14, 0.06],   5, 'pantry', { labelRisk: ['gluten', 'vegan'] }),
  protein_powder_pea: I('Pea protein powder',  'g',    'Pantry',  907,  24.99, 'gram',       [3.75, 0.8, 0.05, 0.05],   5, 'pantry', { labelRisk: ['gluten', 'vegan'] }),
  edamame:         I('Frozen shelled edamame', 'g',    'Frozen',  340,  2.99, 'gram',        [1.21, 0.11, 0.09, 0.05],  5, 'freezer', { allergens: ['soy'] }),
  frozen_veg:      I('Frozen mixed vegetables','g',    'Frozen',  454,  1.99, 'gram',        [0.65, 0.03, 0.13, 0.005], 5, 'freezer'),
  protein_bar:     I('Protein bar',            'each', 'Ready to eat', 1, 1.79, 'each',      [200, 20, 22, 7],          1, 'pantry', { allergens: ['nuts', 'dairy', 'soy'], diet: 'vegetarian', labelRisk: ['gluten'] }),
  ready_wrap:      I('Chicken caesar wrap (ready to eat)', 'each', 'Ready to eat', 1, 4.99, 'each', [450, 25, 40, 20], 1, 'fridge', { allergens: ['gluten', 'dairy', 'egg'], diet: 'omnivore', fridgeDays: 2 }),
  ready_salad:     I('Chicken salad kit (ready to eat)', 'each', 'Ready to eat', 1, 5.49, 'each', [350, 24, 22, 18], 1, 'fridge', { allergens: ['dairy', 'egg'], diet: 'omnivore', fridgeDays: 2 }),
};

const S = (fridgeDays, freezer, note) => ({ fridgeDays, freezer, note });
const LEFTOVERS = S(4, true, 'Cool within 2 hours and refrigerate in a sealed container; eat within 3–4 days or freeze for up to 3 months.');
const COLD_PREP = S(3, false, 'Keep refrigerated and eat within 3 days. Do not leave out for more than 2 hours.');
const NO_STORE = S(0, false, 'Best eaten right away.');
const SHELF = S(0, false, 'Shelf-stable; keep sealed at room temperature.');

// Per-serving ingredient quantities. kcal/macros/cost are derived from the ingredients.
// minutes: total time. activeMinutes: hands-on time. reheatMinutes: time on the day when
// the meal was cooked on a prep day (meal-prep recipes only).
const RECIPE_DEFS = [
  // ---------- breakfast ----------
  { id: 'overnight-oats', name: 'Blueberry overnight oats', slot: 'breakfast', minutes: 5, activeMinutes: 5, reheatMinutes: 1,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10', 'meal-prep'], storage: S(4, false, 'Make up to 4 jars at once; keep refrigerated and eat within 4 days.'),
    ingredients: [['oats', 50], ['greek_yogurt', 120], ['blueberries', 60], ['milk', 100], ['chia_seeds', 10]],
    steps: ['Stir oats, yogurt, milk and chia in a jar.', 'Top with blueberries, cover and refrigerate overnight.', 'Eat cold straight from the jar.'] },
  { id: 'vegan-protein-oats', name: 'Pea-protein oat bowl', slot: 'breakfast', minutes: 5, activeMinutes: 5, reheatMinutes: 1,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10', 'meal-prep'], storage: S(4, false, 'Keep refrigerated and eat within 4 days.'),
    ingredients: [['oats', 50], ['protein_powder_pea', 25], ['oat_milk', 200], ['banana', 1], ['chia_seeds', 10]],
    steps: ['Whisk protein powder into the oat milk.', 'Stir in oats and chia; refrigerate at least 2 hours or overnight.', 'Slice the banana on top before eating.'] },
  { id: 'microwave-oats', name: 'Microwave oatmeal with banana & peanut butter', slot: 'breakfast', minutes: 5, activeMinutes: 3,
    equipment: ['microwave'], skill: 'beginner', style: 'quick', tags: ['eat-in-10'], storage: NO_STORE,
    ingredients: [['oats', 50], ['milk', 150], ['banana', 0.5], ['peanut_butter', 16]],
    steps: ['Combine oats and milk in a deep microwave-safe bowl.', 'Microwave 2 minutes, stir, then 1 more minute.', 'Top with sliced banana and peanut butter.'] },
  { id: 'veggie-scramble', name: 'Spinach & pepper egg scramble with toast', slot: 'breakfast', minutes: 12, activeMinutes: 12,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: [], storage: NO_STORE,
    ingredients: [['eggs', 3], ['spinach', 40], ['bell_pepper', 0.5], ['whole_wheat_bread', 1], ['olive_oil', 5]],
    steps: ['Heat the oil in a pan and soften the diced pepper for 3 minutes.', 'Add spinach until it wilts.', 'Pour in the beaten eggs and stir gently until just set.', 'Serve with toast.'] },
  { id: 'avocado-toast-egg', name: 'Avocado toast with eggs', slot: 'breakfast', minutes: 10, activeMinutes: 10,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['eat-in-10'], storage: NO_STORE,
    ingredients: [['whole_wheat_bread', 2], ['avocado', 0.5], ['eggs', 2], ['tomato', 0.5]],
    steps: ['Toast the bread.', 'Fry or scramble the eggs.', 'Mash avocado onto the toast, top with eggs and sliced tomato.'] },
  { id: 'tofu-scramble', name: 'Turmeric tofu scramble', slot: 'breakfast', minutes: 12, activeMinutes: 12,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['meal-prep'], reheatMinutes: 2, storage: LEFTOVERS,
    ingredients: [['tofu', 200], ['spinach', 40], ['tomato', 0.5], ['onion', 0.25], ['olive_oil', 5]],
    steps: ['Crumble the tofu with your hands.', 'Soften the onion in oil, add tofu, a pinch of turmeric, salt and pepper.', 'Cook 5 minutes, add tomato and spinach, cook until wilted.'] },
  { id: 'yogurt-parfait', name: 'Greek yogurt parfait', slot: 'breakfast', minutes: 3, activeMinutes: 3,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: COLD_PREP,
    ingredients: [['greek_yogurt', 200], ['blueberries', 75], ['almonds', 15], ['banana', 0.5]],
    steps: ['Layer yogurt, blueberries and sliced banana in a cup.', 'Top with almonds.'] },
  { id: 'yogurt-granola-cup', name: 'Yogurt & granola cup', slot: 'breakfast', minutes: 3, activeMinutes: 3,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: S(1, false, 'Pack granola separately so it stays crunchy; keep the yogurt cold.'),
    ingredients: [['greek_yogurt', 170], ['granola', 40], ['blueberries', 50]],
    steps: ['Spoon yogurt into a lidded cup.', 'Add blueberries; carry the granola in a bag and add when eating.'] },
  { id: 'pb-banana-toast', name: 'Peanut butter banana toast', slot: 'breakfast', minutes: 5, activeMinutes: 5,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: NO_STORE,
    ingredients: [['whole_wheat_bread', 2], ['peanut_butter', 24], ['banana', 1]],
    steps: ['Toast the bread if you can; it is fine untoasted.', 'Spread peanut butter and top with sliced banana.'] },
  { id: 'protein-bar-fruit', name: 'Protein bar & apple', slot: 'breakfast', minutes: 1, activeMinutes: 1,
    equipment: [], skill: 'beginner', style: 'bought', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: SHELF,
    ingredients: [['protein_bar', 1], ['apple', 1]],
    steps: ['Grab a bar and an apple on the way out.'] },
  { id: 'egg-muffins', name: 'Veggie egg muffins', slot: 'breakfast', minutes: 30, activeMinutes: 10, reheatMinutes: 2,
    equipment: ['oven'], skill: 'beginner', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: S(4, true, 'Refrigerate up to 4 days or freeze up to 2 months; reheat 30–60 seconds in the microwave or eat cold.'),
    ingredients: [['eggs', 3], ['spinach', 30], ['bell_pepper', 0.5], ['cheddar', 20]],
    steps: ['Heat the oven to 180 °C / 350 °F and grease a muffin tin.', 'Whisk eggs with chopped spinach, pepper and cheese.', 'Fill the cups and bake 18–20 minutes until set.'] },

  // ---------- lunch ----------
  { id: 'chicken-quinoa-bowl', name: 'Lemon chicken quinoa bowl', slot: 'lunch', minutes: 25, activeMinutes: 15, reheatMinutes: 2,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['portable', 'no-reheat', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['chicken_breast', 150], ['quinoa', 60], ['cucumber', 0.5], ['tomato', 0.5], ['lemon', 0.5], ['olive_oil', 10]],
    steps: ['Simmer quinoa in twice its volume of water for 15 minutes.', 'Season the chicken, pan-fry 5–6 minutes per side, rest and slice.', 'Toss everything with lemon juice, oil, cucumber and tomato. Good cold.'] },
  { id: 'chickpea-salad', name: 'Mediterranean chickpea salad', slot: 'lunch', minutes: 10, activeMinutes: 10, reheatMinutes: 0,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10', 'meal-prep'], storage: S(3, false, 'Keeps 3 days refrigerated; add feta on the day if packing ahead.'),
    ingredients: [['chickpeas', 0.5], ['cucumber', 0.5], ['tomato', 1], ['feta', 30], ['lemon', 0.5], ['olive_oil', 10]],
    steps: ['Rinse and drain the chickpeas.', 'Dice cucumber and tomato.', 'Toss with lemon juice, oil, crumbled feta, salt and pepper.'] },
  { id: 'tuna-wrap', name: 'Tuna & greens wrap', slot: 'lunch', minutes: 8, activeMinutes: 8,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: S(1, false, 'Assemble the morning you eat it; keep cold.'),
    ingredients: [['tuna_can', 1], ['ww_tortilla', 1], ['mixed_greens', 40], ['avocado', 0.25], ['lemon', 0.25]],
    steps: ['Drain the tuna and mash with avocado and lemon juice.', 'Spread on the tortilla, add greens, roll tightly.'] },
  { id: 'turkey-chili', name: 'Turkey & black bean chili', slot: 'lunch', minutes: 35, activeMinutes: 15, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['ground_turkey', 125], ['black_beans', 0.5], ['tomato', 1], ['onion', 0.5], ['bell_pepper', 0.5], ['garlic', 1], ['olive_oil', 5]],
    steps: ['Brown the turkey with onion, pepper and garlic.', 'Add chopped tomato, beans, chili powder and cumin.', 'Simmer 20 minutes. Freezes well.'] },
  { id: 'lentil-soup', name: 'Red lentil & carrot soup', slot: 'lunch', minutes: 30, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['lentils', 80], ['carrot', 100], ['onion', 0.5], ['garlic', 1], ['olive_oil', 5], ['spinach', 30]],
    steps: ['Soften onion, garlic and diced carrot in oil.', 'Add lentils and 3 cups of water; simmer 20 minutes.', 'Stir in spinach, season, blend if you like.'] },
  { id: 'tempeh-grain-bowl', name: 'Tempeh brown rice bowl', slot: 'lunch', minutes: 25, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['tempeh', 110], ['brown_rice', 60], ['broccoli', 100], ['carrot', 50], ['soy_sauce', 10]],
    steps: ['Cook the rice.', 'Pan-fry sliced tempeh with soy sauce until golden; steam the broccoli and carrot.', 'Assemble in a bowl or a container for later.'] },
  { id: 'seitan-bean-bowl', name: 'Seitan, black bean & quinoa bowl', slot: 'lunch', minutes: 20, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['seitan', 100], ['black_beans', 0.5], ['quinoa', 50], ['bell_pepper', 0.5], ['salsa', 40], ['olive_oil', 5]],
    steps: ['Cook the quinoa.', 'Sear sliced seitan and pepper in oil for 5 minutes.', 'Top the quinoa with seitan, beans and salsa.'] },
  { id: 'hummus-veggie-pita', name: 'Hummus & veggie pita', slot: 'lunch', minutes: 5, activeMinutes: 5,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: S(1, false, 'Pack the veg separately and fill the pita when eating so it does not go soggy.'),
    ingredients: [['pita', 1], ['hummus', 60], ['cucumber', 0.5], ['tomato', 0.5], ['mixed_greens', 30]],
    steps: ['Halve the pita and spread hummus inside.', 'Stuff with sliced cucumber, tomato and greens.'] },
  { id: 'turkey-cheese-sandwich', name: 'Turkey & cheddar sandwich', slot: 'lunch', minutes: 5, activeMinutes: 5,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: S(1, false, 'Keep chilled until lunch; eat the day it is made.'),
    ingredients: [['whole_wheat_bread', 2], ['deli_turkey', 60], ['cheddar', 20], ['tomato', 0.5], ['mixed_greens', 20]],
    steps: ['Layer turkey, cheese, tomato and greens between the bread.', 'Wrap tightly if taking it with you.'] },
  { id: 'ready-chicken-wrap', name: 'Store-bought chicken caesar wrap', slot: 'lunch', minutes: 1, activeMinutes: 1,
    equipment: [], skill: 'beginner', style: 'bought', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: S(2, false, 'Keep refrigerated; check the use-by date on the pack.'),
    ingredients: [['ready_wrap', 1]],
    steps: ['Pick one up from the chilled section. Nutrition and price are estimates for a typical wrap.'] },
  { id: 'bean-rice-burrito', name: 'Black bean & rice burritos', slot: 'lunch', minutes: 25, activeMinutes: 10, reheatMinutes: 2,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: S(4, true, 'Wrap each burrito in foil; refrigerate up to 4 days or freeze up to 3 months. Reheat 1–2 minutes in the microwave.'),
    ingredients: [['ww_tortilla', 1], ['black_beans', 0.5], ['brown_rice', 40], ['salsa', 40], ['cheddar', 20]],
    steps: ['Cook the rice.', 'Warm the beans with salsa.', 'Fill the tortillas with rice, beans and cheese; roll and wrap.'] },
  { id: 'microwave-sweet-potato', name: 'Microwave sweet potato with black beans', slot: 'lunch', minutes: 10, activeMinutes: 4,
    equipment: ['microwave'], skill: 'beginner', style: 'quick', tags: ['eat-in-10'], storage: LEFTOVERS,
    ingredients: [['sweet_potato', 250], ['black_beans', 0.5], ['salsa', 40]],
    steps: ['Prick the sweet potato and microwave 7–8 minutes until soft.', 'Warm the beans 1 minute.', 'Split the potato, top with beans and salsa.'] },
  { id: 'ramen-egg-veg', name: 'Upgraded ramen with egg & veg', slot: 'lunch', minutes: 10, activeMinutes: 8,
    equipment: ['stove'], skill: 'beginner', style: 'quick', tags: ['eat-in-10'], storage: NO_STORE,
    ingredients: [['ramen', 1], ['eggs', 1], ['frozen_veg', 80], ['spinach', 20]],
    steps: ['Boil the noodles with the frozen veg for 3 minutes (use half the seasoning).', 'Crack in the egg and stir until it sets.', 'Add spinach off the heat.'] },

  // ---------- dinner ----------
  { id: 'salmon-sweet-potato', name: 'Roast salmon, sweet potato & broccoli', slot: 'dinner', minutes: 30, activeMinutes: 10,
    equipment: ['oven'], skill: 'confident', style: 'homemade', tags: [], storage: S(2, false, 'Cooked fish keeps 2 days refrigerated.'),
    ingredients: [['salmon', 150], ['sweet_potato', 200], ['broccoli', 120], ['olive_oil', 5], ['lemon', 0.25]],
    steps: ['Heat the oven to 200 °C / 400 °F. Roast cubed sweet potato with oil for 15 minutes.', 'Add salmon and broccoli; roast 12 more minutes.', 'Finish with lemon.'] },
  { id: 'chicken-stir-fry', name: 'Chicken & veggie stir-fry with rice', slot: 'dinner', minutes: 25, activeMinutes: 15, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['meal-prep'], storage: LEFTOVERS,
    ingredients: [['chicken_breast', 150], ['brown_rice', 60], ['broccoli', 100], ['bell_pepper', 0.5], ['soy_sauce', 15], ['garlic', 1], ['olive_oil', 10]],
    steps: ['Cook the rice.', 'Stir-fry sliced chicken over high heat for 5 minutes; set aside.', 'Stir-fry broccoli, pepper and garlic 4 minutes; return chicken, add soy sauce.'] },
  { id: 'shrimp-tacos', name: 'Garlic shrimp tacos', slot: 'dinner', minutes: 20, activeMinutes: 15,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: [], storage: NO_STORE,
    ingredients: [['shrimp', 150], ['corn_tortilla', 3], ['avocado', 0.5], ['salsa', 50], ['garlic', 1], ['lemon', 0.25]],
    steps: ['Sauté shrimp with garlic 3–4 minutes until pink.', 'Warm the tortillas.', 'Fill with shrimp, sliced avocado and salsa; squeeze lemon over.'] },
  { id: 'chickpea-curry', name: 'Chickpea & spinach coconut curry', slot: 'dinner', minutes: 30, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['meal-prep'], storage: LEFTOVERS,
    ingredients: [['chickpeas', 0.5], ['coconut_milk', 100], ['curry_paste', 15], ['spinach', 60], ['onion', 0.5], ['brown_rice', 50]],
    steps: ['Cook the rice.', 'Fry the onion, add curry paste for 1 minute, then coconut milk and chickpeas.', 'Simmer 10 minutes, stir in spinach.'] },
  { id: 'turkey-pasta', name: 'Turkey bolognese with whole wheat pasta', slot: 'dinner', minutes: 30, activeMinutes: 15, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['meal-prep'], storage: LEFTOVERS,
    ingredients: [['ground_turkey', 125], ['ww_pasta', 85], ['tomato', 1.5], ['onion', 0.5], ['garlic', 2], ['olive_oil', 5]],
    steps: ['Brown turkey with onion and garlic in oil.', 'Add chopped tomatoes and simmer 15 minutes.', 'Boil the pasta and toss together.'] },
  { id: 'tofu-broccoli', name: 'Crispy tofu & broccoli with quinoa', slot: 'dinner', minutes: 30, activeMinutes: 15, reheatMinutes: 3,
    equipment: ['oven', 'stove'], skill: 'confident', style: 'homemade', tags: ['meal-prep'], storage: LEFTOVERS,
    ingredients: [['tofu', 200], ['broccoli', 150], ['quinoa', 50], ['soy_sauce', 10], ['garlic', 1], ['olive_oil', 10]],
    steps: ['Press and cube the tofu; toss with oil and soy sauce.', 'Roast tofu and broccoli at 220 °C / 425 °F for 20 minutes.', 'Serve over cooked quinoa.'] },
  { id: 'veggie-burrito-bowl', name: 'Black bean burrito bowl', slot: 'dinner', minutes: 20, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['black_beans', 0.75], ['brown_rice', 60], ['bell_pepper', 0.5], ['salsa', 60], ['cheddar', 25], ['avocado', 0.25]],
    steps: ['Cook the rice.', 'Warm the beans; sauté the pepper.', 'Build the bowl with salsa, cheese and avocado.'] },
  { id: 'lentil-bolognese', name: 'Lentil bolognese with quinoa', slot: 'dinner', minutes: 35, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['stove'], skill: 'comfortable', style: 'homemade', tags: ['meal-prep'], storage: LEFTOVERS,
    ingredients: [['lentils', 75], ['quinoa', 50], ['tomato', 1.5], ['carrot', 60], ['onion', 0.5], ['garlic', 2], ['olive_oil', 5]],
    steps: ['Soften onion, carrot and garlic in oil.', 'Add lentils, chopped tomato and 2 cups of water; simmer 25 minutes.', 'Serve over quinoa.'] },
  { id: 'veggie-fried-rice', name: 'Egg fried rice with vegetables', slot: 'dinner', minutes: 20, activeMinutes: 12, reheatMinutes: 3,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['meal-prep'], storage: S(3, true, 'Cool rice quickly and refrigerate within 1 hour; eat within 3 days. Reheat until steaming hot.'),
    ingredients: [['brown_rice', 60], ['eggs', 2], ['frozen_veg', 100], ['soy_sauce', 15], ['olive_oil', 5], ['garlic', 1]],
    steps: ['Cook the rice (day-old rice works best).', 'Scramble the eggs in oil, add garlic and frozen veg for 3 minutes.', 'Add rice and soy sauce; fry 3 more minutes.'] },
  { id: 'sheet-pan-chicken', name: 'Sheet-pan chicken, sweet potato & broccoli', slot: 'dinner', minutes: 35, activeMinutes: 10, reheatMinutes: 3,
    equipment: ['oven'], skill: 'comfortable', style: 'homemade', tags: ['portable', 'needs-fridge', 'meal-prep'], storage: LEFTOVERS,
    ingredients: [['chicken_breast', 150], ['sweet_potato', 150], ['broccoli', 100], ['olive_oil', 10]],
    steps: ['Heat the oven to 200 °C / 400 °F.', 'Toss everything with oil, salt and paprika on a tray.', 'Roast 25–30 minutes, turning once.'] },
  { id: 'loaded-microwave-potato', name: 'Loaded microwave baked potato', slot: 'dinner', minutes: 12, activeMinutes: 4,
    equipment: ['microwave'], skill: 'beginner', style: 'quick', tags: [], storage: NO_STORE,
    ingredients: [['potato', 300], ['cottage_cheese', 100], ['broccoli', 80], ['cheddar', 20]],
    steps: ['Prick the potato and microwave 8–9 minutes until soft.', 'Microwave the broccoli with a splash of water for 2 minutes.', 'Split the potato, top with cottage cheese, broccoli and cheddar.'] },
  { id: 'airfryer-tofu-bowl', name: 'Air fryer tofu & broccoli rice bowl', slot: 'dinner', minutes: 20, activeMinutes: 8,
    equipment: ['airfryer', 'microwave'], skill: 'beginner', style: 'homemade', tags: ['meal-prep'], reheatMinutes: 3, storage: LEFTOVERS,
    ingredients: [['tofu', 200], ['broccoli', 120], ['microwave_rice', 0.5], ['soy_sauce', 10], ['olive_oil', 5]],
    steps: ['Cube tofu, toss with oil and soy sauce; air fry at 200 °C / 400 °F for 12 minutes, shaking once.', 'Add broccoli for the last 5 minutes.', 'Heat the rice pouch and serve.'] },
  { id: 'tuna-pasta', name: 'Tuna & tomato pasta', slot: 'dinner', minutes: 20, activeMinutes: 10, reheatMinutes: 2,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['meal-prep'], storage: LEFTOVERS,
    ingredients: [['ww_pasta', 85], ['tuna_can', 1], ['tomato', 1], ['olive_oil', 10], ['garlic', 1], ['spinach', 40]],
    steps: ['Boil the pasta.', 'Warm garlic in oil, add chopped tomato for 5 minutes, then drained tuna.', 'Toss with pasta and spinach.'] },
  { id: 'peanut-noodles', name: 'Peanut noodles with edamame', slot: 'dinner', minutes: 15, activeMinutes: 10, reheatMinutes: 0,
    equipment: ['stove'], skill: 'beginner', style: 'homemade', tags: ['portable', 'no-reheat', 'needs-fridge', 'meal-prep'], storage: S(3, false, 'Good cold; keep refrigerated and eat within 3 days.'),
    ingredients: [['ww_pasta', 85], ['peanut_butter', 24], ['soy_sauce', 15], ['edamame', 80], ['carrot', 50]],
    steps: ['Boil the pasta, adding the edamame for the last 3 minutes.', 'Whisk peanut butter, soy sauce and 3 tablespoons of hot pasta water.', 'Toss with grated carrot.'] },
  { id: 'chickpea-avocado-wrap', name: 'Smashed chickpea & avocado wraps', slot: 'dinner', minutes: 5, activeMinutes: 5,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: NO_STORE,
    ingredients: [['ww_tortilla', 2], ['chickpeas', 0.5], ['avocado', 0.5], ['salsa', 40], ['mixed_greens', 30]],
    steps: ['Mash chickpeas and avocado with a fork; season.', 'Spread on the tortillas, add salsa and greens, roll up.'] },
  { id: 'ready-chicken-salad', name: 'Store-bought chicken salad kit', slot: 'dinner', minutes: 1, activeMinutes: 1,
    equipment: [], skill: 'beginner', style: 'bought', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: S(2, false, 'Keep refrigerated; check the use-by date on the pack.'),
    ingredients: [['ready_salad', 1]],
    steps: ['Pick one up from the chilled section. Nutrition and price are estimates for a typical kit.'] },
  { id: 'bean-quesadilla', name: 'Black bean quesadilla', slot: 'dinner', minutes: 10, activeMinutes: 10,
    equipment: ['stove'], skill: 'beginner', style: 'quick', tags: ['eat-in-10'], storage: NO_STORE,
    ingredients: [['ww_tortilla', 2], ['black_beans', 0.5], ['cheddar', 40], ['salsa', 40]],
    steps: ['Mash the beans with the salsa.', 'Spread on a tortilla, add cheese, top with the second tortilla.', 'Cook in a dry pan 3 minutes per side.'] },

  // ---------- snacks ----------
  { id: 'apple-pb', name: 'Apple with peanut butter', slot: 'snack', minutes: 2, activeMinutes: 2,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: NO_STORE,
    ingredients: [['apple', 1], ['peanut_butter', 32]], steps: ['Slice the apple and dip in peanut butter.'] },
  { id: 'hummus-veg', name: 'Hummus & veggie sticks', slot: 'snack', minutes: 5, activeMinutes: 5,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: COLD_PREP,
    ingredients: [['hummus', 70], ['carrot', 80], ['cucumber', 0.5]], steps: ['Cut carrot and cucumber into sticks.', 'Pack with hummus.'] },
  { id: 'cottage-berries', name: 'Cottage cheese & berries', slot: 'snack', minutes: 2, activeMinutes: 2,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'needs-fridge', 'eat-in-10'], storage: COLD_PREP,
    ingredients: [['cottage_cheese', 200], ['blueberries', 50]], steps: ['Top cottage cheese with berries.'] },
  { id: 'edamame-snack', name: 'Steamed edamame', slot: 'snack', minutes: 5, activeMinutes: 2,
    equipment: ['microwave'], skill: 'beginner', style: 'quick', tags: ['eat-in-10'], storage: COLD_PREP,
    ingredients: [['edamame', 150]], steps: ['Microwave with a splash of water for 3 minutes; salt lightly.'] },
  { id: 'almonds-banana', name: 'Banana & almonds', slot: 'snack', minutes: 1, activeMinutes: 1,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: SHELF,
    ingredients: [['banana', 1], ['almonds', 25]], steps: ['Eat together.'] },
  { id: 'pumpkin-seed-apple', name: 'Apple & pumpkin seeds', slot: 'snack', minutes: 1, activeMinutes: 1,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: SHELF,
    ingredients: [['apple', 1], ['pumpkin_seeds', 28]], steps: ['Eat together.'] },
  { id: 'rice-cakes-pb', name: 'Rice cakes with peanut butter', slot: 'snack', minutes: 2, activeMinutes: 2,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: SHELF,
    ingredients: [['rice_cakes', 2], ['peanut_butter', 16]], steps: ['Spread peanut butter on the rice cakes.'] },
  { id: 'protein-bar', name: 'Protein bar', slot: 'snack', minutes: 1, activeMinutes: 1,
    equipment: [], skill: 'beginner', style: 'bought', tags: ['portable', 'no-reheat', 'eat-in-10'], storage: SHELF,
    ingredients: [['protein_bar', 1]], steps: ['Keep one in your bag. Nutrition is an estimate for a typical bar; check the label.'] },
  { id: 'crackers-cheese', name: 'Crackers & cheddar', slot: 'snack', minutes: 2, activeMinutes: 2,
    equipment: [], skill: 'beginner', style: 'quick', tags: ['portable', 'needs-fridge', 'eat-in-10'], storage: S(1, false, 'Keep the cheese chilled until you eat.'),
    ingredients: [['crackers', 30], ['cheddar', 30]], steps: ['Slice the cheese and pack with crackers.'] },
];

const round1 = (n) => Math.round(n * 10) / 10;
export const unitPrice = (ing) => ing.price / ing.pack;

// Nutrition and cost for a list of [id, quantity] pairs in canonical units.
export function nutritionFor(pairs) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 };
  for (const [id, qty] of pairs) {
    const ing = INGREDIENTS[id];
    t.kcal += ing.per.kcal * qty;
    t.protein += ing.per.protein * qty;
    t.carbs += ing.per.carbs * qty;
    t.fat += ing.per.fat * qty;
    t.cost += unitPrice(ing) * qty;
  }
  return { kcal: Math.round(t.kcal), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat), cost: Math.round(t.cost * 100) / 100 };
}

// Derived: `diet` is the most permissive diet any ingredient requires (e.g. one egg
// makes the recipe vegetarian), `allergens` is the union across ingredients, and the
// per-serving macros/cost come from the ingredient quantities.
export const RECIPES = RECIPE_DEFS.map((r) => {
  const ings = r.ingredients.map(([id]) => {
    if (!INGREDIENTS[id]) throw new Error(`recipe ${r.id}: unknown ingredient ${id}`);
    return INGREDIENTS[id];
  });
  const diet = ings.reduce((d, i) => (DIET_RANK[i.diet ?? 'vegan'] > DIET_RANK[d] ? i.diet : d), 'vegan');
  const allergens = [...new Set(ings.flatMap((i) => i.allergens))].sort();
  return { reheatMinutes: null, ...r, ...nutritionFor(r.ingredients), diet, allergens };
});

export const RECIPES_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// Own-property lookups so untrusted ids like "__proto__" or "constructor" never resolve.
export const getRecipe = (id) => (Object.hasOwn(RECIPES_BY_ID, id) ? RECIPES_BY_ID[id] : undefined);
export const getIngredient = (id) => (Object.hasOwn(INGREDIENTS, id) ? INGREDIENTS[id] : undefined);

// The single source of truth for "may this person eat this recipe?". Used by the
// planner, the swap/alternatives engine and the validator that checks Claude's output.
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
