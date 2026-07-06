# Zara's Plate

A recipe box, weekly planner, and macro tracker — exported from a Claude artifact into a
standalone React + Vite project.

## Running it

You'll need [Node.js](https://nodejs.org) 18 or later installed.

```bash
npm install
npm run dev
```

Then open the local URL it prints (usually `http://localhost:5173`).

To build a production bundle:

```bash
npm run build
npm run preview   # serves the built output locally, to sanity-check it
```

## What changed moving out of claude.ai

This app started as a single-file artifact inside claude.ai. Two things only exist inside that
sandbox, so they were adapted:

- **Storage**: the artifact's `window.storage` API was swapped for real browser `localStorage`
  (see `loadPrefs`/`savePrefs` near the top of `src/App.jsx`). Recipe preference toggles persist
  the same way as before.
- **Live AI calls**: "Today's Picks," "Calculate macros," and "Add to cookbook" all call
  `callClaude()` (in `src/App.jsx`), which posts to `https://api.anthropic.com/v1/messages`.
  Inside claude.ai this works with no API key — outside it, this call will fail, which is
  expected. Everything using it already fails gracefully (Today's Picks falls back to a saved
  pool of recipes; the other two show a retry button), so nothing breaks — those three features
  just won't produce live results yet.

## Next step: wiring up the live features

To get live AI generation working again, you'll need:

1. An [Anthropic API key](https://console.anthropic.com/).
2. A small backend or serverless function (Node/Express, a Vercel/Netlify function, etc.) that
   holds the key server-side and forwards requests to the Anthropic API. **Don't** call the
   Anthropic API directly from this frontend with an embedded key — that exposes it to anyone
   who opens dev tools.
3. Point `callClaude()` at your own proxy endpoint instead of `api.anthropic.com` directly.

This last piece is a good next task to hand to Claude Code, once it's connected to this project
on disk.
