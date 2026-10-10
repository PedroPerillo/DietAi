import { DIET_RANK } from './catalog.mjs';

// Demo eating-out catalog. These are illustrative meals with typical nutrition and
// price ranges, NOT real venues or menus; every item carries demo: true and the UI
// labels them as demo data. A real integration would replace this with a menu feed.
const E = (id, name, diet, allergens, [kcal, protein, carbs, fat], price) => ({
  id, name, diet, allergens, kcal, protein, carbs, fat, price, demo: true, venue: 'Demo venue',
});

export const EAT_OUT_DEMO = [
  E('cafeteria-chicken-plate', 'Grilled chicken plate with rice & veg', 'omnivore', [], [650, 45, 60, 22], 9.5),
  E('chicken-burrito-bowl', 'Chicken burrito bowl', 'omnivore', ['dairy'], [700, 40, 80, 24], 11),
  E('veggie-burrito-bowl', 'Veggie burrito bowl (no cheese)', 'vegan', [], [620, 18, 95, 18], 9.5),
  E('cheese-pizza-2', 'Cheese pizza, 2 slices', 'vegetarian', ['gluten', 'dairy'], [560, 24, 68, 20], 6),
  E('salmon-sushi-set', 'Salmon sushi roll set (8 pieces)', 'pescatarian', ['fish', 'soy', 'gluten'], [450, 20, 60, 14], 12),
  E('chicken-salad', 'Grilled chicken salad with dressing', 'omnivore', ['egg', 'dairy'], [480, 38, 20, 26], 10),
  E('falafel-pita', 'Falafel pita with hummus', 'vegan', ['gluten', 'sesame'], [580, 18, 70, 24], 8),
  E('tuna-poke-bowl', 'Tuna poke bowl', 'pescatarian', ['fish', 'soy', 'sesame'], [600, 35, 70, 18], 14),
  E('burger-fries', 'Burger & fries', 'omnivore', ['gluten', 'dairy', 'egg'], [950, 35, 90, 48], 10),
  E('oatmeal-cup', 'Oatmeal cup with fruit (coffee shop)', 'vegan', ['gluten'], [300, 8, 55, 5], 4),
  E('tofu-noodle-soup', 'Tofu noodle soup', 'vegan', ['soy', 'gluten'], [520, 22, 70, 14], 9),
];

export const getEatOut = (id) => EAT_OUT_DEMO.find((e) => e.id === id);

export function eatOutAllowed(item, { diet, allergies = [] }) {
  if (DIET_RANK[item.diet] > DIET_RANK[diet]) return false;
  return !item.allergens.some((a) => allergies.includes(a));
}
