import { supabase } from "./supabase";

// Data access for the per-user recipes + weekly menu. Every call is scoped to the
// signed-in user by Row-Level Security, so we pass user_id on writes but never need
// to filter reads by it (the policy does). Mappers convert between DB rows
// (snake_case columns) and the shapes the app already uses.

/* ------------------------------- recipes -------------------------------- */

// DB row -> app recipe (minus the React `Component`, which the caller attaches).
export function recipeRowToApp(row) {
  return {
    id: row.id,
    title: row.title,
    blurb: row.blurb,
    kicker: row.kicker,
    tags: row.tags || [],
    time: row.time,
    servings: row.servings,
    protein: row.protein || [],
    diet: row.diet,
    macros: row.macros,
    ingredients: row.ingredients || [],
    steps: row.steps || [],
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    theme: row.theme,
    dateAdded: (row.created_at || "").slice(0, 10),
  };
}

export async function fetchRecipes(userId) {
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(recipeRowToApp);
}

// Inserts a generated recipe and returns it in app shape (with the real UUID id).
export async function insertRecipe(userId, recipe) {
  const row = {
    user_id: userId,
    title: recipe.title,
    blurb: recipe.blurb,
    kicker: recipe.kicker,
    tags: recipe.tags,
    time: recipe.time,
    servings: recipe.servings,
    protein: recipe.protein,
    diet: recipe.diet,
    macros: recipe.macros,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    source_url: recipe.sourceUrl,
    source_name: recipe.sourceName,
    theme: recipe.theme,
  };
  const { data, error } = await supabase.from("recipes").insert(row).select().single();
  if (error) throw error;
  return recipeRowToApp(data);
}

/* ----------------------------- menu entries ----------------------------- */

// DB row -> menu item. `entryId` is the row id, used for precise delete/update.
export function menuRowToItem(row) {
  if (row.kind === "library") {
    return { entryId: row.id, kind: "library", id: row.recipe_ref, label: row.label, meal: row.meal };
  }
  return {
    entryId: row.id,
    kind: "external",
    data: row.external_data,
    label: row.label,
    meal: row.meal,
    macros: row.macros || undefined,
  };
}

function itemToRow(userId, iso, item) {
  const base = { user_id: userId, day: iso, meal: item.meal || "dinner", kind: item.kind, label: item.label };
  if (item.kind === "library") return { ...base, recipe_ref: item.id };
  return { ...base, external_data: item.data, macros: item.macros || null };
}

// Returns the menu grouped by ISO day: { "YYYY-MM-DD": [item, ...] }.
export async function fetchMenu(userId) {
  const { data, error } = await supabase.from("menu_entries").select("*");
  if (error) throw error;
  const menu = {};
  (data || []).forEach((row) => {
    (menu[row.day] = menu[row.day] || []).push(menuRowToItem(row));
  });
  return menu;
}

// Batch-inserts entries [{ iso, item }] and returns the raw rows (with ids).
export async function insertMenuEntries(userId, entries) {
  if (!entries.length) return [];
  const rows = entries.map(({ iso, item }) => itemToRow(userId, iso, item));
  const { data, error } = await supabase.from("menu_entries").insert(rows).select();
  if (error) throw error;
  return data || [];
}

export async function deleteMenuEntries(entryIds) {
  if (!entryIds.length) return;
  const { error } = await supabase.from("menu_entries").delete().in("id", entryIds);
  if (error) throw error;
}

// Sets cached macros on external entries (after "Calculate macros").
export async function setEntriesMacros(entryIds, macros) {
  if (!entryIds.length) return;
  const { error } = await supabase.from("menu_entries").update({ macros }).in("id", entryIds);
  if (error) throw error;
}

// Rewrites external entries to point at a newly-saved library recipe.
export async function convertEntriesToLibrary(entryIds, recipeId, label) {
  if (!entryIds.length) return;
  const { error } = await supabase
    .from("menu_entries")
    .update({ kind: "library", recipe_ref: recipeId, label, external_data: null, macros: null })
    .in("id", entryIds);
  if (error) throw error;
}
