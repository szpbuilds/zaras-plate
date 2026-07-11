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

// Moves an entry to a different day and/or meal slot (drag & drop in the Plan tab).
export async function updateMenuEntry(entryId, { day, meal }) {
  const patch = {};
  if (day !== undefined) patch.day = day;
  if (meal !== undefined) patch.meal = meal;
  if (!Object.keys(patch).length) return;
  const { error } = await supabase.from("menu_entries").update(patch).eq("id", entryId);
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

/* --------------------------------- logs --------------------------------- */

const ZERO_MACROS = { kcal: 0, protein: 0, fat: 0, carb: 0 };

// DB row -> app log entry. `macros` is per-serving; multiply by `servings` for totals.
export function logRowToApp(row) {
  return {
    id: row.id,
    day: row.day,
    meal: row.meal,
    source: row.source,
    recipeRef: row.recipe_ref,
    label: row.label,
    macros: row.macros || ZERO_MACROS,
    servings: Number(row.servings) || 1,
    menuEntryId: row.menu_entry_id,
    loggedAt: row.logged_at,
  };
}

// Fetches logs within an inclusive [fromISO, toISO] day range (e.g. the current week).
export async function fetchLogs(userId, fromISO, toISO) {
  const { data, error } = await supabase
    .from("logs")
    .select("*")
    .gte("day", fromISO)
    .lte("day", toISO)
    .order("logged_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(logRowToApp);
}

export async function insertLog(userId, log) {
  const row = {
    user_id: userId,
    day: log.day,
    meal: log.meal,
    source: log.source,
    recipe_ref: log.recipeRef ?? null,
    label: log.label,
    macros: log.macros || ZERO_MACROS,
    servings: log.servings ?? 1,
    menu_entry_id: log.menuEntryId ?? null,
  };
  const { data, error } = await supabase.from("logs").insert(row).select().single();
  if (error) throw error;
  return logRowToApp(data);
}

export async function updateLogServings(id, servings) {
  const { error } = await supabase.from("logs").update({ servings }).eq("id", id);
  if (error) throw error;
}

export async function deleteLog(id) {
  const { error } = await supabase.from("logs").delete().eq("id", id);
  if (error) throw error;
}
