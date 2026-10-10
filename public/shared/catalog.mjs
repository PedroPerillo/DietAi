// FitBite catalog, shared by the server and the browser (one source of truth for
// nutrition, portions, prices and recipe details).
//
// Ingredients: one canonical unit each, so quantities from different recipes add up
// without conversion. Nutrition is per 100 g/ml for weight/volume units and per 1 unit
// for counted items (each, slice, can, clove): [kcal, protein g, carbs g, fat g].
// Values are rounded USDA FoodData Central-style estimates for planning, not labels.
// step: the practical rounding for a meal (whole eggs, half cans, 5 g of oats...).
// perishable: needs refrigeration. staple: long-lasting pantry item.
// Prices are illustrative US grocery estimates in USD per retail pack (not live prices).

export const DIET_RANK = { vegan: 0, vegetarian: 1, pescatarian: 2, omnivore: 3 };
export const ALLERGENS = ['gluten', 'dairy', 'egg', 'nuts', 'peanuts', 'soy', 'sesame', 'fish', 'shellfish'];
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const EQUIPMENT = ['stove', 'oven', 'microwave', 'airfryer'];

const PER_100 = new Set(['g', 'ml']);
const DEFAULT_STEP = { g: 5, ml: 5, each: 1, slice: 1, can: 0.5, clove: 1 };

function ing(name, unit, category, pack, price, instacartUnit, n, opts = {}) {
  return {
    name, unit, category, pack, price, instacartUnit, n,
    per: PER_100.has(unit) ? 100 : 1,
    step: opts.step ?? DEFAULT_STEP[unit],
    allergens: opts.allergens ?? [],
    diet: opts.diet ?? 'vegan',
    labelRisk: opts.labelRisk,
    perishable: Boolean(opts.perishable),
    staple: Boolean(opts.staple),
  };
}

