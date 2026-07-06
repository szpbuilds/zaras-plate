# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Zara's Plate is a single-page React app — a recipe box, weekly meal planner, and macro tracker. It began life as a single-file artifact inside claude.ai and was exported to a standalone Vite project. That origin explains most of the architecture below (one giant file, inline CSS, direct `api.anthropic.com` calls).

## Commands

```bash
npm install
npm run dev       # Vite dev server, usually http://localhost:5173
npm run build     # production bundle
npm run preview   # serve the built output to sanity-check it
```

There is no test suite, linter, or type checker configured — `dev`, `build`, and `preview` are the only scripts.

## Architecture

**Almost everything lives in `src/App.jsx`** (~2440 lines). `main.jsx` just mounts `<Cookbook />` (the default export, at the bottom of the file). `index.html` is the Vite entry. There is no router, no CSS files, no state library.

Read the file top-to-bottom; it is organized in clearly commented banner sections in this order:

1. **`FONT_IMPORT`** — Google Fonts import string, injected into the inline `<style>`.
2. **Shared utilities** — `scaleAmount` (turns a base amount × factor into a whole/fraction/text struct for display), `loadPrefs`/`savePrefs` (localStorage wrappers — see below), `useLongPress` (tap vs. long-press hook).
3. **Shared primitives** — `Amount`, `IngredientRow`, `Section`, `OptionSwitch`, `QuantityStepper`, `ToggleSwitch`, `MacroBar`, `NutritionCard`, `StepsList`, `RecipePage`. Every recipe view is composed from these.
4. **Hand-built recipes** — `PitaRecipe` and `SandwichRecipe`. Each pairs a `*_THEME` object (colors + fonts, applied as CSS variables via `RecipePage`) with a data-driven component. These do live macro math from per-100g constants and user toggles (cut, style, weight, panko, etc.).
5. **Generated recipes** — `GeneratedRecipeComponent` renders recipes created at runtime via "Add to cookbook", using the same primitives. Helpers `detectChickenCut` / `swapChickenCutText` / `parseIngredientGrams` / `totalChickenGrams` let a generated recipe swap chicken breast↔thigh and recompute macros.
6. **`RECIPES`** — the static registry array. Each entry has `{ id, title, kicker, tags, blurb, time, theme, Component, protein, diet, dateAdded, macros }`. **Add new hand-built recipes here.** At runtime, `allRecipes = [...RECIPES, ...customRecipes]`.
7. **Index/shell components** — `RecipeCard`, `CarouselCard`, `WeekStrip`, `PlanView`, the modals (`AddToMenuModal`, `ConfirmModal`, `AddToCookbookModal`), `SwipeableMenuCard`, etc.
8. **`Cookbook`** — the root component. Holds essentially all app state (`activeTab`, `menu`, `customRecipes`, `dailyRecipes`, drafts, undo, filters…), all the handlers, the AI prompt builders, and the full JSX render.
9. **Inline `<style>{`...`}</style>`** — one ~430-line CSS block at the end of the render (starts ~line 1774). **All styling lives here**, driven by CSS variables the theme objects set. `rp-*` classes = recipe pages; `cb-*` classes = the cookbook shell/index. There is no separate stylesheet.

### The three tabs
The shell is a tabbed composer: **Eat** (browse recipes + "Today's Picks" carousel), **Plan** (weekly `WeekStrip` + day menus), **Log**. State lives in `Cookbook`; `activeTab` switches which panel renders.

### The weekly menu model
`menu` is `{ "YYYY-MM-DD": [item, ...] }`. An item is either `{ kind: "library", id, label }` (points into `allRecipes` by id) or `{ kind: "external", data, macros? }` (a "Today's Picks" web result not yet in the cookbook). `itemsMatch` dedupes them. When an external item is turned into a real recipe via "Add to cookbook", `approveCookbookDraft` rewrites its menu entries from `external` → `library`.

## AI integration — read before touching `callClaude`

The three "live" features — **Today's Picks**, **Calculate macros**, **Add to cookbook** — all route through `callClaude(prompt, useSearch, shape, maxTokens)`, which `POST`s directly to `https://api.anthropic.com/v1/messages` with **no API key**. This only worked inside the claude.ai artifact sandbox, which proxied the request. **Outside claude.ai this call fails by design**, and every caller degrades gracefully:

- `fetchDailyRecipes`: web-search prompt → knowledge-only prompt → `SAVED_POOL` (a hardcoded list of ~14 recipes), tagging results `null` / `"from memory"` / `"saved pick"`.
- `calculateExternalMacros` and `generateCookbookDraft`: search call → knowledge-only fallback → error UI with a retry button.

So features silently fall back rather than crash. **To make live AI work again**, do not embed a key in this frontend — stand up a backend/serverless proxy that holds the Anthropic key server-side and point `callClaude`'s `fetch` at that endpoint instead. The prompt builders (`SEARCH_PROMPT`, `MEMORY_PROMPT`, `buildMacroPrompt`, `buildRecipeGenPrompt`) all demand raw JSON (array or object); `callClaude` strips code fences and extracts the JSON with a regex before `JSON.parse`.

Note the model id in `callClaude` is currently `claude-sonnet-4-6`. When wiring a real proxy, prefer a current model id (e.g. Sonnet 5 / Opus 4.8) — consult the `claude-api` skill rather than assuming.

## Persistence

No backend and no database. State that survives reload uses browser `localStorage` via `loadPrefs`/`savePrefs` (async-shaped wrappers, a holdover from the artifact's `window.storage` API). Keys are namespaced, e.g. `cookbook:chicken-salad-pita:prefs`, `cookbook:eat:daily-picks`. Each recipe component persists its own toggle state; the daily picks are cached per-day.

## Repo layout note

Everything lives at the repo root (`src/App.jsx`, `package.json`, etc.). This is not a git repository.
