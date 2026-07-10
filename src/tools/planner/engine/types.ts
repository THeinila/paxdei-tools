/** Shared data-model types for the normalized dataset and the recipe engine. */

/** A game item: anything craftable, gatherable, or used as an ingredient. */
export interface Item {
  id: string;
  name: string;
  iconPath: string | null;
  /** Top-level category, e.g. "materials", "consumables", "tools". */
  mainCategoryId: string | null;
  /** Full category paths, e.g. "materials/craftingcomponents/tailoring". */
  categories: string[];
  /** Item tier (1..n) where present. */
  tier: number | null;
  /** Item rarity from upstream quality; null when common/poor/absent. */
  rarity: "uncommon" | "rare" | null;
  maxStackSize: number | null;
  /** True when no kept recipe outputs this item — i.e. it must be gathered. */
  isRaw: boolean;
}

export interface Ingredient {
  itemId: string;
  count: number;
}

/**
 * One way to craft an output item. An item may have several variants when there
 * are genuinely different input paths (e.g. charcoal from sapwood vs heartwood).
 */
export interface RecipeVariant {
  /** Source recipe id, e.g. "recipe_item_material_linen_cloth". */
  recipeId: string;
  /** Units produced per craft. */
  yield: number;
  ingredients: Ingredient[];
  /** Crafting profession/skill name, e.g. "Tailoring". */
  profession: string | null;
  professionId: string | null;
}

/** All kept recipe variants for a single output item, keyed by output item id. */
export interface ItemRecipes {
  outputItemId: string;
  variants: RecipeVariant[];
}

export interface Dataset {
  /** All items, keyed by id. */
  items: Record<string, Item>;
  /** Recipes keyed by output item id. Items absent here are raw (gathered). */
  recipes: Record<string, ItemRecipes>;
  meta: {
    generatedAt: string;
    source: string;
    recipeCount: number;
    itemCount: number;
  };
}