export const INGREDIENTS = {
  oats: ing('Rolled oats', 'g', 'Pantry', 1000, 4.49, 'gram', [389, 16.9, 66.3, 6.9], { allergens: ['gluten'], staple: true }),
  granola: ing('Granola', 'g', 'Pantry', 340, 3.99, 'gram', [471, 10, 64, 20], { allergens: ['gluten'], labelRisk: ['vegan'], staple: true }),
  banana: ing('Bananas', 'each', 'Produce', 1, 0.29, 'each', [105, 1.3, 27, 0.4], { step: 0.5 }),
  blueberries: ing('Blueberries', 'g', 'Produce', 170, 3.99, 'gram', [57, 0.7, 14.5, 0.3], { perishable: true }),
  greek_yogurt: ing('Plain Greek yogurt (2%)', 'g', 'Dairy', 907, 5.99, 'gram', [73, 10, 3.9, 1.9], { allergens: ['dairy'], diet: 'vegetarian', perishable: true }),
  milk: ing('Milk (2%)', 'ml', 'Dairy', 1890, 3.79, 'milliliter', [50, 3.3, 4.8, 2], { allergens: ['dairy'], diet: 'vegetarian', perishable: true }),
  soy_milk: ing('Unsweetened soy milk', 'ml', 'Dairy', 1890, 3.99, 'milliliter', [33, 2.9, 1.7, 1.6], { allergens: ['soy'], perishable: true }),
  oat_milk: ing('Unsweetened oat milk', 'ml', 'Dairy', 1890, 4.29, 'milliliter', [45, 1, 6.5, 1.5], { allergens: ['gluten'], perishable: true }),
  eggs: ing('Large eggs', 'each', 'Dairy', 12, 3.99, 'each', [72, 6.3, 0.4, 4.8], { allergens: ['egg'], diet: 'vegetarian', perishable: true }),
  whole_wheat_bread: ing('Whole wheat bread', 'slice', 'Bakery', 20, 3.49, 'package', [80, 4, 14, 1.1], { allergens: ['gluten'], labelRisk: ['vegan'] }),
  avocado: ing('Avocados', 'each', 'Produce', 1, 1.25, 'each', [240, 3, 12.8, 22], { step: 0.5 }),
  spinach: ing('Baby spinach', 'g', 'Produce', 142, 3.49, 'gram', [23, 2.9, 3.6, 0.4], { perishable: true }),
  tomato: ing('Tomatoes', 'each', 'Produce', 1, 0.69, 'each', [22, 1.1, 4.8, 0.2], { step: 0.5 }),
  cucumber: ing('Cucumbers', 'each', 'Produce', 1, 0.79, 'each', [45, 2, 11, 0.3], { step: 0.5 }),
  bell_pepper: ing('Bell peppers', 'each', 'Produce', 1, 1.19, 'each', [37, 1.2, 7.2, 0.4], { step: 0.5 }),
  broccoli: ing('Broccoli', 'g', 'Produce', 340, 2.49, 'gram', [34, 2.8, 6.6, 0.4], { perishable: true }),
  sweet_potato: ing('Sweet potatoes', 'g', 'Produce', 1360, 3.99, 'gram', [86, 1.6, 20, 0.1]),
  onion: ing('Yellow onions', 'each', 'Produce', 1, 0.89, 'each', [44, 1.2, 10.3, 0.1], { step: 0.5 }),
  garlic: ing('Garlic', 'clove', 'Produce', 10, 0.79, 'head', [4, 0.2, 1, 0]),
  lemon: ing('Lemons', 'each', 'Produce', 1, 0.69, 'each', [17, 0.6, 5.4, 0.2], { step: 0.5 }),
  apple: ing('Apples', 'each', 'Produce', 1, 0.99, 'each', [95, 0.5, 25, 0.3]),
  carrot: ing('Carrots', 'g', 'Produce', 907, 1.79, 'gram', [41, 0.9, 9.6, 0.2]),
  mixed_greens: ing('Mixed salad greens', 'g', 'Produce', 142, 3.99, 'gram', [20, 1.5, 3.5, 0.2], { perishable: true }),
  frozen_veg: ing('Frozen mixed vegetables', 'g', 'Frozen', 454, 1.99, 'gram', [64, 2.9, 13, 0.5], { staple: true }),
  chicken_breast: ing('Chicken breast', 'g', 'Meat & Seafood', 680, 7.99, 'gram', [120, 22.5, 0, 2.6], { diet: 'omnivore', perishable: true }),
  ground_turkey: ing('Lean ground turkey (93%)', 'g', 'Meat & Seafood', 454, 5.99, 'gram', [150, 18.7, 0, 8.3], { diet: 'omnivore', perishable: true }),
  salmon: ing('Salmon fillet', 'g', 'Meat & Seafood', 454, 11.99, 'gram', [208, 20, 0, 13], { allergens: ['fish'], diet: 'pescatarian', perishable: true }),
  shrimp: ing('Shrimp (peeled)', 'g', 'Meat & Seafood', 454, 9.99, 'gram', [85, 20, 0.2, 0.5], { allergens: ['shellfish'], diet: 'pescatarian', perishable: true }),
  tuna_can: ing('Canned tuna in water', 'can', 'Pantry', 1, 1.49, 'can', [130, 29, 0, 1], { allergens: ['fish'], diet: 'pescatarian', step: 1, staple: true }),
  tofu: ing('Extra-firm tofu', 'g', 'Produce', 397, 2.49, 'gram', [144, 17.3, 2.8, 8.7], { allergens: ['soy'], perishable: true }),
  tempeh: ing('Tempeh', 'g', 'Produce', 227, 3.49, 'gram', [192, 20, 7.6, 10.8], { allergens: ['soy'], labelRisk: ['gluten'], perishable: true }),
  seitan: ing('Seitan', 'g', 'Produce', 227, 4.99, 'gram', [140, 25, 6, 2], { allergens: ['gluten'], perishable: true }),
  chickpeas: ing('Canned chickpeas', 'can', 'Pantry', 1, 1.19, 'can', [334, 17, 55, 6], { staple: true }),
  black_beans: ing('Canned black beans', 'can', 'Pantry', 1, 1.09, 'can', [330, 21, 60, 1], { staple: true }),
  corn_can: ing('Canned sweet corn', 'can', 'Pantry', 1, 0.99, 'can', [210, 6, 46, 3], { staple: true }),
  crushed_tomatoes: ing('Canned crushed tomatoes', 'g', 'Pantry', 794, 2.49, 'gram', [32, 1.6, 7, 0.3], { staple: true }),
  lentils: ing('Dry red lentils', 'g', 'Pantry', 454, 2.29, 'gram', [358, 24, 63, 2.2], { staple: true }),
  quinoa: ing('Quinoa', 'g', 'Pantry', 340, 4.49, 'gram', [368, 14, 64, 6], { staple: true }),
  brown_rice: ing('Brown rice', 'g', 'Pantry', 907, 2.99, 'gram', [367, 7.5, 76, 2.7], { staple: true }),
  ww_pasta: ing('Whole wheat pasta', 'g', 'Pantry', 454, 1.99, 'gram', [348, 14.6, 73, 1.4], { allergens: ['gluten'], staple: true }),
  ww_tortilla: ing('Whole wheat tortillas', 'each', 'Bakery', 8, 3.29, 'package', [130, 4, 22, 3], { allergens: ['gluten'], labelRisk: ['vegan'] }),
  corn_tortilla: ing('Corn tortillas', 'each', 'Bakery', 30, 2.99, 'package', [57, 1.5, 12, 0.7], { labelRisk: ['gluten', 'vegan'] }),
  olive_oil: ing('Extra virgin olive oil', 'ml', 'Pantry', 500, 8.99, 'milliliter', [820, 0, 0, 92], { staple: true }),
  soy_sauce: ing('Low-sodium soy sauce', 'ml', 'Pantry', 296, 2.99, 'milliliter', [53, 8, 5, 0.1], { allergens: ['soy', 'gluten'], staple: true }),
  peanut_butter: ing('Natural peanut butter', 'g', 'Pantry', 454, 3.99, 'gram', [588, 25, 20, 50], { allergens: ['peanuts'], staple: true }),
  almonds: ing('Raw almonds', 'g', 'Pantry', 340, 6.99, 'gram', [579, 21, 22, 50], { allergens: ['nuts'], staple: true }),
  chia_seeds: ing('Chia seeds', 'g', 'Pantry', 340, 5.49, 'gram', [486, 17, 42, 31], { staple: true }),
  hummus: ing('Hummus', 'g', 'Deli', 283, 3.99, 'gram', [166, 7.9, 14.3, 9.6], { allergens: ['sesame'], perishable: true }),
  feta: ing('Feta cheese', 'g', 'Dairy', 170, 4.49, 'gram', [264, 14, 4, 21], { allergens: ['dairy'], diet: 'vegetarian', perishable: true }),
  cheddar: ing('Cheddar cheese', 'g', 'Dairy', 227, 3.99, 'gram', [403, 23, 3.1, 33], { allergens: ['dairy'], diet: 'vegetarian', perishable: true }),
  cottage_cheese: ing('Low-fat cottage cheese', 'g', 'Dairy', 680, 4.29, 'gram', [72, 12.4, 2.7, 1], { allergens: ['dairy'], diet: 'vegetarian', perishable: true }),
  salsa: ing('Salsa', 'g', 'Pantry', 454, 3.29, 'gram', [36, 1.5, 7, 0.2], { staple: true }),
  coconut_milk: ing('Light coconut milk', 'ml', 'Pantry', 400, 2.49, 'milliliter', [74, 0.5, 2.5, 7], { staple: true }),
  curry_paste: ing('Vegan red curry paste', 'g', 'Pantry', 113, 3.49, 'gram', [100, 2, 15, 4], { labelRisk: ['gluten', 'vegan'], staple: true }),
  protein_powder_pea: ing('Pea protein powder', 'g', 'Pantry', 907, 24.99, 'gram', [400, 80, 7, 7], { labelRisk: ['gluten', 'vegan'], staple: true }),
  edamame: ing('Frozen shelled edamame', 'g', 'Frozen', 340, 2.99, 'gram', [121, 11.9, 8.9, 5.2], { allergens: ['soy'] }),
  pumpkin_seeds: ing('Pumpkin seeds', 'g', 'Pantry', 283, 4.99, 'gram', [559, 30, 11, 49], { staple: true }),
};

// Recipe fields:
//  slots: meals it fits. minutes: total hands-on + cooking time. skill: 1 easy, 2 basic cooking.
//  equipment: all required; "oven|airfryer" means either. [] = no appliance needed.
//  reheat: 'none' (eat cold/room temp), 'optional', 'required'.
//  portable: packs well to take away. batch: fridge days it keeps as leftovers (0 = eat fresh).
//  style: 'assembled' (store-bought parts, no cooking), 'quick', 'homemade'.
//  shelfStable: fine at room temperature for the day (everything else is treated as perishable).
//  ingredients: per serving, in each ingredient's unit.
const RECIPE_DEFS = [
  // ---------- breakfast ----------
  { id: 'overnight-oats', name: 'Blueberry overnight oats', slots: ['breakfast'], minutes: 5, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 3, style: 'quick',
    ingredients: [['oats', 60], ['greek_yogurt', 150], ['blueberries', 75], ['milk', 100], ['chia_seeds', 10]],
    steps: ['In a jar, stir oats, chia, milk and yogurt together.', 'Top with blueberries, cover and refrigerate overnight (at least 4 hours).', 'Eat cold, or stir in a splash of milk if it is too thick.'] },
  { id: 'vegan-protein-oats', name: 'Pea-protein oat bowl', slots: ['breakfast'], minutes: 5, skill: 1, equipment: ['microwave|stove'], reheat: 'required', portable: false, batch: 0, style: 'quick',
    ingredients: [['oats', 60], ['protein_powder_pea', 25], ['oat_milk', 200], ['banana', 1], ['chia_seeds', 10]],
    steps: ['Cook oats in oat milk for 2–3 minutes (microwave or small pot), stirring halfway.', 'Stir in the protein powder and chia until smooth.', 'Top with sliced banana.'] },
  { id: 'oatmeal-pb-banana', name: 'Peanut butter banana oatmeal', slots: ['breakfast'], minutes: 5, skill: 1, equipment: ['microwave|stove'], reheat: 'required', portable: false, batch: 0, style: 'quick',
    ingredients: [['oats', 80], ['banana', 1], ['peanut_butter', 20]],
    steps: ['Cook oats with water (about 2 parts water to 1 part oats) for 2–3 minutes in the microwave or a small pot.', 'Stir in peanut butter and top with sliced banana.'] },
  { id: 'egg-sandwich', name: 'Fried egg sandwich', slots: ['breakfast', 'lunch'], minutes: 8, skill: 1, equipment: ['stove'], reheat: 'none', portable: true, batch: 0, style: 'quick',
    ingredients: [['eggs', 2], ['whole_wheat_bread', 2], ['spinach', 20], ['olive_oil', 5]],
    steps: ['Fry the eggs in oil until the whites are set (cook yolks firm if you will pack it).', 'Toast the bread and fill with eggs and spinach.'] },
  { id: 'veggie-scramble', name: 'Spinach & pepper egg scramble with toast', slots: ['breakfast'], minutes: 12, skill: 2, equipment: ['stove'], reheat: 'required', portable: false, batch: 0, style: 'homemade',
    ingredients: [['eggs', 3], ['spinach', 40], ['bell_pepper', 0.5], ['whole_wheat_bread', 1], ['olive_oil', 5]],
    steps: ['Dice the pepper; soften it in oil over medium heat for 3 minutes.', 'Add spinach until wilted, then pour in beaten eggs.', 'Stir gently until just set; serve with toast.'] },
  { id: 'avocado-toast-egg', name: 'Avocado toast with eggs', slots: ['breakfast'], minutes: 10, skill: 1, equipment: ['stove'], reheat: 'required', portable: false, batch: 0, style: 'quick',
    ingredients: [['whole_wheat_bread', 2], ['avocado', 0.5], ['eggs', 2], ['tomato', 0.5]],
    steps: ['Toast the bread.', 'Fry or boil the eggs (about 6 minutes).', 'Mash avocado on the toast, top with tomato slices and the eggs.'] },
  { id: 'mug-omelette', name: 'Microwave mug omelette', slots: ['breakfast'], minutes: 5, skill: 1, equipment: ['microwave'], reheat: 'required', portable: false, batch: 0, style: 'quick',
    ingredients: [['eggs', 2], ['spinach', 20], ['cheddar', 15], ['bell_pepper', 0.5], ['whole_wheat_bread', 1]],
    steps: ['Whisk eggs in a large greased mug; add chopped spinach, pepper and cheese.', 'Microwave 60 seconds, stir, then 30–60 seconds more until fully set.', 'Eat with a slice of toast.'] },
  { id: 'tofu-scramble', name: 'Turmeric tofu scramble', slots: ['breakfast'], minutes: 12, skill: 2, equipment: ['stove'], reheat: 'optional', portable: false, batch: 2, style: 'homemade',
    ingredients: [['tofu', 200], ['spinach', 40], ['tomato', 0.5], ['onion', 0.5], ['olive_oil', 5], ['sweet_potato', 100]],
    steps: ['Microwave or pan-cook diced sweet potato until tender (about 6 minutes).', 'Soften diced onion in oil for 3 minutes, then crumble in the tofu with a pinch of turmeric, salt and pepper; cook 5 minutes.', 'Add spinach, tomato and the sweet potato until warm.'] },
  { id: 'chia-pudding', name: 'Coconut chia pudding with berries', slots: ['breakfast', 'snack'], minutes: 5, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 3, style: 'quick',
    ingredients: [['chia_seeds', 30], ['coconut_milk', 150], ['banana', 1], ['blueberries', 60], ['pumpkin_seeds', 15]],
    steps: ['Stir chia into the coconut milk in a jar; stir again after 5 minutes.', 'Refrigerate at least 2 hours or overnight.', 'Top with banana, berries and pumpkin seeds.'] },
  { id: 'yogurt-parfait', name: 'Greek yogurt parfait', slots: ['breakfast', 'snack'], minutes: 3, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['greek_yogurt', 200], ['blueberries', 75], ['almonds', 15], ['banana', 0.5]],
    steps: ['Layer yogurt, berries and sliced banana in a bowl or jar.', 'Top with chopped almonds.'] },
  { id: 'yogurt-granola-cup', name: 'Yogurt & granola cup', slots: ['breakfast', 'snack'], minutes: 2, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['greek_yogurt', 170], ['granola', 40], ['blueberries', 50]],
    steps: ['Spoon yogurt into a container, add berries.', 'Keep the granola separate until you eat so it stays crunchy.'] },
  { id: 'pb-banana-toast', shelfStable: true, name: 'Peanut butter banana toast', slots: ['breakfast', 'snack'], minutes: 3, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'quick',
    ingredients: [['whole_wheat_bread', 2], ['peanut_butter', 30], ['banana', 1]],
    steps: ['Toast the bread if you can (optional).', 'Spread peanut butter and top with sliced banana.', 'To take away, close it as a sandwich.'] },

  // ---------- lunch / dinner ----------
  { id: 'chicken-quinoa-bowl', name: 'Lemon chicken quinoa bowl', slots: ['lunch', 'dinner'], minutes: 25, skill: 2, equipment: ['stove'], reheat: 'optional', portable: true, batch: 4, style: 'homemade',
    ingredients: [['chicken_breast', 150], ['quinoa', 60], ['cucumber', 0.5], ['tomato', 0.5], ['lemon', 0.5], ['olive_oil', 10]],
    steps: ['Rinse quinoa and simmer in twice its volume of water for 15 minutes.', 'Season chicken and cook in half the oil, 5–6 minutes per side, until 165°F (74°C) inside.', 'Slice and serve over quinoa with chopped cucumber and tomato, lemon juice and the rest of the oil.'] },
  { id: 'chickpea-salad', name: 'Mediterranean chickpea salad', slots: ['lunch', 'dinner'], minutes: 10, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 3, style: 'quick',
    ingredients: [['chickpeas', 0.5], ['cucumber', 0.5], ['tomato', 1], ['feta', 30], ['lemon', 0.5], ['olive_oil', 10], ['whole_wheat_bread', 1]],
    steps: ['Drain and rinse the chickpeas.', 'Chop cucumber and tomato; toss with chickpeas, crumbled feta, lemon juice and oil.', 'Season with salt and pepper; eat with bread.'] },
  { id: 'tuna-wrap', name: 'Tuna & greens wrap', slots: ['lunch'], minutes: 8, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'quick',
    ingredients: [['tuna_can', 1], ['ww_tortilla', 1], ['mixed_greens', 40], ['avocado', 0.5], ['lemon', 0.5]],
    steps: ['Drain the tuna and mash with avocado and lemon juice.', 'Spread on the tortilla, add greens and roll tightly.'] },
  { id: 'tuna-bean-salad', name: 'Tuna & chickpea salad', slots: ['lunch', 'dinner'], minutes: 5, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 2, style: 'quick',
    ingredients: [['tuna_can', 1], ['chickpeas', 0.5], ['cucumber', 0.5], ['lemon', 0.5], ['olive_oil', 5]],
    steps: ['Drain tuna and chickpeas.', 'Mix with chopped cucumber, lemon juice and oil; season to taste.'] },
  { id: 'hummus-veggie-wrap', name: 'Hummus veggie wrap', slots: ['lunch'], minutes: 5, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['ww_tortilla', 2], ['hummus', 60], ['carrot', 60], ['cucumber', 0.5], ['spinach', 30]],
    steps: ['Spread hummus on the tortillas.', 'Add grated carrot, cucumber sticks and spinach; roll up.'] },
  { id: 'bean-corn-salad', name: 'Black bean & corn salad', slots: ['lunch', 'dinner'], minutes: 10, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 4, style: 'quick',
    ingredients: [['black_beans', 0.5], ['corn_can', 0.5], ['tomato', 1], ['bell_pepper', 0.5], ['lemon', 0.5], ['olive_oil', 5], ['corn_tortilla', 2]],
    steps: ['Drain and rinse beans and corn.', 'Mix with diced tomato and pepper, lemon juice and oil; season.', 'Eat with warm or room-temperature tortillas.'] },
  { id: 'rice-beans-salsa', name: 'Rice, beans & salsa bowl', slots: ['lunch', 'dinner'], minutes: 15, skill: 1, equipment: ['microwave|stove'], reheat: 'optional', portable: true, batch: 4, style: 'quick',
    ingredients: [['brown_rice', 75], ['black_beans', 0.5], ['salsa', 50], ['frozen_veg', 80]],
    steps: ['Cook the rice (or use leftover rice).', 'Warm the beans and frozen vegetables for 4 minutes.', 'Top the rice with beans, vegetables and salsa.'] },
  { id: 'turkey-chili', name: 'Turkey & black bean chili', slots: ['lunch', 'dinner'], minutes: 35, skill: 2, equipment: ['stove'], reheat: 'required', portable: true, batch: 4, style: 'homemade',
    ingredients: [['ground_turkey', 125], ['black_beans', 0.5], ['crushed_tomatoes', 150], ['onion', 0.5], ['bell_pepper', 0.5], ['garlic', 1], ['brown_rice', 40]],
    steps: ['Start the rice (about 30 minutes) while you cook.', 'Brown turkey with diced onion, pepper and garlic for 8 minutes.', 'Add beans, crushed tomatoes and chili spices; simmer 15 minutes.', 'Serve over rice.'] },
  { id: 'lentil-soup', name: 'Red lentil & carrot soup', slots: ['lunch', 'dinner'], minutes: 30, skill: 1, equipment: ['stove'], reheat: 'required', portable: true, batch: 4, style: 'homemade',
    ingredients: [['lentils', 80], ['carrot', 100], ['onion', 0.5], ['garlic', 1], ['olive_oil', 5], ['spinach', 30], ['whole_wheat_bread', 1]],
    steps: ['Soften diced onion, garlic and carrot in oil for 5 minutes.', 'Add rinsed lentils and 3 cups of water per 80 g; simmer 20 minutes.', 'Stir in spinach, season and blend if you like. Serve with bread.'] },
  { id: 'tempeh-grain-bowl', name: 'Tempeh brown rice bowl', slots: ['lunch', 'dinner'], minutes: 30, skill: 2, equipment: ['stove'], reheat: 'optional', portable: true, batch: 3, style: 'homemade',
    ingredients: [['tempeh', 110], ['brown_rice', 60], ['broccoli', 100], ['carrot', 50], ['soy_sauce', 10]],
    steps: ['Cook the rice (about 30 minutes).', 'Pan-fry sliced tempeh until golden, 4 minutes per side; add soy sauce.', 'Steam broccoli and grated carrot; serve everything over rice.'] },
  { id: 'seitan-bean-bowl', name: 'Seitan, black bean & quinoa bowl', slots: ['lunch', 'dinner'], minutes: 20, skill: 1, equipment: ['stove'], reheat: 'optional', portable: true, batch: 3, style: 'quick',
    ingredients: [['seitan', 100], ['black_beans', 0.5], ['quinoa', 50], ['bell_pepper', 0.5], ['salsa', 40], ['olive_oil', 5]],
    steps: ['Simmer quinoa in twice its volume of water for 15 minutes.', 'Sear sliced seitan and pepper in oil for 5 minutes; add the beans to warm.', 'Serve over quinoa with salsa.'] },
  { id: 'salmon-sweet-potato', name: 'Roast salmon, sweet potato & broccoli', slots: ['dinner'], minutes: 30, skill: 2, equipment: ['oven|airfryer'], reheat: 'optional', portable: false, batch: 2, style: 'homemade',
    ingredients: [['salmon', 150], ['sweet_potato', 200], ['broccoli', 120], ['olive_oil', 5], ['lemon', 0.5]],
    steps: ['Heat oven to 425°F (220°C) or air fryer to 400°F (200°C).', 'Roast cubed sweet potato with oil for 15 minutes.', 'Add salmon and broccoli; roast 10–12 minutes more until salmon flakes (145°F / 63°C). Finish with lemon.'] },
  { id: 'chicken-stir-fry', name: 'Chicken & veggie stir-fry with rice', slots: ['lunch', 'dinner'], minutes: 30, skill: 2, equipment: ['stove'], reheat: 'required', portable: true, batch: 3, style: 'homemade',
    ingredients: [['chicken_breast', 150], ['brown_rice', 60], ['broccoli', 100], ['bell_pepper', 0.5], ['soy_sauce', 15], ['garlic', 1], ['olive_oil', 5]],
    steps: ['Cook the rice.', 'Stir-fry sliced chicken in oil over high heat until cooked through (165°F / 74°C).', 'Add garlic, broccoli and pepper for 4 minutes, then soy sauce. Serve over rice.'] },
  { id: 'egg-fried-rice', name: 'Veggie egg fried rice', slots: ['lunch', 'dinner'], minutes: 15, skill: 1, equipment: ['stove'], reheat: 'required', portable: true, batch: 3, style: 'quick',
    ingredients: [['brown_rice', 70], ['eggs', 2], ['frozen_veg', 120], ['soy_sauce', 10], ['olive_oil', 5]],
    steps: ['Use cooked rice (leftover rice works best) or cook it first.', 'Scramble the eggs in oil, push aside and add frozen vegetables for 4 minutes.', 'Add rice and soy sauce; stir-fry until hot.'] },
  { id: 'shrimp-tacos', name: 'Garlic shrimp tacos', slots: ['dinner'], minutes: 20, skill: 2, equipment: ['stove'], reheat: 'required', portable: false, batch: 0, style: 'homemade',
    ingredients: [['shrimp', 150], ['corn_tortilla', 3], ['avocado', 0.5], ['salsa', 50], ['garlic', 1], ['lemon', 0.5], ['olive_oil', 5]],
    steps: ['Sauté shrimp with garlic in oil for 2–3 minutes per side until pink.', 'Warm the tortillas.', 'Fill with shrimp, sliced avocado and salsa; squeeze lemon over.'] },
  { id: 'chickpea-curry', name: 'Chickpea & spinach coconut curry', slots: ['lunch', 'dinner'], minutes: 30, skill: 2, equipment: ['stove'], reheat: 'required', portable: true, batch: 4, style: 'homemade',
    ingredients: [['chickpeas', 0.5], ['coconut_milk', 100], ['curry_paste', 15], ['spinach', 60], ['onion', 0.5], ['brown_rice', 60]],
    steps: ['Cook the rice.', 'Soften diced onion, then stir in curry paste for 1 minute.', 'Add chickpeas and coconut milk; simmer 10 minutes. Stir in spinach. Serve over rice.'] },
  { id: 'lentil-dal', name: 'Coconut red lentil dal', slots: ['lunch', 'dinner'], minutes: 30, skill: 1, equipment: ['stove'], reheat: 'required', portable: true, batch: 4, style: 'homemade',
    ingredients: [['lentils', 70], ['coconut_milk', 60], ['curry_paste', 10], ['onion', 0.5], ['garlic', 1], ['brown_rice', 50], ['spinach', 30]],
    steps: ['Cook the rice.', 'Soften onion and garlic, add curry paste, lentils and 2 cups of water; simmer 15 minutes.', 'Stir in coconut milk and spinach; season. Serve over rice.'] },
  { id: 'turkey-pasta', name: 'Turkey bolognese with whole wheat pasta', slots: ['lunch', 'dinner'], minutes: 30, skill: 2, equipment: ['stove'], reheat: 'required', portable: true, batch: 4, style: 'homemade',
    ingredients: [['ground_turkey', 125], ['ww_pasta', 85], ['crushed_tomatoes', 150], ['onion', 0.5], ['garlic', 2], ['olive_oil', 5]],
    steps: ['Boil pasta according to the package.', 'Brown turkey with onion and garlic in oil for 8 minutes.', 'Add crushed tomatoes and simmer 10 minutes; toss with pasta.'] },
  { id: 'pasta-chickpea-tomato', name: 'Pasta with chickpeas, tomato & spinach', slots: ['lunch', 'dinner'], minutes: 20, skill: 1, equipment: ['stove'], reheat: 'optional', portable: true, batch: 4, style: 'quick',
    ingredients: [['ww_pasta', 85], ['crushed_tomatoes', 150], ['chickpeas', 0.5], ['garlic', 1], ['spinach', 30], ['olive_oil', 5]],
    steps: ['Boil pasta according to the package.', 'Warm garlic in oil, add crushed tomatoes and chickpeas; simmer 8 minutes.', 'Stir in spinach and the drained pasta.'] },
  { id: 'tofu-broccoli', name: 'Crispy tofu & broccoli with quinoa', slots: ['lunch', 'dinner'], minutes: 30, skill: 2, equipment: ['oven|airfryer'], reheat: 'optional', portable: true, batch: 3, style: 'homemade',
    ingredients: [['tofu', 200], ['broccoli', 150], ['quinoa', 50], ['soy_sauce', 10], ['garlic', 1], ['olive_oil', 10]],
    steps: ['Simmer quinoa for 15 minutes.', 'Toss cubed tofu and broccoli with oil and soy sauce; roast at 425°F (220°C) or air-fry at 400°F (200°C) for 20 minutes.', 'Serve over quinoa.'] },
  { id: 'sheet-pan-chicken', name: 'Sheet-pan chicken & sweet potato', slots: ['lunch', 'dinner'], minutes: 35, skill: 1, equipment: ['oven|airfryer'], reheat: 'optional', portable: true, batch: 4, style: 'homemade',
    ingredients: [['chicken_breast', 150], ['sweet_potato', 200], ['broccoli', 100], ['olive_oil', 10]],
    steps: ['Heat oven to 425°F (220°C) or air fryer to 400°F (200°C).', 'Toss cubed sweet potato, chicken and broccoli with oil and seasoning.', 'Roast 25–30 minutes until chicken reaches 165°F (74°C).'] },
  { id: 'veggie-burrito-bowl', name: 'Black bean burrito bowl', slots: ['lunch', 'dinner'], minutes: 20, skill: 1, equipment: ['microwave|stove'], reheat: 'optional', portable: true, batch: 3, style: 'quick',
    ingredients: [['black_beans', 0.5], ['brown_rice', 60], ['bell_pepper', 0.5], ['salsa', 60], ['cheddar', 25], ['avocado', 0.5]],
    steps: ['Cook the rice (or use leftover rice).', 'Warm the beans and pepper for 3 minutes.', 'Build the bowl with rice, beans, salsa, cheese and avocado.'] },
  { id: 'lentil-bolognese', name: 'Lentil bolognese with quinoa', slots: ['lunch', 'dinner'], minutes: 35, skill: 1, equipment: ['stove'], reheat: 'required', portable: true, batch: 4, style: 'homemade',
    ingredients: [['lentils', 75], ['quinoa', 50], ['crushed_tomatoes', 150], ['carrot', 60], ['onion', 0.5], ['garlic', 2], ['olive_oil', 5]],
    steps: ['Simmer quinoa for 15 minutes.', 'Soften onion, garlic and grated carrot in oil.', 'Add lentils, crushed tomatoes and 1 cup water; simmer 20 minutes. Serve over quinoa.'] },

  // ---------- snacks ----------
  { id: 'apple-pb', shelfStable: true, name: 'Apple with peanut butter', slots: ['snack'], minutes: 2, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['apple', 1], ['peanut_butter', 30]], steps: ['Slice the apple and dip in peanut butter.'] },
  { id: 'hummus-veg', name: 'Hummus & veggie sticks', slots: ['snack'], minutes: 5, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['hummus', 70], ['carrot', 80], ['cucumber', 0.5]], steps: ['Cut carrot and cucumber into sticks.', 'Serve with hummus.'] },
  { id: 'cottage-berries', name: 'Cottage cheese & berries', slots: ['snack', 'breakfast'], minutes: 2, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['cottage_cheese', 200], ['blueberries', 50]], steps: ['Top cottage cheese with berries.'] },
  { id: 'edamame-snack', name: 'Steamed edamame', slots: ['snack'], minutes: 5, skill: 1, equipment: ['microwave|stove'], reheat: 'optional', portable: true, batch: 3, style: 'quick',
    ingredients: [['edamame', 150]], steps: ['Microwave or boil the edamame for 3–4 minutes.', 'Salt lightly; good warm or cold.'] },
  { id: 'almonds-banana', shelfStable: true, name: 'Banana & almonds', slots: ['snack'], minutes: 1, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['banana', 1], ['almonds', 25]], steps: ['Grab a banana and a small handful of almonds.'] },
  { id: 'pumpkin-seed-apple', shelfStable: true, name: 'Apple & pumpkin seeds', slots: ['snack'], minutes: 1, skill: 1, equipment: [], reheat: 'none', portable: true, batch: 0, style: 'assembled',
    ingredients: [['apple', 1], ['pumpkin_seeds', 25]], steps: ['Pair an apple with a small handful of pumpkin seeds.'] },
];

// Food-safety guidance, following USDA FSIS basics: refrigerate perishables within
// 2 hours (1 hour above 90°F/32°C); cooked leftovers keep 3–4 days in the fridge;
// reheat leftovers to 165°F (74°C).
export function storageTips(recipe) {
  const tips = [];
  if (recipe.perishable) tips.push('Keep refrigerated. If you pack it, use an insulated bag with an ice pack and eat it within 2 hours (1 hour above 90°F/32°C).');
  else tips.push('Keeps at room temperature for the day.');
  if (recipe.batch) tips.push(`Leftovers keep up to ${Math.min(recipe.batch, 4)} days in the fridge in a sealed container.`);
  if (recipe.reheat !== 'none' && recipe.batch) tips.push('Reheat leftovers until steaming hot (165°F / 74°C).');
  return tips;
}

const nutrientsOf = (id, qty) => {
  const i = INGREDIENTS[id];
  return i.n.map((v) => (v * qty) / i.per);
};

// Derived: diet = most permissive any ingredient requires; allergens = union; perishable
// if any ingredient needs refrigeration; per-serving nutrition and cost from ingredients.
export const RECIPES = RECIPE_DEFS.map((r) => {
  const ings = r.ingredients.map(([id]) => INGREDIENTS[id]);
  const diet = ings.reduce((d, i) => (DIET_RANK[i.diet] > DIET_RANK[d] ? i.diet : d), 'vegan');
  const allergens = [...new Set(ings.flatMap((i) => i.allergens))].sort();
  const totals = r.ingredients.reduce((acc, [id, q]) => nutrientsOf(id, q).map((v, k) => acc[k] + v), [0, 0, 0, 0]);
  const cost = r.ingredients.reduce((s, [id, q]) => s + (INGREDIENTS[id].price / INGREDIENTS[id].pack) * q, 0);
  return {
    ...r,
    slot: r.slots[0],
    diet,
    allergens,
    // Prepared food is perishable (2-hour rule) unless it's a shelf-stable snack.
    perishable: r.shelfStable ? false : true,
    kcal: Math.round(totals[0]), protein: +totals[1].toFixed(1), carbs: +totals[2].toFixed(1), fat: +totals[3].toFixed(1),
    cost: +cost.toFixed(2),
  };
});

export const RECIPES_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// Own-property lookups so untrusted ids like "__proto__" or "constructor" never resolve.
export const getRecipe = (id) => (Object.hasOwn(RECIPES_BY_ID, id) ? RECIPES_BY_ID[id] : undefined);
export const getIngredient = (id) => (Object.hasOwn(INGREDIENTS, id) ? INGREDIENTS[id] : undefined);

// The single source of truth for "may this person eat this recipe?". Used by planning,
// "my day changed" alternatives and every validation step.
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

export const allowedRecipes = (profile) => RECIPES.filter((r) => isRecipeAllowed(r, profile));
