import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "./lib/auth";
import {
  fetchRecipes, insertRecipe, fetchMenu, insertMenuEntries, deleteMenuEntries,
  setEntriesMacros, convertEntriesToLibrary, menuRowToItem,
} from "./lib/db";

/* =========================================================================
   FONTS — one shared import covering the shell + every recipe theme.
   ========================================================================= */
export const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Archivo+Black&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');";

/* =========================================================================
   SHARED UTILITIES
   ========================================================================= */
function scaleAmount(base, factor) {
  const val = base * factor;
  const rounded = Math.round(val * 4) / 4;
  if (rounded === 0) return { whole: null, num: null, den: null, text: "a pinch" };
  if (Math.abs(rounded - Math.round(rounded)) < 0.01) {
    return { whole: Math.round(rounded), num: null, den: null, text: null };
  }
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  let num = null, den = null;
  if (Math.abs(frac - 0.25) < 0.01) { num = 1; den = 4; }
  else if (Math.abs(frac - 0.5) < 0.01) { num = 1; den = 2; }
  else if (Math.abs(frac - 0.75) < 0.01) { num = 3; den = 4; }
  else return { whole: null, num: null, den: null, text: frac.toFixed(2) };
  return { whole: whole > 0 ? whole : null, num, den, text: null };
}

function round(n) { return Math.round(n); }

// NOTE: the claude.ai artifact sandbox's `window.storage` doesn't exist outside claude.ai.
// Swapped to real browser localStorage here — same async interface, so every call site below
// (loadPrefs/savePrefs) works unchanged.
async function loadPrefs(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
async function savePrefs(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

// Fires onLongPress if held past `threshold`ms; otherwise fires onClick as a normal tap/click.
function useLongPress(onLongPress, onClick, threshold = 550) {
  const timerRef = useRef(null);
  const firedRef = useRef(false);

  const start = () => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, threshold);
  };
  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const handleClick = (e) => {
    if (firedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      firedRef.current = false;
      return;
    }
    onClick(e);
  };

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: handleClick,
  };
}

/* =========================================================================
   SHARED PRIMITIVES — every recipe is built from these.
   ========================================================================= */

function Amount({ value }) {
  if (value.text) return <span className="rp-amt-text">{value.text}</span>;
  return (
    <span className="rp-amt-wrap">
      {value.whole !== null && <span className="rp-amt-whole">{value.whole}</span>}
      {value.num !== null && (
        <span className="rp-amt-frac">
          <span className="rp-amt-num">{value.num}</span>
          <span className="rp-amt-den">{value.den}</span>
        </span>
      )}
    </span>
  );
}

function IngredientRow({ amt, value, unit, name, note }) {
  return (
    <div className="rp-ing-row">
      <span className="rp-ing-amt">
        {value ? <Amount value={value} /> : amt}
        {unit ? <span className="rp-ing-unit"> {unit}</span> : null}
      </span>
      <span className="rp-ing-name">
        {name}
        {note ? <span className="rp-ing-note"> — {note}</span> : null}
      </span>
    </div>
  );
}

function Section({ num, title, isOpen, onToggle, headerExtra, children }) {
  return (
    <section className="rp-section">
      <div className="rp-section-head">
        <button className="rp-section-toggle" onClick={onToggle} aria-expanded={isOpen}>
          {num ? <span className="rp-section-num">{num}</span> : null}
          <h2>{title}</h2>
          <span className={`rp-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">⌄</span>
        </button>
        {headerExtra ? <div className="rp-section-extra">{headerExtra}</div> : null}
      </div>
      {isOpen && <div className="rp-section-body">{children}</div>}
    </section>
  );
}

function OptionSwitch({ options, value, onChange, twoWay, thumbColor }) {
  if (twoWay && options.length === 2) {
    const idx = options.findIndex((o) => o.key === value);
    return (
      <div className="rp-switch" role="group">
        <div
          className="rp-switch-thumb"
          style={{ transform: idx === 1 ? "translateX(100%)" : "translateX(0%)", background: thumbColor }}
        />
        {options.map((o) => (
          <button key={o.key} className={value === o.key ? "active" : ""} onClick={() => onChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="rp-option-row">
      {options.map((o) => (
        <button
          key={o.key}
          className={`rp-option-btn ${value === o.key ? "active" : ""}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {o.sub ? <span className="rp-option-sub">{o.sub}</span> : null}
        </button>
      ))}
    </div>
  );
}

function QuantityStepper({ value, onChange, min, max, step, format }) {
  return (
    <div className="rp-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
        disabled={value <= min}
        aria-label="Decrease"
      >
        –
      </button>
      <span className="rp-stepper-amt">{format(value)}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
        disabled={value >= max}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <div className="rp-toggle-row">
      <span className="rp-control-label" style={{ marginBottom: 0 }}>{label}</span>
      <button
        className={`rp-toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
      >
        <span className="rp-toggle-knob" />
      </button>
    </div>
  );
}

function MacroBar({ protein, fat, carb, compact }) {
  const proteinCals = protein * 4;
  const carbCals = carb * 4;
  const fatCals = fat * 9;
  const totalCals = Math.max(proteinCals + carbCals + fatCals, 1);
  const proteinPct = Math.round((proteinCals / totalCals) * 100);
  const carbPct = Math.round((carbCals / totalCals) * 100);
  const fatPct = Math.max(0, 100 - proteinPct - carbPct);
  return (
    <div className={`rp-macro-block${compact ? " compact" : ""}`}>
      <div className="rp-macro-bar" aria-hidden="true">
        <span className="rp-macro-seg rp-macro-protein" style={{ width: `${proteinPct}%` }} />
        <span className="rp-macro-seg rp-macro-carb" style={{ width: `${carbPct}%` }} />
        <span className="rp-macro-seg rp-macro-fat" style={{ width: `${fatPct}%` }} />
      </div>
      <div className="rp-macro-legend">
        <span><i className="rp-dot rp-dot-protein" />{compact ? "P" : "Protein"} {proteinPct}%</span>
        <span><i className="rp-dot rp-dot-carb" />{compact ? "C" : "Carbs"} {carbPct}%</span>
        <span><i className="rp-dot rp-dot-fat" />{compact ? "F" : "Fat"} {fatPct}%</span>
      </div>
    </div>
  );
}

function NutritionCard({ subtitle, kcal, protein, fat, carb, extra }) {
  return (
    <div className="rp-nutrition">
      <div className="rp-nutrition-head">Nutrition Facts</div>
      <div className="rp-nutrition-sub">{subtitle}</div>
      <hr className="rp-rule-thick" />
      <div className="rp-kcal-row">
        <span className="rp-kcal-label">Calories</span>
        <span className="rp-kcal-value">{round(kcal)}</span>
      </div>
      <hr className="rp-rule-thin" />
      <MacroBar protein={protein} fat={fat} carb={carb} />
      <div className="rp-macro-row"><span>Protein</span><span>{round(protein)} g</span></div>
      <div className="rp-macro-row"><span>Fat</span><span>{round(fat)} g</span></div>
      <div className="rp-macro-row"><span>Carbs</span><span>{round(carb)} g</span></div>
      {extra ? <div className="rp-nutrition-extra">{extra}</div> : null}
    </div>
  );
}

function StepsList({ steps }) {
  return (
    <ol className="rp-steps">
      {steps.map((s, i) => (
        <li key={i}>
          {s.title ? <strong>{s.title}</strong> : null}
          {s.body}
          {s.note ? <div className="rp-note">{s.note}</div> : null}
        </li>
      ))}
    </ol>
  );
}

function RecipePage({ theme, eyebrow, title, subtitle, children }) {
  return (
    <div
      className="rp-page"
      style={{
        "--bg": theme.bg,
        "--ink": theme.ink,
        "--muted": theme.muted,
        "--accent": theme.accent,
        "--accent-soft": theme.accentSoft,
        "--line": theme.line,
        "--font-display": theme.fontDisplay,
        "--font-body": theme.fontBody,
        "--font-mono": theme.fontMono,
      }}
    >
      <div className="rp-wrap">
        <div className="rp-eyebrow">{eyebrow}</div>
        <h1 className="rp-title">{title}</h1>
        {subtitle ? <div className="rp-subtitle">{subtitle}</div> : null}
        {children}
      </div>
    </div>
  );
}

/* =========================================================================
   RECIPE 1 — Chicken Salad Pita Pockets
   ========================================================================= */
const PITA_THEME = {
  id: "pita",
  bg: "#EEEBDD",
  ink: "#292B22",
  muted: "#5B5D4E",
  accent: "#3F5039",
  accentSoft: "#DCE3D2",
  line: "#D8D2BE",
  fontDisplay: "'Fraunces', serif",
  fontBody: "'Work Sans', sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
};

const PITA_CUTS = {
  breast: {
    label: "Chicken Breast", tag: "Lean",
    kcal100: 165, protein100: 31, fat100: 3.6, carb100: 0,
    accent: "#3F5039",
    cook: "Air fry at 380°F for 18–20 min, flipping once halfway, until internal temp hits 165°F. Rest 5 min before shredding.",
  },
  thigh: {
    label: "Chicken Thigh", tag: "Richer",
    kcal100: 209, protein100: 26, fat100: 10.9, carb100: 0,
    accent: "#A8462A",
    cook: "Air fry at 380°F for 15–17 min, flipping once. Thighs have more fat, so they're more forgiving — pull at 165°F.",
  },
};
const GRAMS_PER_LB = 454;
const PITA_BREAD = { kcal: 170, protein: 6, fat: 1, carb: 35 };
function formatLb(quarters) {
  const whole = Math.floor(quarters / 4);
  const rem = quarters % 4;
  const fracMap = { 0: "", 1: "1/4", 2: "1/2", 3: "3/4" };
  const frac = fracMap[rem];
  if (whole === 0) return `${frac} lb`;
  return frac ? `${whole} ${frac} lb` : `${whole} lb`;
}
const PITA_STYLES = {
  basic: {
    label: "Classic", addins: { kcal: 601, protein: 19, fat: 53, carb: 18 },
    ingredients: [
      { amt: "1/2 cup", name: "plain full-fat Greek yogurt" }, { amt: "2 tbsp", name: "mayonnaise" },
      { amt: "1 cup", name: "celery, diced" }, { amt: "1/3 cup", name: "walnuts, chopped" },
      { amt: "2 tbsp", name: "red onion, finely diced" }, { amt: "1 tbsp", name: "Dijon mustard" },
      { amt: "1/2", name: "lemon, juiced" },
    ],
    baseStep: "Combine the Greek yogurt, mayonnaise, Dijon, and lemon juice in a large bowl.",
    foldStep: "Add the shredded chicken, celery, walnuts, and red onion. Fold until evenly coated.",
  },
  curry: {
    label: "Curry", addins: { kcal: 643, protein: 18, fat: 40, carb: 59 },
    ingredients: [
      { amt: "1/2 cup", name: "plain full-fat Greek yogurt" }, { amt: "2 tbsp", name: "mayonnaise" },
      { amt: "1 1/2 tsp", name: "curry powder" }, { amt: "2 tbsp", name: "mango chutney" },
      { amt: "1/4 cup", name: "golden raisins" }, { amt: "1/4 cup", name: "sliced almonds" },
    ],
    baseStep: "Whisk the Greek yogurt, mayonnaise, curry powder, and mango chutney together in a large bowl.",
    foldStep: "Add the shredded chicken, raisins, and almonds. Fold until evenly coated.",
  },
  buffalo: {
    label: "Buffalo", addins: { kcal: 424, protein: 23, fat: 32, carb: 10 },
    ingredients: [
      { amt: "1/2 cup", name: "plain full-fat Greek yogurt" }, { amt: "3 tbsp", name: "hot sauce" },
      { amt: "1 tbsp", name: "butter, melted" }, { amt: "1/3 cup", name: "blue cheese, crumbled" },
      { amt: "1 cup", name: "celery, diced" },
    ],
    baseStep: "Whisk the Greek yogurt, hot sauce, and melted butter together in a large bowl.",
    foldStep: "Add the shredded chicken, blue cheese, and celery. Fold until evenly coated.",
  },
  mediterranean: {
    label: "Mediterranean", addins: { kcal: 433, protein: 19, fat: 35, carb: 13 },
    ingredients: [
      { amt: "1/2 cup", name: "plain full-fat Greek yogurt" }, { amt: "1 tbsp", name: "olive oil" },
      { amt: "1", name: "lemon, juiced" }, { amt: "2 tbsp", name: "fresh dill, chopped" },
      { amt: "1/2 cup", name: "cucumber, diced" }, { amt: "1/4 cup", name: "kalamata olives, chopped" },
      { amt: "1/3 cup", name: "feta, crumbled" },
    ],
    baseStep: "Whisk the Greek yogurt, olive oil, lemon juice, and dill together in a large bowl.",
    foldStep: "Add the shredded chicken, cucumber, olives, and feta. Fold until evenly coated.",
  },
  chipotle: {
    label: "Smoky Chipotle", addins: { kcal: 572, protein: 25, fat: 49, carb: 16 },
    ingredients: [
      { amt: "1/2 cup", name: "plain full-fat Greek yogurt" }, { amt: "2 tbsp", name: "mayonnaise" },
      { amt: "2", name: "chipotle peppers in adobo, minced (+1 tbsp sauce)" }, { amt: "1", name: "lime, juiced" },
      { amt: "1/4 cup", name: "cilantro, chopped" }, { amt: "1/3 cup", name: "pepitas" },
    ],
    baseStep: "Whisk the Greek yogurt, mayonnaise, minced chipotle with sauce, and lime juice together in a large bowl.",
    foldStep: "Add the shredded chicken, cilantro, and pepitas. Fold until evenly coated.",
  },
  bagel: {
    label: "Everything Bagel", addins: { kcal: 409, protein: 11, fat: 37, carb: 9 },
    ingredients: [
      { amt: "1/4 cup", name: "plain full-fat Greek yogurt" }, { amt: "1/4 cup", name: "cream cheese, softened" },
      { amt: "1 tbsp", name: "mayonnaise" }, { amt: "2 tbsp", name: "everything bagel seasoning" },
      { amt: "2 tbsp", name: "chives, chopped" }, { amt: "1 tsp", name: "lemon juice" },
    ],
    baseStep: "Beat the Greek yogurt, cream cheese, and mayonnaise together until smooth.",
    foldStep: "Add the shredded chicken, everything bagel seasoning, and chives. Fold until evenly coated.",
  },
};

function PitaRecipe() {
  const [cut, setCut] = useState("thigh");
  const [style, setStyle] = useState("basic");
  const [quarters, setQuarters] = useState(4);
  const [openIng, setOpenIng] = useState(true);
  const [openSteps, setOpenSteps] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const PREF_KEY = "cookbook:chicken-salad-pita:prefs";

  useEffect(() => {
    (async () => {
      const p = await loadPrefs(PREF_KEY);
      if (p) {
        if (p.cut) setCut(p.cut);
        if (p.style) setStyle(p.style);
        if (p.quarters) setQuarters(p.quarters);
      }
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    savePrefs(PREF_KEY, { cut, style, quarters });
  }, [cut, style, quarters, loaded]);

  const cutData = PITA_CUTS[cut];
  const styleData = PITA_STYLES[style];

  const macros = useMemo(() => {
    const chickenGrams = (quarters / 4) * GRAMS_PER_LB;
    const chicken = {
      kcal: (chickenGrams / 100) * cutData.kcal100,
      protein: (chickenGrams / 100) * cutData.protein100,
      fat: (chickenGrams / 100) * cutData.fat100,
      carb: (chickenGrams / 100) * cutData.carb100,
    };
    const addins = styleData.addins;
    const batch = {
      kcal: chicken.kcal + addins.kcal, protein: chicken.protein + addins.protein,
      fat: chicken.fat + addins.fat, carb: chicken.carb + addins.carb,
    };
    const perServing = { kcal: batch.kcal / 2, protein: batch.protein / 2, fat: batch.fat / 2, carb: batch.carb / 2 };
    const withPita = {
      kcal: perServing.kcal + PITA_BREAD.kcal, protein: perServing.protein + PITA_BREAD.protein,
      fat: perServing.fat + PITA_BREAD.fat, carb: perServing.carb + PITA_BREAD.carb,
    };
    return { perServing, withPita };
  }, [cutData, styleData, quarters]);

  return (
    <RecipePage theme={PITA_THEME} eyebrow="Meal Prep Card" title="Chicken Salad Pita Pockets"
      subtitle={`Makes 2 pockets · flip the switch, pick a style below`}>
      <OptionSwitch
        twoWay
        options={[{ key: "breast", label: "Breast" }, { key: "thigh", label: "Thigh" }]}
        value={cut} onChange={setCut} thumbColor={cutData.accent}
      />
      <div className="rp-cuttag">{cutData.label} — {cutData.tag.toLowerCase()}, {formatLb(quarters)} cooked</div>

      <NutritionCard
        subtitle={`Per serving (1 pocket, ${styleData.label.toLowerCase()} salad only)`}
        kcal={macros.perServing.kcal} protein={macros.perServing.protein}
        fat={macros.perServing.fat} carb={macros.perServing.carb}
        extra={`With 1 pita pocket: ${round(macros.withPita.kcal)} kcal · ${round(macros.withPita.protein)}g protein · ${round(macros.withPita.fat)}g fat · ${round(macros.withPita.carb)}g carbs`}
      />

      <Section
        title="Ingredients" isOpen={openIng} onToggle={() => setOpenIng((v) => !v)}
        headerExtra={
          <select className="rp-select" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Choose salad style">
            {Object.entries(PITA_STYLES).map(([key, s]) => (<option key={key} value={key}>{s.label}</option>))}
          </select>
        }
      >
        <div className="rp-amount-row">
          <QuantityStepper value={quarters} onChange={setQuarters} min={1} max={12} step={1} format={formatLb} />
          <span className="rp-amount-label">{cutData.label}, cooked &amp; shredded</span>
        </div>
        {styleData.ingredients.map((ing, i) => (<IngredientRow key={i} amt={ing.amt} name={ing.name} />))}
        <IngredientRow amt="2" name="whole wheat pita pockets" />
        <IngredientRow amt="1/2 tsp" name="salt" />
        <IngredientRow amt="1/4 tsp" name="black pepper" />
      </Section>

      <Section title="Steps" isOpen={openSteps} onToggle={() => setOpenSteps((v) => !v)}>
        <StepsList steps={[
          { title: `Cook the ${cutData.label.toLowerCase()}`, body: "", note: cutData.cook },
          { title: "Mix the base", body: styleData.baseStep },
          { title: "Fold everything together", body: styleData.foldStep },
          { title: "Season and chill", body: "Add salt and pepper. Chill at least 30 minutes so the flavor comes together." },
          { title: "Fill the pockets", body: "Split the salad between 2 pitas — toast them first with a light brush of olive oil if you want them sturdier." },
        ]} />
      </Section>
    </RecipePage>
  );
}

/* =========================================================================
   RECIPE 2 — Fried Chicken Sandwich, Home Edition
   ========================================================================= */
const SANDWICH_THEME = {
  id: "sandwich",
  bg: "#FAF3E7",
  ink: "#1E1812",
  muted: "#7A8B5C",
  accent: "#C1502E",
  accentSoft: "#F1DFC9",
  line: "#DCD0BA",
  fontDisplay: "'Archivo Black', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'JetBrains Mono', monospace",
};

const PROTEINS = {
  chickenThighs: {
    label: "Chicken thighs", sub: "boneless, skinless", brineMaxMinutes: 90,
    brineNote: "Past 2 hours the texture goes spongy — these are thin and brine fast.",
    fryTime: "10–12 min at 375°F, flip at 5–6 min",
    pieceWeightG: 113, kcal100: 209, protein100: 26, fat100: 10.9, carb100: 0,
  },
  chickenBreast: {
    label: "Chicken breast", sub: 'boneless, skinless, halved + pounded to ¾"', brineMaxMinutes: 60,
    brineNote: "Breast dries out fast — don't exceed an hour, and pound to even thickness first.",
    fryTime: "12–14 min at 375°F, flip at 6–7 min",
    pieceWeightG: 142, kcal100: 165, protein100: 31, fat100: 3.6, carb100: 0,
  },
  porkChops: {
    label: "Pork chops", sub: 'boneless, ¾"–1" thick', brineMaxMinutes: 120,
    brineNote: "Pork tolerates brine a bit longer than chicken — up to 2 hours is fine.",
    fryTime: "12–15 min at 375°F, flip at 7 min — pork is done at 145°F, not 165°F",
    pieceWeightG: 142, kcal100: 231, protein100: 25, fat100: 14, carb100: 0,
  },
};
// Approximate nutrition added by the fried coating itself, per piece — real values vary with
// breading thickness and how much oil the crust soaks up.
const BREADING_FLOUR_ONLY = { kcal: 90, protein: 3, fat: 3, carb: 11 };
const BREADING_PANKO_EXTRA = { kcal: 70, protein: 2, fat: 2, carb: 9 };
const BASE_BRINE = { water: 3, waterUnit: "cups", salt: 3, saltUnit: "tbsp", sugar: 2, sugarUnit: "tbsp", bay: 3, garlic: 3 };
const BASE_FLOUR = { flour: 1.5, flourUnit: "cups", sugar: 1, sugarUnit: "tbsp", paprika: 1.5, salt: 1.75, pepper: 1, garlicPowder: 0.25, onionPowder: 0.25, bakingPowder: 0.5 };
const CORNSTARCH_SWAP_CUPS = 0.125;
const BASE_WASH = { milk: 1, milkUnit: "cup", eggs: 2 };
const BASE_PANKO_CUPS = 1.5;
const PANKO_FLOUR_TRIM_CUPS = 0.25;

function SandwichRecipe() {
  const [proteinKey, setProteinKey] = useState("chickenThighs");
  const [lbs, setLbs] = useState(2);
  const [cornstarchMode, setCornstarchMode] = useState(false);
  const [pankoMode, setPankoMode] = useState(false);
  const [openSections, setOpenSections] = useState({ brine: true, flour: true, panko: true, wash: true, dredge: true, fry: true });
  const [loaded, setLoaded] = useState(false);
  const PREF_KEY = "cookbook:fried-chicken-sandwich:prefs";

  useEffect(() => {
    (async () => {
      const p = await loadPrefs(PREF_KEY);
      if (p) {
        if (p.proteinKey && PROTEINS[p.proteinKey]) setProteinKey(p.proteinKey);
        if (p.lbs) setLbs(p.lbs);
        if (typeof p.cornstarchMode === "boolean") setCornstarchMode(p.cornstarchMode);
        if (typeof p.pankoMode === "boolean") setPankoMode(p.pankoMode);
        if (p.openSections) setOpenSections((prev) => ({ ...prev, ...p.openSections }));
      }
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    savePrefs(PREF_KEY, { proteinKey, lbs, cornstarchMode, pankoMode, openSections });
  }, [proteinKey, lbs, cornstarchMode, pankoMode, openSections, loaded]);

  const protein = PROTEINS[proteinKey];
  const factor = lbs / 2;
  const toggleSection = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const brineMinutesLabel =
    protein.brineMaxMinutes >= 120 ? "30 min – 2 hrs" : protein.brineMaxMinutes >= 90 ? "30 min – 1.5 hrs" : "20 – 45 min";

  const macros = useMemo(() => {
    const proteinGrams = protein.pieceWeightG;
    const base = {
      kcal: (proteinGrams / 100) * protein.kcal100,
      protein: (proteinGrams / 100) * protein.protein100,
      fat: (proteinGrams / 100) * protein.fat100,
      carb: (proteinGrams / 100) * protein.carb100,
    };
    const breading = pankoMode
      ? {
          kcal: BREADING_FLOUR_ONLY.kcal + BREADING_PANKO_EXTRA.kcal,
          protein: BREADING_FLOUR_ONLY.protein + BREADING_PANKO_EXTRA.protein,
          fat: BREADING_FLOUR_ONLY.fat + BREADING_PANKO_EXTRA.fat,
          carb: BREADING_FLOUR_ONLY.carb + BREADING_PANKO_EXTRA.carb,
        }
      : BREADING_FLOUR_ONLY;
    return {
      kcal: base.kcal + breading.kcal,
      protein: base.protein + breading.protein,
      fat: base.fat + breading.fat,
      carb: base.carb + breading.carb,
    };
  }, [protein, pankoMode]);

  return (
    <RecipePage theme={SANDWICH_THEME} eyebrow="Lunch, Solved" title="Fried Chicken Sandwich — Home Edition"
      subtitle="Scales from a 2 lb base · pick your protein below">
      <div className="rp-control-block">
        <span className="rp-control-label">Protein</span>
        <OptionSwitch
          options={Object.entries(PROTEINS).map(([key, p]) => ({ key, label: p.label, sub: p.sub }))}
          value={proteinKey} onChange={setProteinKey}
        />
        <span className="rp-control-label">Amount</span>
        <QuantityStepper
          value={lbs} onChange={setLbs} min={0.5} max={8} step={0.5}
          format={(v) => `${v % 1 === 0 ? v : v.toFixed(2).replace(/0$/, "")} lbs`}
        />
        <ToggleSwitch checked={cornstarchMode} onChange={setCornstarchMode} label="No baking powder — sub cornstarch" />
        <ToggleSwitch checked={pankoMode} onChange={setPankoMode} label="Add panko crust" />
      </div>

      <NutritionCard
        subtitle={`Per piece, breaded & air-fried (${protein.label.toLowerCase()})`}
        kcal={macros.kcal} protein={macros.protein} fat={macros.fat} carb={macros.carb}
        extra="Rough estimate — real values vary with breading thickness and how much oil the crust soaks up."
      />

      <Section num="1" title="Brine" isOpen={openSections.brine} onToggle={() => toggleSection("brine")}>
        <IngredientRow value={scaleAmount(BASE_BRINE.water, factor)} unit={BASE_BRINE.waterUnit} name="water" />
        <IngredientRow value={scaleAmount(BASE_BRINE.salt, factor)} unit={BASE_BRINE.saltUnit} name="kosher salt" />
        <IngredientRow value={scaleAmount(BASE_BRINE.sugar, factor)} unit={BASE_BRINE.sugarUnit} name="brown sugar" />
        <IngredientRow value={scaleAmount(BASE_BRINE.bay, factor)} unit="" name="bay leaves" />
        <IngredientRow value={scaleAmount(BASE_BRINE.garlic, factor)} unit="" name="garlic cloves, smashed" />
        <div className="rp-note">
          Heat a third of the water with salt, sugar, bay, garlic until dissolved. Steep, then stir in the rest cold. Submerge, refrigerate.
          <br /><strong>{brineMinutesLabel}</strong> — {protein.brineNote}
        </div>
      </Section>

      <Section num="2" title="Seasoned flour" isOpen={openSections.flour} onToggle={() => toggleSection("flour")}>
        <IngredientRow
          value={scaleAmount(BASE_FLOUR.flour - (cornstarchMode ? CORNSTARCH_SWAP_CUPS : 0) - (pankoMode ? PANKO_FLOUR_TRIM_CUPS : 0), factor)}
          unit={BASE_FLOUR.flourUnit} name="all-purpose flour"
        />
        {cornstarchMode && <IngredientRow value={scaleAmount(CORNSTARCH_SWAP_CUPS, factor)} unit="cup" name="cornstarch" note="swapped in for crispness" />}
        <IngredientRow value={scaleAmount(BASE_FLOUR.sugar, factor)} unit={BASE_FLOUR.sugarUnit} name="granulated sugar" />
        <IngredientRow value={scaleAmount(BASE_FLOUR.paprika, factor)} unit="tsp" name="paprika" />
        <IngredientRow value={scaleAmount(BASE_FLOUR.salt, factor)} unit="tsp" name="salt" />
        <IngredientRow value={scaleAmount(BASE_FLOUR.pepper, factor)} unit="tsp" name="black pepper" />
        <IngredientRow value={scaleAmount(BASE_FLOUR.garlicPowder, factor)} unit="tsp" name="garlic powder" />
        <IngredientRow value={scaleAmount(BASE_FLOUR.onionPowder, factor)} unit="tsp" name="onion powder" />
        {!cornstarchMode && <IngredientRow value={scaleAmount(BASE_FLOUR.bakingPowder, factor)} unit="tsp" name="baking powder" />}
        {cornstarchMode && <div className="rp-note">No baking powder here — you'll lose a little airy lift, but the cornstarch gives a more delicate, crackly crust instead.</div>}
        {pankoMode && <div className="rp-note">Flour trimmed slightly since less of it stays on once the chicken goes back through wash and panko below.</div>}
      </Section>

      {pankoMode && (
        <Section num="2b" title="Panko crust" isOpen={openSections.panko} onToggle={() => toggleSection("panko")}>
          <IngredientRow value={scaleAmount(BASE_PANKO_CUPS, factor)} unit="cups" name="panko breadcrumbs" />
          <div className="rp-note">Goes on top of the flour coat, not instead of it. Press in firmly so it doesn't shed in the basket.</div>
        </Section>
      )}

      <Section num="3" title="Egg / milk wash" isOpen={openSections.wash} onToggle={() => toggleSection("wash")}>
        <IngredientRow value={scaleAmount(BASE_WASH.milk, factor)} unit={BASE_WASH.milkUnit} name="milk (or buttermilk)" />
        <IngredientRow value={scaleAmount(BASE_WASH.eggs, factor)} unit="" name="eggs, whisked in" />
      </Section>

      <Section num="4" title="Seed & dredge" isOpen={openSections.dredge} onToggle={() => toggleSection("dredge")}>
        <StepsList steps={[
          { body: 'Mix dry flour ingredients. Drizzle in 2–3 tbsp of the egg/milk wash, rub between fingers until small wet clumps form — this is the "seeding" step that gives a craggy crust.' },
          { body: "Dip brined, dried protein into the egg/milk wash. Let excess drip off." },
          { body: `Press into seeded seasoned flour, coating fully.${pankoMode ? "" : " No second dip."}` },
          ...(pankoMode ? [{ body: "Dip back into the egg/milk wash briefly." }, { body: "Press firmly into panko, coating fully on all sides." }] : []),
          { body: "Rest breaded pieces on a rack 5–10 min before cooking." },
          { body: `Brush a thin, even layer of oil over the breaded surface${pankoMode ? " — panko needs a touch more oil than flour alone to brown well" : " (no mister needed)"}.` },
        ]} />
      </Section>

      <Section num="5" title="Air fry" isOpen={openSections.fry} onToggle={() => toggleSection("fry")}>
        <div className="rp-timing-pill">⏱ Preheat 375°F</div>
        <StepsList steps={[
          { body: "Single layer in the basket, pieces not touching." },
          { body: `${protein.fryTime}.` },
          { body: "Oil the flipped side too." },
          { body: "Check internal temp at the low end of the range — don't rely on time alone." },
        ]} />
        <div className="rp-note">
          {proteinKey === "porkChops" ? "Pork is done at 145°F. Pulling too late is the most common way to dry it out." : "Chicken is done at 165°F."}
        </div>
      </Section>
    </RecipePage>
  );
}

const GENERATED_THEMES = [
  { bg: "#EFEDE6", ink: "#23262B", muted: "#6B6F76", accent: "#5B7B7A", accentSoft: "#D9E3E2", line: "#D8D5CC", fontDisplay: "'Libre Caslon Display', serif", fontBody: "'Work Sans', sans-serif", fontMono: "'JetBrains Mono', monospace" },
  { bg: "#F3ECE3", ink: "#2A241C", muted: "#8A7B65", accent: "#B0552F", accentSoft: "#EAD9C8", line: "#DCCFBB", fontDisplay: "'Fraunces', serif", fontBody: "'Inter', sans-serif", fontMono: "'IBM Plex Mono', monospace" },
  { bg: "#EAEAF2", ink: "#22232E", muted: "#6E7086", accent: "#5A5FBF", accentSoft: "#DADCF2", line: "#D2D3E4", fontDisplay: "'Archivo Black', sans-serif", fontBody: "'Work Sans', sans-serif", fontMono: "'JetBrains Mono', monospace" },
  { bg: "#EDF0E6", ink: "#232B1E", muted: "#728064", accent: "#6E8F3E", accentSoft: "#DCE6D0", line: "#D4DCC6", fontDisplay: "'Fraunces', serif", fontBody: "'Inter', sans-serif", fontMono: "'IBM Plex Mono', monospace" },
];

// Cooked, boneless & skinless basis — same reference values used by the Pita recipe's own cut toggle,
// so both features agree with each other.
const CHICKEN_MACROS_PER_100G = {
  breast: { kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  thigh: { kcal: 209, protein: 26, fat: 10.9, carb: 0 },
};

// Finds whichever chicken cut (breast or thigh) a generated recipe's ingredients call for.
function detectChickenCut(ingredients) {
  for (const ing of ingredients || []) {
    const m = (ing.name || "").match(/chicken\s+(breast|thigh)s?/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
// Swaps "breast"/"thigh" wherever it follows "chicken", leaving every other word — bone-in, skin-on,
// boneless, skinless, pounded, etc. — exactly as written, so those descriptors carry over untouched.
function swapChickenCutText(text, toCut) {
  if (!text) return text;
  return text.replace(/chicken(\s+)(breast|thigh)(s?)/gi, (_match, space, word, plural) => {
    let rep = toCut;
    if (word[0] === word[0].toUpperCase()) rep = rep.charAt(0).toUpperCase() + rep.slice(1);
    return `chicken${space}${rep}${plural}`;
  });
}
// Parses a rough gram weight out of a free-text ingredient amount ("1.5 lbs", "6 oz", "1 1/2 lb").
// Falls back to a typical single-piece weight when the amount is just a count with no unit.
function parseIngredientGrams(amtText) {
  if (!amtText) return null;
  const text = amtText.toLowerCase();
  const numMatch = text.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(\.\d+)?)/);
  if (!numMatch) return null;
  const numStr = numMatch[1];
  let value;
  if (numStr.includes("/")) {
    const parts = numStr.split(" ");
    if (parts.length === 2) {
      const [n, d] = parts[1].split("/").map(Number);
      value = parseFloat(parts[0]) + n / d;
    } else {
      const [n, d] = numStr.split("/").map(Number);
      value = n / d;
    }
  } else {
    value = parseFloat(numStr);
  }
  if (Number.isNaN(value)) return null;
  if (/\blbs?\b|\bpounds?\b/.test(text)) return value * 453.592;
  if (/\boz\b|\bounces?\b/.test(text)) return value * 28.3495;
  if (/\bkg\b/.test(text)) return value * 1000;
  if (/\bgrams?\b|\bg\b/.test(text)) return value;
  return value * 170; // no unit given — assume a typical ~170g piece
}
function totalChickenGrams(ingredients) {
  let total = 0;
  (ingredients || []).forEach((ing) => {
    if (/chicken\s+(breast|thigh)s?/i.test(ing.name || "")) {
      const g = parseIngredientGrams(ing.amt);
      if (g) total += g;
    }
  });
  return total;
}

// Generic detail-view renderer for recipes generated via "Add to cookbook" — uses the exact same
// building blocks (RecipePage, Section, IngredientRow, StepsList, NutritionCard) as the hand-built ones.
function GeneratedRecipeComponent({ recipe }) {
  const [openIng, setOpenIng] = useState(true);
  const [openSteps, setOpenSteps] = useState(true);
  const detectedCut = useMemo(() => detectChickenCut(recipe.ingredients), [recipe.ingredients]);
  const [cut, setCut] = useState(detectedCut || "breast");

  const displayIngredients = useMemo(
    () => (detectedCut ? recipe.ingredients.map((ing) => ({ ...ing, name: swapChickenCutText(ing.name, cut) })) : recipe.ingredients),
    [recipe.ingredients, cut, detectedCut]
  );
  const displaySteps = useMemo(
    () =>
      detectedCut
        ? recipe.steps.map((s) => ({ ...s, title: swapChickenCutText(s.title, cut), body: swapChickenCutText(s.body, cut) }))
        : recipe.steps,
    [recipe.steps, cut, detectedCut]
  );

  const chickenGrams = useMemo(() => totalChickenGrams(recipe.ingredients), [recipe.ingredients]);
  const perServingChickenGrams = chickenGrams / (recipe.servings || 4);
  const canRecalculate = detectedCut && perServingChickenGrams > 0;

  const displayMacros = useMemo(() => {
    if (!canRecalculate || cut === detectedCut) return recipe.macros;
    const oldRef = CHICKEN_MACROS_PER_100G[detectedCut];
    const newRef = CHICKEN_MACROS_PER_100G[cut];
    const factor = perServingChickenGrams / 100;
    return {
      kcal: Math.max(0, recipe.macros.kcal + (newRef.kcal - oldRef.kcal) * factor),
      protein: Math.max(0, recipe.macros.protein + (newRef.protein - oldRef.protein) * factor),
      fat: Math.max(0, recipe.macros.fat + (newRef.fat - oldRef.fat) * factor),
      carb: Math.max(0, recipe.macros.carb + (newRef.carb - oldRef.carb) * factor),
    };
  }, [recipe.macros, cut, detectedCut, perServingChickenGrams, canRecalculate]);

  return (
    <RecipePage theme={recipe.theme} eyebrow={recipe.kicker || "From the Web"} title={recipe.title} subtitle={recipe.blurb}>
      {detectedCut ? (
        <div className="rp-control-block">
          <span className="rp-control-label">Chicken cut</span>
          <OptionSwitch
            twoWay
            options={[{ key: "breast", label: "Breast" }, { key: "thigh", label: "Thigh" }]}
            value={cut}
            onChange={setCut}
            thumbColor={recipe.theme.accent}
          />
          <div className="rp-note">
            {canRecalculate
              ? `Bone-in, skin-on, boneless, or skinless — whatever the recipe called for stays the same, only the cut swaps. Nutrition below is recalculated using standard per-100g values for cooked chicken breast vs. thigh, based on the ~${Math.round(perServingChickenGrams)}g of chicken per serving.`
              : "Bone-in, skin-on, boneless, or skinless — whatever the recipe called for stays the same, only the cut swaps. Couldn't tell how much chicken this recipe uses, so nutrition below still reflects the original cut."}
          </div>
        </div>
      ) : null}
      <NutritionCard
        subtitle="Per serving (estimated)"
        kcal={displayMacros.kcal}
        protein={displayMacros.protein}
        fat={displayMacros.fat}
        carb={displayMacros.carb}
      />
      <Section title="Ingredients" isOpen={openIng} onToggle={() => setOpenIng((v) => !v)}>
        {displayIngredients.map((ing, i) => (<IngredientRow key={i} amt={ing.amt} name={ing.name} />))}
      </Section>
      <Section title="Steps" isOpen={openSteps} onToggle={() => setOpenSteps((v) => !v)}>
        <StepsList steps={displaySteps} />
      </Section>
      {recipe.sourceUrl ? (
        <div className="rp-source-note">
          Inspired by <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">{recipe.sourceName || "the original recipe"}</a> —
          these ingredients and steps are Claude's own original take, not copied from the source.
        </div>
      ) : null}
    </RecipePage>
  );
}

/* =========================================================================
   RECIPE REGISTRY — add new recipes here as we build them.
   ========================================================================= */
const RECIPES = [
  {
    id: "chicken-salad-pita", title: "Chicken Salad Pita Pockets", kicker: "Meal Prep",
    tags: ["meal prep", "no-cook assembly", "6 flavor variants"],
    blurb: "Shredded chicken folded into one of six dressings, stuffed into a pita. Flexes between lean and indulgent depending on your week.",
    time: "~55 min (30 of it hands-off chilling)", theme: PITA_THEME, Component: PitaRecipe,
    protein: ["chicken"], diet: "meat", dateAdded: "2026-07-05",
    macros: { kcal: 775, protein: 69, fat: 51, carb: 9 },
  },
  {
    id: "fried-chicken-sandwich", title: "Fried Chicken Sandwich — Home Edition", kicker: "Lunch, Solved",
    tags: ["air-fried", "3 protein options", "double dredge"],
    blurb: "A proper diner-style fried chicken sandwich, brined and double-dredged, done in the air fryer. Works with thighs, breast, or pork chops.",
    time: "~45 min active, plus brine (20 min – 2 hrs)", theme: SANDWICH_THEME, Component: SandwichRecipe,
    protein: ["chicken", "pork"], diet: "meat", dateAdded: "2026-07-05",
    macros: { kcal: 326, protein: 32, fat: 15, carb: 11 },
  },
];

/* =========================================================================
   INDEX / SHELL
   ========================================================================= */
function RecipeCard({ recipe, index, onOpen, onAddToMenu, onQuickAddToday, inPlan }) {
  const m = recipe.macros;
  const [justAdded, setJustAdded] = useState(false);
  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(recipe.id);
    }
  };
  const menuItem = { kind: "library", id: recipe.id, label: recipe.title };
  const longPress = useLongPress(
    () => onAddToMenu(menuItem),
    () => {
      onQuickAddToday(menuItem);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1400);
    }
  );
  return (
    <div
      className="cb-card"
      style={{ "--card-accent": recipe.theme.accent, "--accent": recipe.theme.accent }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(recipe.id)}
      onKeyDown={handleKeyDown}
    >
      <div className="cb-card-num">No. {String(index + 1).padStart(3, "0")}</div>
      <div className="cb-card-title">{recipe.title}</div>
      {m ? <MacroBar protein={m.protein} fat={m.fat} carb={m.carb} compact /> : null}
      <div className="cb-card-blurb">{recipe.blurb}</div>
      <div className="cb-card-meta">{recipe.time}</div>
      <div className="cb-card-tags">
        {recipe.tags.map((t) => (<span key={t} className="cb-tag">{t}</span>))}
      </div>
      <div className="cb-card-footer">
        <button
          type="button"
          className="cb-card-addmenu"
          title="Tap to add to today's dinner · long-press to pick days & meals"
          onPointerDown={(e) => { e.stopPropagation(); longPress.onPointerDown(e); }}
          onPointerUp={longPress.onPointerUp}
          onPointerLeave={longPress.onPointerLeave}
          onPointerCancel={longPress.onPointerCancel}
          onClick={(e) => { e.stopPropagation(); longPress.onClick(e); }}
        >
          {justAdded ? "✓ Added to today" : inPlan ? "Log this meal" : "+ Add to today"}
        </button>
        <span className="cb-card-cta">Open recipe →</span>
      </div>
    </div>
  );
}

function CarouselCard({ r, imgFailed, onImgError, onAddToPrompt, onAddToMenu, onQuickAddToday }) {
  const [justAdded, setJustAdded] = useState(false);
  const showImage = r.imageUrl && !imgFailed;
  const menuItem = { kind: "external", data: r, label: r.title };
  const longPress = useLongPress(
    () => onAddToMenu(menuItem),
    () => {
      onQuickAddToday(menuItem);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1400);
    }
  );
  return (
    <div className="cb-rcard">
      <div className={`cb-rcard-media ${showImage ? "" : "no-image"}`}>
        {showImage ? (
          <img src={r.imageUrl} alt="" onError={onImgError} />
        ) : (
          <span className="cb-rcard-fallback">{(r.source || "?").charAt(0)}</span>
        )}
      </div>
      <div className="cb-rcard-body">
        <div className="cb-rcard-source">
          {r.source}{r.badge ? <span className="cb-rcard-badge"> · {r.badge}</span> : null}
        </div>
        <div className="cb-rcard-title">{r.title}</div>
        <div className="cb-rcard-teaser">{r.teaser}</div>
      </div>
      <div className="cb-rcard-actions">
        <button className="cb-rcard-add" type="button" onClick={() => onAddToPrompt(r)}>+ Add to prompt</button>
        <button
          className="cb-rcard-add"
          type="button"
          title="Tap to add to today's dinner · long-press to pick days & meals"
          onPointerDown={longPress.onPointerDown}
          onPointerUp={longPress.onPointerUp}
          onPointerLeave={longPress.onPointerLeave}
          onPointerCancel={longPress.onPointerCancel}
          onClick={longPress.onClick}
        >
          {justAdded ? "✓ Added to today" : "+ Add to today"}
        </button>
        {r.url ? (
          <a className="cb-rcard-open" href={r.url} target="_blank" rel="noopener noreferrer">View ↗</a>
        ) : null}
      </div>
    </div>
  );
}

function WeekStrip({ weekDays, selectedDay, onSelectDay, menu, todayISO, onClearWeek }) {
  return (
    <div className="cb-week-wrap">
      <div className="cb-carousel-head">
        <span className="cb-carousel-label">This Week • {formatShortMonthDay(weekDays[0])} – {formatShortMonthDay(weekDays[6])}</span>
        <button type="button" className="cb-clear-btn" onClick={onClearWeek}>Clear week</button>
      </div>
      <div className="cb-week-strip" role="group" aria-label="Select a day to view its planned meals">
        {weekDays.map((d) => {
          const iso = dateToISO(d);
          const isSelected = selectedDay === iso;
          const isToday = iso === todayISO;
          const hasMeals = (menu[iso] || []).length > 0;
          return (
            <button
              key={iso}
              type="button"
              className={`cb-week-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
              onClick={() => onSelectDay(isSelected ? null : iso)}
              aria-pressed={isSelected}
            >
              <span className="cb-week-day-label">{WEEKDAY_LABELS[d.getDay()]}</span>
              <span className="cb-week-day-num">{d.getDate()}</span>
              {hasMeals ? <span className="cb-week-day-dot" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlanEmptyState({ title, sub }) {
  return (
    <div className="cb-plan-empty">
      <div className="cb-plan-empty-title">{title}</div>
      <div className="cb-plan-empty-sub">{sub}</div>
    </div>
  );
}

function ExternalMenuCard({ entry, onCalculateMacros, calcStatus, onAddToCookbook }) {
  const data = entry.data;
  const status = calcStatus ? calcStatus.status : "idle";
  return (
    <div className="cb-card cb-card-external" style={{ "--card-accent": "#C99A3E" }}>
      <div className="cb-card-num">
        {data.source || "Web pick"}
        {data.url ? (
          <> · <a className="cb-card-source-link" href={data.url} target="_blank" rel="noopener noreferrer">View original ↗</a></>
        ) : null}
      </div>
      <div className="cb-card-title">{data.title}</div>
      {entry.macros ? <MacroBar protein={entry.macros.protein} fat={entry.macros.fat} carb={entry.macros.carb} compact /> : null}
      {data.teaser ? <div className="cb-card-blurb">{data.teaser}</div> : null}
      <div className="cb-card-footer">
        {entry.macros ? (
          <span className="cb-card-meta">{Math.round(entry.macros.kcal)} kcal</span>
        ) : status === "loading" ? (
          <span className="cb-card-meta">Calculating…</span>
        ) : (
          <button type="button" className="cb-card-addmenu" onClick={() => onCalculateMacros(data)}>
            {status === "error" ? "Retry macros" : "Calculate macros"}
          </button>
        )}
        <button type="button" className="cb-card-cookbook-cta" onClick={() => onAddToCookbook(data, entry.macros)}>
          Add to cookbook →
        </button>
      </div>
      {status === "error" ? <div className="cb-card-error">{calcStatus.error}</div> : null}
    </div>
  );
}

// Swipe left to reveal a Delete button; tapping it removes the item (the tap is the confirmation).
function SwipeableMenuCard({ children, onRequestDelete }) {
  const REVEAL_WIDTH = 84;
  const [translateX, setTranslateX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const baseXRef = useRef(0);
  const movedRef = useRef(false);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    movedRef.current = false;
    startXRef.current = e.clientX;
    baseXRef.current = revealed ? -REVEAL_WIDTH : 0;
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 4) movedRef.current = true;
    setTranslateX(Math.max(-REVEAL_WIDTH, Math.min(0, baseXRef.current + delta)));
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setTranslateX((current) => {
      const shouldOpen = current < -REVEAL_WIDTH / 2;
      setRevealed(shouldOpen);
      return shouldOpen ? -REVEAL_WIDTH : 0;
    });
  };
  // Swallow the click that follows a drag so it doesn't also open the recipe underneath.
  const onClickCapture = (e) => {
    if (movedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      movedRef.current = false;
    }
  };

  return (
    <div className="cb-swipe-wrap">
      <div className="cb-swipe-delete">
        <button type="button" className="cb-swipe-delete-btn" onClick={onRequestDelete}>Delete</button>
      </div>
      <div
        className="cb-swipe-content"
        style={{ transform: `translateX(${translateX}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}

function renderMenuItem(item, iso, handlers) {
  let card;
  let key;
  if (item.kind === "library") {
    const r = handlers.recipes.find((rec) => rec.id === item.id);
    if (!r) return null;
    key = `lib-${r.id}`;
    card = (
      <RecipeCard
        recipe={r}
        index={handlers.recipes.indexOf(r)}
        onOpen={handlers.onOpenRecipe}
        onAddToMenu={handlers.onAddToMenu}
        onQuickAddToday={handlers.onQuickAddToday}
        inPlan
      />
    );
  } else if (item.kind === "external") {
    const extKey = item.data.url || item.data.title;
    key = `ext-${extKey}`;
    card = (
      <ExternalMenuCard
        entry={item}
        onCalculateMacros={handlers.onCalculateMacros}
        calcStatus={handlers.externalMacroStatus[extKey]}
        onAddToCookbook={handlers.onAddToCookbook}
      />
    );
  } else {
    return null;
  }
  return (
    <SwipeableMenuCard key={key} onRequestDelete={() => handlers.onRequestDelete(iso, item)}>
      {card}
    </SwipeableMenuCard>
  );
}

// Renders one day as its three meal slots. Each slot shows either its planned card(s) or,
// when empty, a placeholder skeleton so every meal-time is always visible.
function DaySlots({ iso, items, handlers }) {
  return (
    <div className="cb-slots">
      {MEALS.map((meal) => {
        const slotItems = items.filter((it) => (it.meal || DEFAULT_MEAL) === meal.key);
        return (
          <div key={meal.key} className="cb-slot">
            <span className={`cb-slot-label cb-slot-${meal.key}`}>{meal.label}</span>
            {slotItems.length ? (
              <div className="cb-grid">{slotItems.map((item) => renderMenuItem(item, iso, handlers))}</div>
            ) : (
              <div className="cb-slot-empty" aria-label={`No ${meal.label.toLowerCase()} planned`}>
                <span className="cb-slot-empty-mark" aria-hidden="true" />
                <span className="cb-slot-empty-text">No {meal.label.toLowerCase()} planned yet</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlanView({
  weekDays, selectedDay, todayISO, menu, recipes, onOpenRecipe, onAddToMenu, onQuickAddToday,
  onClearDay, onRequestDelete, onCalculateMacros, externalMacroStatus, onAddToCookbook,
}) {
  const handlers = {
    recipes, onOpenRecipe, onAddToMenu, onQuickAddToday, onRequestDelete,
    onCalculateMacros, externalMacroStatus, onAddToCookbook,
  };

  if (selectedDay) {
    const items = menu[selectedDay] || [];
    return (
      <div>
        <div className="cb-list-header-row">
          <span className="cb-list-count">{formatFullDate(selectedDay)}</span>
          {items.length ? (
            <button type="button" className="cb-clear-btn" onClick={() => onClearDay(selectedDay)}>Clear day</button>
          ) : null}
        </div>
        <DaySlots iso={selectedDay} items={items} handlers={handlers} />
      </div>
    );
  }

  return (
    <div className="cb-week">
      {weekDays.map((d) => {
        const iso = dateToISO(d);
        const items = menu[iso] || [];
        const isToday = iso === todayISO;
        return (
          <div key={iso} className={`cb-day-card ${isToday ? "today" : ""}`}>
            <div className="cb-day-card-head">
              <span className="cb-day-card-date">
                {formatFullDate(iso)}
                {isToday ? <span className="cb-day-card-today">Today</span> : null}
              </span>
              {items.length ? (
                <button type="button" className="cb-clear-btn" onClick={() => onClearDay(iso)}>Clear day</button>
              ) : null}
            </div>
            <div className="cb-day-card-body">
              <DaySlots iso={iso} items={items} handlers={handlers} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlanMacroSummary({ weekDays, selectedDay, menu, recipes }) {
  const scopeItems = selectedDay ? menu[selectedDay] || [] : weekDays.flatMap((d) => menu[dateToISO(d)] || []);

  const totals = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  let includedCount = 0;
  let pendingExternalCount = 0;

  scopeItems.forEach((item) => {
    if (item.kind === "library") {
      const r = recipes.find((rec) => rec.id === item.id);
      if (r && r.macros) {
        totals.kcal += r.macros.kcal;
        totals.protein += r.macros.protein;
        totals.fat += r.macros.fat;
        totals.carb += r.macros.carb;
        includedCount += 1;
      }
    } else if (item.kind === "external") {
      if (item.macros) {
        totals.kcal += item.macros.kcal;
        totals.protein += item.macros.protein;
        totals.fat += item.macros.fat;
        totals.carb += item.macros.carb;
        includedCount += 1;
      } else {
        pendingExternalCount += 1;
      }
    }
  });

  const subtitle = selectedDay
    ? formatFullDate(selectedDay)
    : `This week · ${formatShortMonthDay(weekDays[0])} – ${formatShortMonthDay(weekDays[6])}`;

  const pendingNote = pendingExternalCount > 0
    ? `${pendingExternalCount} planned meal${pendingExternalCount === 1 ? "" : "s"} not included — tap "Calculate macros" on its card to add it.`
    : null;

  return (
    <div className="cb-macro-summary-wrap">
      <div className="cb-macro-summary-head">Macro Summary</div>
      {includedCount === 0 ? (
        <PlanEmptyState
          title="No macro data yet"
          sub={pendingNote || "Plan some meals to see totals here."}
        />
      ) : (
        <div style={{ "--ink": "#2A2F38", "--accent": "#C99A3E" }}>
          <NutritionCard subtitle={subtitle} kcal={totals.kcal} protein={totals.protein} fat={totals.fat} carb={totals.carb} extra={pendingNote} />
        </div>
      )}
    </div>
  );
}

function AddToMenuModal({ item, weekDays, todayISO, isAlreadyOn, onConfirm, onClose }) {
  // { [iso]: mealKey[] } — each day can hold any combination of meal slots.
  const [picks, setPicks] = useState({});
  const toggleMeal = (iso, mealKey) =>
    setPicks((prev) => {
      const current = prev[iso] || [];
      const nextMeals = current.includes(mealKey)
        ? current.filter((m) => m !== mealKey)
        : [...current, mealKey];
      const next = { ...prev };
      if (nextMeals.length) next[iso] = nextMeals;
      else delete next[iso];
      return next;
    });
  const count = Object.values(picks).reduce((n, meals) => n + meals.length, 0);
  return (
    <div className="cb-modal-backdrop" onClick={onClose}>
      <div className="cb-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add to menu">
        <div className="cb-modal-head">
          <span className="cb-modal-title">Add to menu</span>
          <button className="cb-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="cb-modal-sub">{item.label} · pick any meals across the week</div>
        <div className="cb-modal-days">
          {weekDays.map((d) => {
            const iso = dateToISO(d);
            const isToday = iso === todayISO;
            const dayPicks = picks[iso] || [];
            return (
              <div key={iso} className={`cb-modal-day ${dayPicks.length ? "selected" : ""}`}>
                <span className="cb-modal-day-name">
                  {WEEKDAY_LABELS[d.getDay()]}
                  {isToday ? <span className="cb-today-dot" role="img" aria-label="Today" title="Today" /> : null}
                </span>
                <span className="cb-modal-day-date">{formatShortMonthDay(d)}</span>
                <div className="cb-day-meals" role="group" aria-label={`Meals for ${WEEKDAY_LABELS[d.getDay()]}`}>
                  {MEALS.map((m) => {
                    const already = isAlreadyOn(iso, m.key);
                    const isPicked = dayPicks.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        type="button"
                        className={`cb-day-meal cb-dm-${m.key} ${isPicked ? "picked" : ""} ${already ? "on-menu" : ""}`}
                        onClick={() => !already && toggleMeal(iso, m.key)}
                        disabled={already}
                        aria-pressed={isPicked}
                        aria-label={already ? `${m.label} already on menu` : m.label}
                        title={already ? `${m.label} already on menu` : m.label}
                      >
                        {already ? "✓" : m.label.charAt(0)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cb-modal-confirm-actions">
          <button type="button" className="cb-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="cb-modal-confirm"
            onClick={() => onConfirm(picks)}
            disabled={count === 0}
          >
            {count === 0 ? "Add to menu" : `Add ${count} meal${count !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="cb-modal-backdrop" onClick={onCancel}>
      <div className="cb-modal" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="cb-modal-head">
          <span className="cb-modal-title">{title}</span>
          <button className="cb-modal-close" type="button" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="cb-modal-message">{message}</div>
        <div className="cb-modal-confirm-actions">
          <button type="button" className="cb-modal-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="cb-modal-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function AddToCookbookModal({ draft, onApprove, onReject, onRetry }) {
  return (
    <div className="cb-modal-backdrop" onClick={onReject}>
      <div className="cb-modal cb-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add to cookbook">
        <div className="cb-modal-head">
          <span className="cb-modal-title">Add to cookbook</span>
          <button className="cb-modal-close" type="button" onClick={onReject} aria-label="Close">×</button>
        </div>

        {draft.status === "loading" ? (
          <div className="cb-modal-loading">Writing an original recipe inspired by "{draft.source.title}"…</div>
        ) : draft.status === "error" ? (
          <div>
            <div className="cb-modal-message">{draft.error}</div>
            <div className="cb-modal-confirm-actions">
              <button type="button" className="cb-modal-cancel" onClick={onReject}>Cancel</button>
              <button type="button" className="cb-modal-confirm" onClick={onRetry}>Try again</button>
            </div>
          </div>
        ) : (
          <>
            <div className="cb-modal-sub" style={{ marginBottom: 14 }}>
              An original recipe inspired by "{draft.source.title}" from {draft.source.source || "the web"} — not a copy of the source.
            </div>
            <div className="cb-preview-title">{draft.data.title}</div>
            <div className="cb-preview-blurb">{draft.data.blurb}</div>
            <MacroBar protein={draft.data.macros.protein} fat={draft.data.macros.fat} carb={draft.data.macros.carb} compact />
            <div className="cb-preview-kcal">{Math.round(draft.data.macros.kcal)} kcal per serving</div>
            <div className="cb-preview-section-label">Ingredients</div>
            <div className="cb-preview-list">
              {draft.data.ingredients.map((ing, i) => (
                <div key={i} className="cb-preview-ing"><span>{ing.amt}</span> {ing.name}</div>
              ))}
            </div>
            <div className="cb-preview-section-label">Steps</div>
            <ol className="cb-preview-steps">
              {draft.data.steps.map((s, i) => (
                <li key={i}>{s.title ? <strong>{s.title}. </strong> : null}{s.body}</li>
              ))}
            </ol>
            <div className="cb-modal-confirm-actions">
              <button type="button" className="cb-modal-cancel" onClick={onReject}>Reject</button>
              <button type="button" className="cb-modal-confirm" onClick={onApprove}>Add to cookbook</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   ROOT APP
   ========================================================================= */
const COMPOSER_TABS = [
  { key: "eat", label: "Eat", placeholder: "Describe the recipe you want — ingredients you have, a cuisine, a mood…" },
  { key: "plan", label: "Plan", placeholder: "Tell me what you're planning for the week — meals, servings, dietary needs…" },
  { key: "log", label: "Log", placeholder: "Tell me what you made or ate, and how it went…" },
];

const PROMPT_STARTERS = ["What's the macro profile?", "Summarize the dish", "Let's make this"];
const PLAN_PROMPT_STARTERS = ["Plan this week", "Complete my week"];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Meal slots each day is divided into. `dinner` is the default when an item has no
// explicit slot (quick-add lands here, and it matches the app's dinner-centric picks).
const MEALS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "snack", label: "Snack" },
  { key: "dinner", label: "Dinner" },
];
const DEFAULT_MEAL = "dinner";

function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getCurrentWeekDays() {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });
}
function formatShortMonthDay(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatFullDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default function Cookbook() {
  const { user, signOut } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("eat");
  const [prompts, setPrompts] = useState({ eat: "", plan: "", log: "" });
  const [showPromptStarters, setShowPromptStarters] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [menu, setMenu] = useState({}); // { "YYYY-MM-DD": [{ kind: "library", id } | { kind: "external", data }] }
  const [pendingMenuItem, setPendingMenuItem] = useState(null); // item awaiting a day pick in the modal
  const [confirmAction, setConfirmAction] = useState(null); // { type: "clear-day" | "clear-week", iso?, label }
  const [undoState, setUndoState] = useState(null); // { iso, item, timeoutId }
  const [externalMacroStatus, setExternalMacroStatus] = useState({}); // { [urlOrTitle]: { status, error? } }
  const [customRecipes, setCustomRecipes] = useState([]); // recipes generated via "Add to cookbook"
  const [cookbookDraft, setCookbookDraft] = useState(null); // { status, source, data?, error? } awaiting approval

  const allRecipes = useMemo(() => [...RECIPES, ...customRecipes], [customRecipes]);

  const weekDays = useMemo(() => getCurrentWeekDays(), []);
  const todayISO = useMemo(() => dateToISO(new Date()), []);

  // Attaches the React detail-view Component to a DB-loaded custom recipe.
  const hydrateRecipe = (r) => {
    const rec = { ...r };
    rec.Component = () => <GeneratedRecipeComponent recipe={rec} />;
    return rec;
  };

  // Load the signed-in user's recipes + weekly menu from Supabase on mount / user change.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const [recipes, loadedMenu] = await Promise.all([fetchRecipes(user.id), fetchMenu(user.id)]);
        if (!active) return;
        setCustomRecipes(recipes.map(hydrateRecipe));
        setMenu(loadedMenu);
      } catch (e) {
        console.error("Failed to load your data:", e);
      }
    })();
    return () => { active = false; };
  }, [user?.id]);

  // Two menu items match only within the same meal slot, so the same recipe can sit in,
  // say, both breakfast and dinner on one day without one delete removing both.
  const itemsMatch = (a, b) => {
    if ((a.meal || DEFAULT_MEAL) !== (b.meal || DEFAULT_MEAL)) return false;
    return a.kind === "library" && b.kind === "library"
      ? a.id === b.id
      : a.kind === "external" && b.kind === "external"
      ? a.data.url ? a.data.url === b.data.url : a.data.title === b.data.title
      : false;
  };

  // Persists new entries, then adds the returned rows (with real ids) to state.
  // Dedupes against the current menu so the same recipe+meal+day isn't added twice.
  const addEntries = async (entries) => {
    if (!user) return;
    const fresh = entries.filter(({ iso, item }) => !(menu[iso] || []).some((e) => itemsMatch(e, item)));
    if (!fresh.length) return;
    try {
      const rows = await insertMenuEntries(user.id, fresh);
      setMenu((prev) => {
        const next = { ...prev };
        rows.forEach((row) => {
          next[row.day] = [...(next[row.day] || []), menuRowToItem(row)];
        });
        return next;
      });
    } catch (e) {
      console.error("Failed to add to menu:", e);
    }
  };

  const openAddToMenuModal = (item) => setPendingMenuItem(item);
  const closeAddToMenuModal = () => setPendingMenuItem(null);
  const handleAddToDays = (picks) => {
    if (pendingMenuItem) {
      const entries = [];
      Object.entries(picks).forEach(([iso, meals]) =>
        meals.forEach((meal) => entries.push({ iso, item: { ...pendingMenuItem, meal } }))
      );
      addEntries(entries);
    }
    closeAddToMenuModal();
  };
  const quickAddToday = (item) => addEntries([{ iso: todayISO, item: { ...item, meal: DEFAULT_MEAL } }]);

  const dismissUndo = () => {
    setUndoState((prev) => {
      if (prev) clearTimeout(prev.timeoutId);
      return null;
    });
  };
  const requestDeleteFromMenu = (iso, item) => {
    dismissUndo();
    setMenu((prev) => {
      const existing = prev[iso] || [];
      return { ...prev, [iso]: existing.filter((e) => e.entryId !== item.entryId) };
    });
    if (item.entryId) deleteMenuEntries([item.entryId]).catch((e) => console.error("Failed to delete entry:", e));
    const timeoutId = setTimeout(() => setUndoState(null), 10000);
    setUndoState({ iso, item, timeoutId });
  };
  const undoDelete = () => {
    if (!undoState) return;
    clearTimeout(undoState.timeoutId);
    const { entryId, ...item } = undoState.item; // drop the stale id; a fresh row is created
    addEntries([{ iso: undoState.iso, item }]);
    setUndoState(null);
  };
  // The undo window closes early if the user switches tabs or opens a recipe.
  useEffect(() => { dismissUndo(); }, [activeTab, activeId]);

  const requestClearDay = (iso) => setConfirmAction({ type: "clear-day", iso, label: formatFullDate(iso) });
  const requestClearWeek = () =>
    setConfirmAction({ type: "clear-week", label: `${formatShortMonthDay(weekDays[0])} – ${formatShortMonthDay(weekDays[6])}` });
  const runConfirmedClear = () => {
    if (!confirmAction) return;
    const isos = confirmAction.type === "clear-day"
      ? [confirmAction.iso]
      : weekDays.map((d) => dateToISO(d));
    const ids = [];
    isos.forEach((iso) => (menu[iso] || []).forEach((e) => e.entryId && ids.push(e.entryId)));
    setMenu((prev) => {
      const next = { ...prev };
      isos.forEach((iso) => delete next[iso]);
      return next;
    });
    if (ids.length) deleteMenuEntries(ids).catch((e) => console.error("Failed to clear entries:", e));
    setConfirmAction(null);
  };

  const proteinOptions = useMemo(() => {
    const set = new Set();
    allRecipes.forEach((r) => (r.protein || []).forEach((p) => set.add(p)));
    return Array.from(set).sort();
  }, [allRecipes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRecipes.filter((r) => {
      const matchesQuery =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.blurb.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q));
      let matchesFilter = true;
      if (filter === "vegetarian") matchesFilter = r.diet === "vegetarian" || r.diet === "vegan";
      else if (filter === "vegan") matchesFilter = r.diet === "vegan";
      else if (filter !== "all") matchesFilter = (r.protein || []).includes(filter);
      return matchesQuery && matchesFilter;
    });
  }, [query, filter, allRecipes]);

  const isFiltered = query.trim() !== "" || filter !== "all";
  const listHeader = isFiltered
    ? `${filtered.length} matching recipe${filtered.length !== 1 ? "s" : ""}`
    : `${allRecipes.length} recipe${allRecipes.length !== 1 ? "s" : ""} and counting`;

  const lastAddedLabel = useMemo(() => {
    const latest = allRecipes.reduce((max, r) => (r.dateAdded > max ? r.dateAdded : max), allRecipes[0].dateAdded);
    const d = new Date(`${latest}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }, [allRecipes]);

  const activeIndex = allRecipes.findIndex((r) => r.id === activeId);
  const active = activeIndex >= 0 ? allRecipes[activeIndex] : null;
  const goPrev = () => setActiveId(allRecipes[(activeIndex - 1 + allRecipes.length) % allRecipes.length].id);
  const goNext = () => setActiveId(allRecipes[(activeIndex + 1) % allRecipes.length].id);

  const activeTabConfig = COMPOSER_TABS.find((t) => t.key === activeTab);

  /* ---- "Today's Picks" carousel: calls Claude (with web search) from inside the artifact ---- */
  const [dailyRecipes, setDailyRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState(null);
  const [imgFailed, setImgFailed] = useState({});

  const todayStr = () => new Date().toISOString().slice(0, 10);

  const SEARCH_PROMPT =
    "Search the web for 5 dinner recipes from reputable cooking websites (for example NYT Cooking, Serious Eats, Bon Appétit, Food52, Epicurious, America's Test Kitchen / Cook's Illustrated, AllRecipes, Smitten Kitchen, Budget Bytes, King Arthur Baking, The Kitchn) that are well-suited for someone trying to build lean muscle — genuinely high in protein per serving (roughly 30g or more), built around a whole-food protein source (chicken, beef, pork, fish, shrimp, tofu, or legumes), and NOT a dessert, side dish, snack, or beverage. Do not use TikTok or YouTube as the source platform — a recipe page that happens to embed a video is fine, but the source itself must be a proper recipe/article page. Choose a varied mix of proteins and cuisines rather than 5 similar dishes. Respond with ONLY a JSON array (no markdown, no code fences, no commentary before or after) of exactly 5 objects shaped exactly like this: {\"title\": \"recipe name\", \"source\": \"site name\", \"url\": \"direct link to the recipe page\", \"teaser\": \"one sentence under 20 words describing the dish, in your own words\", \"imageUrl\": \"a direct image URL if you can find one with confidence, otherwise an empty string\"}";

  const MEMORY_PROMPT =
    "Live web search isn't available right now. From your own knowledge, name 5 dinner recipes commonly found on reputable cooking websites (for example NYT Cooking, Serious Eats, Bon Appétit, Food52, Epicurious, America's Test Kitchen / Cook's Illustrated, AllRecipes, Smitten Kitchen, Budget Bytes, King Arthur Baking, The Kitchn) that are well-suited for someone trying to build lean muscle — genuinely high in protein per serving (roughly 30g or more), built around a whole-food protein source (chicken, beef, pork, fish, shrimp, tofu, or legumes), and NOT a dessert, side dish, snack, or beverage. Choose a varied mix of proteins and cuisines. Only include a url if you're genuinely confident it's correct — otherwise leave it as an empty string rather than guessing, since a wrong link is worse than no link. Respond with ONLY a JSON array (no markdown, no code fences, no commentary before or after) of exactly 5 objects shaped exactly like this: {\"title\": \"recipe name\", \"source\": \"site name\", \"url\": \"direct link if you're confident, otherwise empty string\", \"teaser\": \"one sentence under 20 words describing the dish, in your own words\", \"imageUrl\": \"\"}";

  // NOTE: this fetch relies on claude.ai's artifact sandbox, which proxies requests to
  // api.anthropic.com without needing an API key. Outside claude.ai (like here), this call
  // will fail — that's expected until it's pointed at your own backend/serverless proxy that
  // holds a real Anthropic API key and forwards the request (never call the real API directly
  // from browser JS with an embedded key). Everything that calls this already fails gracefully:
  // "Today's Picks" falls back to SAVED_POOL, and "Calculate macros"/"Add to cookbook" show
  // their existing error UI with a retry button — nothing crashes, it just won't generate
  // live results until a proxy is wired up.
  async function callClaude(prompt, useSearch, shape = "array", maxTokens) {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens || (shape === "object" ? 400 : 1500),
      messages: [{ role: "user", content: prompt }],
    };
    if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.type === "error") {
      const msg = (data && data.error && data.error.message) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    const textBlocks = (data.content || []).filter((b) => b.type === "text");
    const last = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
    let cleaned = last.replace(/```json|```/g, "").trim();
    if (shape === "object") {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
      const parsed = JSON.parse(cleaned);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Unexpected response shape");
      return parsed;
    }
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) cleaned = match[0];
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("Unexpected response shape");
    return parsed.slice(0, 5);
  }

  const buildMacroPrompt = (data) =>
    `Estimate the typical nutrition for a single serving of this dish: "${data.title}"${data.source ? ` from ${data.source}` : ""}.${data.teaser ? ` Description: ${data.teaser}` : ""}${data.url ? ` Recipe link: ${data.url}.` : ""} Give your best realistic estimate. Respond with ONLY a JSON object (no markdown, no commentary before or after) shaped exactly like this: {"kcal": number, "protein": number, "fat": number, "carb": number}`;

  const calculateExternalMacros = async (data) => {
    const key = data.url || data.title;
    setExternalMacroStatus((s) => ({ ...s, [key]: { status: "loading" } }));
    try {
      let macros;
      try {
        macros = await callClaude(buildMacroPrompt(data), true, "object");
      } catch (searchErr) {
        console.warn("Macro search call failed, falling back to knowledge-only:", searchErr);
        macros = await callClaude(buildMacroPrompt(data), false, "object");
      }
      if (typeof macros.kcal !== "number") throw new Error("Unexpected response shape");
      const ids = [];
      setMenu((prev) => {
        const next = {};
        Object.entries(prev).forEach(([iso, items]) => {
          next[iso] = items.map((it) => {
            if (it.kind === "external" && (it.data.url || it.data.title) === key) {
              if (it.entryId) ids.push(it.entryId);
              return { ...it, macros };
            }
            return it;
          });
        });
        return next;
      });
      setEntriesMacros(ids, macros).catch((err) => console.error("Failed to save macros:", err));
      setExternalMacroStatus((s) => ({ ...s, [key]: { status: "done" } }));
    } catch (e) {
      setExternalMacroStatus((s) => ({ ...s, [key]: { status: "error", error: (e && e.message) || "Couldn't calculate macros." } }));
    }
  };

  const buildRecipeGenPrompt = (data) =>
    `Create an original, simple home-cook recipe inspired by the general idea of this dish: "${data.title}"${data.source ? ` (a dish commonly found on sites like ${data.source})` : ""}.${data.teaser ? ` General description: ${data.teaser}.` : ""} Do not copy any specific published recipe — write your own original ingredient list, amounts, and instructions from scratch, in your own words, appropriate for a home cook. Keep it realistic and delicious, and write it for about 4 servings unless the dish is naturally single-serving. Respond with ONLY a JSON object (no markdown, no commentary before or after) shaped exactly like this: {"title": "recipe name", "blurb": "one sentence description, under 25 words", "kicker": "short 2-4 word category label", "tags": ["short tag", "short tag", "short tag"], "time": "approximate total time, e.g. '35 min'", "servings": number, "protein": ["chicken"], "diet": "meat", "macros": {"kcal": number, "protein": number, "fat": number, "carb": number}, "ingredients": [{"amt": "1 cup", "name": "ingredient name"}], "steps": [{"title": "short step title", "body": "full instruction sentence(s)"}]}. "servings" is how many servings the ingredient amounts above are written for, and "macros" is per single serving. The "protein" field should be an array like ["chicken"], ["beef"], ["pork"], ["tofu"], or [] if there's no single primary protein. The "diet" field must be exactly one of "meat", "vegetarian", or "vegan".`;

  const generateCookbookDraft = async (data, existingMacros) => {
    setCookbookDraft({ status: "loading", source: data });
    try {
      let parsed;
      try {
        parsed = await callClaude(buildRecipeGenPrompt(data), true, "object", 3000);
      } catch (searchErr) {
        console.warn("Recipe generation search call failed, falling back to knowledge-only:", searchErr);
        parsed = await callClaude(buildRecipeGenPrompt(data), false, "object", 3000);
      }
      if (!parsed.title || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.steps)) {
        throw new Error("Unexpected response shape");
      }
      const macros = existingMacros || parsed.macros || { kcal: 0, protein: 0, fat: 0, carb: 0 };
      setCookbookDraft({ status: "ready", source: data, data: { ...parsed, macros } });
    } catch (e) {
      setCookbookDraft({ status: "error", source: data, error: (e && e.message) || "Couldn't generate a recipe." });
    }
  };

  const openAddToCookbook = (data, existingMacros) => generateCookbookDraft(data, existingMacros);
  const retryCookbookDraft = () => {
    if (cookbookDraft) generateCookbookDraft(cookbookDraft.source);
  };
  const rejectCookbookDraft = () => setCookbookDraft(null);
  const approveCookbookDraft = async () => {
    if (!cookbookDraft || cookbookDraft.status !== "ready" || !user) return;
    const draft = cookbookDraft.data;
    const source = cookbookDraft.source;
    const theme = GENERATED_THEMES[customRecipes.length % GENERATED_THEMES.length];
    const recipeInput = {
      title: draft.title,
      blurb: draft.blurb,
      kicker: draft.kicker || "From the Web",
      tags: draft.tags || [],
      time: draft.time || "—",
      servings: draft.servings || 4,
      protein: draft.protein || [],
      diet: draft.diet || "meat",
      macros: draft.macros,
      ingredients: draft.ingredients,
      steps: draft.steps,
      sourceUrl: source.url,
      sourceName: source.source,
      theme,
    };

    try {
      const saved = await insertRecipe(user.id, recipeInput); // real UUID id assigned by the DB
      setCustomRecipes((prev) => [...prev, hydrateRecipe(saved)]);

      // Any planned copies of the external source become library entries pointing at the saved recipe.
      const extKey = source.url || source.title;
      const ids = [];
      setMenu((prev) => {
        const next = {};
        Object.entries(prev).forEach(([iso, items]) => {
          next[iso] = items.map((it) => {
            if (it.kind === "external" && (it.data.url || it.data.title) === extKey) {
              if (it.entryId) ids.push(it.entryId);
              return { entryId: it.entryId, kind: "library", id: saved.id, label: saved.title, meal: it.meal };
            }
            return it;
          });
        });
        return next;
      });
      if (ids.length) await convertEntriesToLibrary(ids, saved.id, saved.title);

      setCookbookDraft(null);
    } catch (e) {
      console.error("Failed to save recipe:", e);
      setCookbookDraft((prev) =>
        prev ? { ...prev, status: "error", error: "Couldn't save the recipe. Try again." } : prev
      );
    }
  };

  const SAVED_POOL = [
    { title: "Chicken Stew", source: "Budget Bytes", url: "https://www.budgetbytes.com/chicken-stew/", teaser: "A hearty stew of browned chicken thighs, potatoes, and vegetables in a thickened herb gravy — about 30g protein a serving.", imageUrl: "" },
    { title: "Reverse-Seared Steak", source: "Serious Eats", url: "https://www.seriouseats.com/reverse-seared-steak-recipe", teaser: "A thick-cut steak gently brought to temperature low and slow, then seared hard for an edge-to-edge perfect crust.", imageUrl: "" },
    { title: "Miso-Marinated Salmon", source: "America's Test Kitchen", url: "https://www.americastestkitchen.com/recipes/8572-miso-marinated-salmon", teaser: "Salmon cured briefly in a miso-sake marinade, then broiled for a lacquered, deeply savory crust.", imageUrl: "" },
    { title: "Turkey Meatballs", source: "Budget Bytes", url: "https://www.budgetbytes.com/turkey-meatballs/", teaser: "Lean, parmesan-flecked turkey meatballs — about 31g protein for four, at a fraction of the calories of beef.", imageUrl: "" },
    { title: "Juiciest Pork Tenderloin", source: "Epicurious", url: "https://www.epicurious.com/recipes/food/views/pork-tenderloin-honey-mustard", teaser: "A lean, quick-roasting cut glazed in honey and Dijon mustard for a tangy, caramelized crust.", imageUrl: "" },
    { title: "Easy Tofu Stir-Fry", source: "The Kitchn", url: "https://www.thekitchn.com/how-to-stir-fry-tofu-226734", teaser: "Extra-firm tofu seared hard in a hot wok for golden, charred edges — a solid plant-based protein base.", imageUrl: "" },
    { title: "One Pot Lemon Garlic Shrimp and Rice", source: "Budget Bytes", url: "https://www.budgetbytes.com/one-pot-lemon-garlic-shrimp-and-rice/", teaser: "Shrimp steamed right on top of garlicky, lemon-brightened rice — lean protein plus real training fuel.", imageUrl: "" },
    { title: "One Pot Chicken and Rice", source: "Budget Bytes", url: "https://www.budgetbytes.com/one-pot-chicken-and-rice/", teaser: "Seasoned chicken thighs simmered into a full pot of rice — about 31g protein per serving, all in one pan.", imageUrl: "" },
    { title: "Crispy Chicken With Lime Butter", source: "NYT Cooking", url: "https://nyti.ms/4iZKa42", teaser: "Skin-on chicken thighs crisped hard, finished with a bright, tangy lime-butter pan sauce.", imageUrl: "" },
    { title: "Miso Chicken and Rice", source: "Smitten Kitchen", url: "https://smittenkitchen.com/2026/02/miso-chicken-and-rice/", teaser: "A one-pot rice-cooker dinner of miso-marinated chicken thighs and shiitakes, easy enough for any weeknight.", imageUrl: "" },
    { title: "Red Lentil Dhal", source: "Food52", url: "https://food52.com/recipes/73712-red-lentil-dhal", teaser: "A fast, spiced red lentil stew — a plant-based dinner with real protein and fiber in every bowl.", imageUrl: "" },
    { title: "Chicken Piccata", source: "Serious Eats", url: "https://www.seriouseats.com/chicken-piccata-italian-fried-cutlet-recipe", teaser: "Pounded chicken cutlets, pan-fried and finished in a lemon-caper butter sauce — around 63g protein a serving.", imageUrl: "" },
    { title: "Spicy Coconut Grilled Chicken Thighs", source: "Bon Appétit", url: "https://www.bonappetit.com/recipe/spicy-coconut-grilled-chicken-thighs", teaser: "Boneless chicken thighs marinated in coconut milk, chile paste, and lime, then charred on the grill.", imageUrl: "" },
    { title: "Beef and Ginger Stir-Fry", source: "Bon Appétit", url: "https://www.bonappetit.com/recipe/beef-and-ginger-stir-fry", teaser: "Thin-sliced skirt steak stir-fried hard and fast with ginger and onion in a simple soy-butter glaze.", imageUrl: "" },
  ];

  function pickRandom(arr, n) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  async function fetchDailyRecipes() {
    try {
      const recipes = await callClaude(SEARCH_PROMPT, true);
      return recipes.map((r) => ({ ...r, badge: null }));
    } catch (searchErr) {
      console.warn("Web search call failed, falling back to knowledge-only:", searchErr);
      try {
        const recipes = await callClaude(MEMORY_PROMPT, false);
        return recipes.map((r) => ({ ...r, badge: "from memory" }));
      } catch (memoryErr) {
        console.warn("Knowledge-only call also failed, falling back to saved picks:", memoryErr);
        return pickRandom(SAVED_POOL, 5).map((r) => ({ ...r, badge: "saved pick" }));
      }
    }
  }

  const loadDailyRecipes = async (force) => {
    if (!force) {
      const cached = await loadPrefs("cookbook:eat:daily-picks");
      if (cached && cached.date === todayStr() && Array.isArray(cached.recipes) && cached.recipes.length) {
        setDailyRecipes(cached.recipes);
        return;
      }
    }
    setRecipesLoading(true);
    setRecipesError(null);
    try {
      const recipes = await fetchDailyRecipes();
      setDailyRecipes(recipes);
      setImgFailed({});
      await savePrefs("cookbook:eat:daily-picks", { date: todayStr(), recipes });
    } catch (e) {
      setRecipesError(`Couldn't load today's picks — ${e && e.message ? e.message : "unknown error"}.`);
    } finally {
      setRecipesLoading(false);
    }
  };

  useEffect(() => { loadDailyRecipes(false); }, []);

  const addRecipeToPrompt = (r) => {
    setPrompts((p) => {
      const line = r.url ? `${r.title} — ${r.url}` : r.title;
      const existing = p.eat.trim();
      return { ...p, eat: existing ? `${existing}\n${line}` : line };
    });
    setShowPromptStarters(true);
  };

  const insertPromptStarter = (text) => {
    setPrompts((p) => {
      const existing = p[activeTab].trim();
      return { ...p, [activeTab]: existing ? `${existing}\n${text}` : text };
    });
  };

  const submitPrompt = (tab) => {
    const text = prompts[tab];
    if (!text.trim()) return;
    // TODO: wire this up once we define what happens on submit, per tab.
    console.log(`[${tab}] prompt submitted:`, text);
  };
  const handlePromptKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt(activeTab);
    }
  };
  const autoGrow = (e) => {
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  };

  return (
    <div className="cookbook-root">
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }

        /* ---------- shell (index) ---------- */
        .cb-shell { background: #20242B; min-height: 100vh; padding: 32px clamp(20px, 5vw, 64px) 64px; }
        .cb-wrap { max-width: 2000px; margin: 0 auto; }
        .cb-layout { display: block; }
        .cb-left { margin-bottom: 28px; }
        .cb-userbar {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px;
        }
        .cb-userbar-email {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #A9A48F;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .cb-signout {
          flex: 0 0 auto; background: none; border: 1px solid #3A3F4A; border-radius: 999px;
          padding: 5px 12px; cursor: pointer; color: #A9A48F;
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
        }
        .cb-signout:hover { border-color: #C99A3E; color: #F4EFE4; }
        .cb-eyebrow {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
          letter-spacing: 0.12em; text-transform: uppercase; color: #C99A3E; margin-bottom: 8px;
        }
        .cb-title {
          font-family: 'Libre Caslon Display', serif; color: #F4EFE4; font-size: 40px;
          margin: 0 0 6px; line-height: 1;
        }
        .cb-tabbar { display: flex; gap: 4px; background: #2A2F38; border-radius: 10px; padding: 4px; margin: 18px 0 14px; }
        .cb-tab {
          flex: 1; background: none; border: none; padding: 9px 0; border-radius: 7px;
          font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
          text-transform: uppercase; color: #A9A48F; cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
        }
        .cb-tab:hover:not(.active) { color: #F4EFE4; }
        .cb-tab.active { background: #C99A3E; color: #20242B; }
        .cb-prompt-block { margin-top: 0; }
        .cb-prompt-starters { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
        .cb-prompt-starter {
          background: #20242B; border: 1px solid #3A3F4A; color: #D8D2BE; font-family: 'Work Sans', sans-serif;
          font-size: 12px; padding: 6px 11px; border-radius: 999px; cursor: pointer;
        }
        .cb-prompt-starter:hover:not(:disabled) { background: #343A45; border-color: #C99A3E; color: #F4EFE4; }
        .cb-prompt-starter:disabled { opacity: 0.35; cursor: not-allowed; }
        .cb-carousel-wrap { margin: 4px 0 18px; }
        .cb-week-wrap { margin: 4px 0 18px; }
        .cb-macro-summary-wrap { margin: 0 0 18px; }
        .cb-macro-summary-head {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: #C99A3E; margin-bottom: 10px;
        }
        .cb-card-error { font-family: 'Work Sans', sans-serif; font-size: 11px; color: #C0453A; }
        .cb-week-range { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #A9A48F; }
        .cb-week-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
        .cb-week-day {
          position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
          background: #2A2F38; border: 1px solid #3A3F4A; border-radius: 10px; padding: 8px 2px 10px;
          color: #F4EFE4; cursor: pointer; font-family: 'Work Sans', sans-serif;
        }
        .cb-week-day:hover { background: #343A45; }
        .cb-week-day.today { border-color: #C99A3E; }
        .cb-week-day.selected { background: #C99A3E; border-color: #C99A3E; }
        .cb-week-day.selected .cb-week-day-label, .cb-week-day.selected .cb-week-day-num { color: #20242B; }
        .cb-week-day-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #A9A48F; }
        .cb-week-day.selected .cb-week-day-label { color: rgba(32,36,43,0.7); }
        .cb-week-day-num { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; }
        .cb-week-day-dot { position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: #C99A3E; }
        .cb-week-day.selected .cb-week-day-dot { background: #20242B; }
        .cb-week { display: flex; flex-direction: column; gap: 18px; }
        .cb-day-card { background: #23282F; border: 1px solid #333A45; border-radius: 16px; }
        .cb-day-card.today { border-color: #C99A3E; box-shadow: 0 0 0 1px rgba(201,154,62,0.25); }
        .cb-day-card-head {
          position: sticky; top: 0; z-index: 5;
          display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
          background: #23282F; border-bottom: 1px solid #333A45; border-radius: 16px 16px 0 0;
          padding: 13px 18px;
        }
        .cb-day-card.today .cb-day-card-head { border-bottom-color: rgba(201,154,62,0.35); }
        .cb-day-card-date {
          font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase; color: #F4EFE4;
        }
        .cb-day-card.today .cb-day-card-date { color: #C99A3E; }
        .cb-day-card-today {
          margin-left: 10px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
          letter-spacing: 0.1em; background: #C99A3E; color: #20242B; padding: 2px 8px; border-radius: 999px;
        }
        .cb-day-card-body { padding: 0 18px 16px; }
        .cb-slots { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }
        .cb-slot { display: flex; flex-direction: column; gap: 8px; }
        .cb-slot-label {
          align-self: flex-start; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px;
          color: #20242B; background: #C99A3E;
        }
        .cb-slot-breakfast { background: #6E9BC4; }
        .cb-slot-lunch { background: #8FB15C; }
        .cb-slot-snack { background: #A784C4; }
        .cb-slot-dinner { background: #C99A3E; }
        .cb-slot-empty {
          display: flex; align-items: center; gap: 10px; padding: 9px 13px;
          border: 1px dashed #3A4049; border-radius: 10px; background: rgba(32,36,43,0.4);
        }
        .cb-slot-empty-mark {
          flex: 0 0 auto; width: 15px; height: 15px; border-radius: 5px;
          border: 1px dashed #454B55; background: rgba(244,239,228,0.03);
        }
        .cb-slot-empty-text { font-family: 'Work Sans', sans-serif; font-size: 12px; color: #6E6B60; }
        .cb-plan-empty { padding: 12px 2px 28px; max-width: 480px; }
        .cb-plan-empty-title { font-family: 'Libre Caslon Display', serif; font-size: 17px; color: #F4EFE4; margin-bottom: 8px; }
        .cb-plan-empty-sub { font-family: 'Work Sans', sans-serif; font-size: 13px; color: #A9A48F; line-height: 1.55; }
        .cb-card-external { cursor: default; }
        .cb-card-external .cb-card-num { color: #8A8267; }

        .cb-modal-backdrop {
          position: fixed; inset: 0; background: rgba(10,11,14,0.65); display: flex; align-items: center;
          justify-content: center; padding: 20px; z-index: 100;
        }
        .cb-modal {
          background: #2A2F38; border: 1px solid #3A3F4A; border-radius: 16px; padding: 20px;
          width: 100%; max-width: 340px; max-height: 80vh; overflow-y: auto;
        }
        .cb-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .cb-modal-title { font-family: 'Libre Caslon Display', serif; font-size: 18px; color: #F4EFE4; }
        .cb-modal-close {
          background: none; border: none; color: #A9A48F; font-size: 20px; line-height: 1; cursor: pointer; padding: 4px;
        }
        .cb-modal-close:hover { color: #F4EFE4; }
        .cb-modal-sub {
          font-family: 'Work Sans', sans-serif; font-size: 13px; color: #A9A48F; margin-bottom: 16px;
          padding-bottom: 12px; border-bottom: 1px solid rgba(244,239,228,0.12);
        }
        .cb-modal-days { display: flex; flex-direction: column; gap: 6px; }
        .cb-modal-day {
          display: flex; align-items: center; justify-content: flex-start; gap: 10px; background: #20242B;
          border: 1px solid #3A3F4A; border-radius: 10px; padding: 8px 12px;
          color: #F4EFE4; font-family: 'Work Sans', sans-serif; font-size: 14px;
          transition: border-color 0.12s, background 0.12s;
        }
        .cb-modal-day.selected { border-color: #C99A3E; background: #2A2E36; }
        .cb-day-meals {
          display: inline-flex; flex: 0 0 auto; margin-left: auto; border: 1px solid #3A3F4A; border-radius: 8px;
          overflow: hidden; background: #191C22;
        }
        .cb-day-meal {
          width: 30px; padding: 6px 0; border: none; border-right: 1px solid #3A3F4A; background: transparent;
          cursor: pointer; color: #A9A48F; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600;
          transition: background 0.12s, color 0.12s;
        }
        .cb-day-meal:last-child { border-right: none; }
        .cb-day-meal:hover:not(:disabled) { background: #343A45; color: #F4EFE4; }
        .cb-day-meal.picked { color: #20242B; }
        .cb-day-meal.picked.cb-dm-breakfast { background: #6E9BC4; }
        .cb-day-meal.picked.cb-dm-lunch { background: #8FB15C; }
        .cb-day-meal.picked.cb-dm-snack { background: #A784C4; }
        .cb-day-meal.picked.cb-dm-dinner { background: #C99A3E; }
        .cb-day-meal.on-menu { color: #6B7280; background: rgba(107,114,128,0.12); cursor: default; }
        .cb-modal-day-name {
          flex: 0 0 auto; width: 46px; font-weight: 600;
          display: inline-flex; align-items: center;
        }
        .cb-today-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #C99A3E;
          margin-left: 6px; flex: 0 0 auto;
        }
        .cb-modal-day-date { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #A9A48F; flex: 0 0 auto; }
        .cb-modal-confirm:disabled { opacity: 0.4; cursor: default; }
        .cb-modal-confirm:disabled:hover { background: #C99A3E; }
        .cb-modal-days + .cb-modal-confirm-actions { margin-top: 16px; }

        .cb-clear-btn {
          background: none; border: none; color: #D9736A; font-family: 'JetBrains Mono', monospace;
          font-size: 11px; font-weight: 600; cursor: pointer; padding: 4px 0; flex: 0 0 auto; white-space: nowrap;
        }
        .cb-clear-btn:hover { color: #E8938C; text-decoration: underline; }

        .cb-modal-message { font-family: 'Work Sans', sans-serif; font-size: 14px; color: #D8D2BE; line-height: 1.5; margin: 14px 0 20px; }
        .cb-modal-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
        .cb-modal-cancel {
          background: none; border: 1px solid #3A3F4A; color: #F4EFE4; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; font-weight: 600; padding: 9px 16px; border-radius: 999px; cursor: pointer;
        }
        .cb-modal-cancel:hover { background: #343A45; }
        .cb-modal-danger {
          background: #C0453A; border: none; color: #F4EFE4; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; font-weight: 700; padding: 9px 16px; border-radius: 999px; cursor: pointer;
        }
        .cb-modal-danger:hover { background: #D3554A; }
        .cb-modal-confirm {
          background: #C99A3E; border: none; color: #20242B; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; font-weight: 700; padding: 9px 16px; border-radius: 999px; cursor: pointer;
        }
        .cb-modal-confirm:hover { background: #DCAE55; }
        .cb-modal-wide { max-width: 420px; }
        .cb-modal-loading { font-family: 'Work Sans', sans-serif; font-size: 14px; color: #A9A48F; padding: 20px 0; text-align: center; }
        .cb-preview-title { font-family: 'Libre Caslon Display', serif; font-size: 20px; color: #F4EFE4; margin-bottom: 4px; }
        .cb-preview-blurb { font-family: 'Work Sans', sans-serif; font-size: 13px; color: #D8D2BE; line-height: 1.5; margin-bottom: 10px; }
        .cb-preview-kcal { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #A9A48F; margin-bottom: 16px; }
        .cb-preview-section-label {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: #C99A3E; margin: 14px 0 8px;
        }
        .cb-preview-list { display: flex; flex-direction: column; gap: 6px; }
        .cb-preview-ing { font-family: 'Work Sans', sans-serif; font-size: 13px; color: #F4EFE4; }
        .cb-preview-ing span { font-family: 'JetBrains Mono', monospace; font-weight: 600; margin-right: 8px; color: #D8D2BE; }
        .cb-preview-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
        .cb-preview-steps li { font-family: 'Work Sans', sans-serif; font-size: 13px; color: #F4EFE4; line-height: 1.5; }
        .cb-preview-steps li strong { color: #F4EFE4; font-family: 'Libre Caslon Display', serif; font-weight: 400; }

        .cb-swipe-wrap { position: relative; overflow: hidden; border-radius: 10px; }
        .cb-swipe-delete {
          position: absolute; inset: 0; display: flex; align-items: stretch; justify-content: flex-end;
          background: #C0453A; border-radius: 10px;
        }
        .cb-swipe-delete-btn {
          width: 84px; background: none; border: none; color: #F4EFE4; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; font-weight: 700; cursor: pointer;
        }
        .cb-swipe-content { position: relative; touch-action: pan-y; transition: transform 0.15s ease; }

        .cb-undo-toast {
          position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 110;
          background: #20242B; border: 1px solid #3A3F4A; color: #F4EFE4; border-radius: 999px;
          padding: 10px 10px 10px 18px; display: flex; align-items: center; gap: 14px; max-width: 90vw;
          font-family: 'Work Sans', sans-serif; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        .cb-undo-toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cb-undo-btn {
          background: #C99A3E; border: none; color: #20242B; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; font-weight: 700; padding: 7px 14px; border-radius: 999px; cursor: pointer; flex: 0 0 auto;
        }
        .cb-undo-btn:hover { background: #DCAE55; }
        .cb-carousel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .cb-carousel-label {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: #A9A48F;
        }
        .cb-refresh-btn {
          width: 28px; height: 28px; border-radius: 50%; background: #2A2F38; border: 1px solid #3A3F4A;
          color: #F4EFE4; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .cb-refresh-btn:hover { background: #343A45; }
        .cb-refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .cb-refresh-btn.spinning { animation: cb-spin 0.9s linear infinite; }
        @keyframes cb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .cb-carousel-loading, .cb-carousel-error { font-family: 'Work Sans', sans-serif; font-size: 13px; color: #A9A48F; padding: 14px 2px; }
        .cb-carousel-track {
          display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px;
          -webkit-overflow-scrolling: touch;
        }
        .cb-rcard {
          flex: 0 0 80%; scroll-snap-align: start; background: #F8F3E6; border-radius: 12px; overflow: hidden;
          display: flex; flex-direction: column; text-align: left;
        }
        @media (min-width: 768px) { .cb-rcard { flex: 0 0 44%; } }
        .cb-rcard-media { height: 100px; background: #3A3F4A; display: flex; align-items: center; justify-content: center; }
        .cb-rcard-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cb-rcard-media.no-image { background: linear-gradient(135deg, #C99A3E, #20242B); }
        .cb-rcard-fallback { font-family: 'Libre Caslon Display', serif; font-size: 28px; color: #F4EFE4; opacity: 0.85; }
        .cb-rcard-body { padding: 10px 12px 4px; flex: 1; }
        .cb-rcard-source { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8A8267; margin-bottom: 3px; }
        .cb-rcard-badge { text-transform: none; letter-spacing: 0; font-style: italic; opacity: 0.85; }
        .cb-rcard-title { font-family: 'Libre Caslon Display', serif; font-size: 14px; color: #20242B; line-height: 1.25; margin-bottom: 4px; }
        .cb-rcard-teaser {
          font-family: 'Work Sans', sans-serif; font-size: 11.5px; color: #4A4636; line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .cb-rcard-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 12px; }
        .cb-rcard-add {
          flex: 1 1 auto; min-width: 96px; background: none; border: 1px solid #C99A3E; color: #8A6A24; font-family: 'JetBrains Mono', monospace;
          font-size: 10px; font-weight: 600; border-radius: 999px; padding: 6px 6px; cursor: pointer; text-align: center;
        }
        .cb-rcard-add:hover { background: rgba(201,154,62,0.12); }
        .cb-rcard-open {
          flex: 1 1 auto; min-width: 70px; background: #20242B; color: #F4EFE4; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600;
          border-radius: 999px; padding: 6px 6px; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;
        }
        .cb-rcard-open:hover { background: #343A45; }
        .cb-toolbar { margin-bottom: 16px; }
        .cb-search-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .cb-search {
          flex: 1; min-width: 0; background: #2A2F38; border: 1px solid #3A3F4A; border-radius: 8px;
          padding: 10px 14px; font-family: 'Work Sans', sans-serif; font-size: 14px; color: #F4EFE4; outline: none;
        }
        .cb-search::placeholder { color: #7D7A6D; }
        .cb-search:focus { border-color: #C99A3E; }
        .cb-filter {
          flex: 0 0 auto; max-width: 40%; background: #2A2F38; border: 1px solid #3A3F4A; border-radius: 8px;
          padding: 10px 10px; font-family: 'Work Sans', sans-serif; font-size: 13px; color: #F4EFE4;
          outline: none; cursor: pointer;
        }
        .cb-filter:focus { border-color: #C99A3E; }
        .cb-list-header-row {
          display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          padding-bottom: 10px; border-bottom: 1px solid rgba(244,239,228,0.12);
        }
        .cb-list-count {
          font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: #A9A48F;
        }
        .cb-list-date { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #7D7A6D; white-space: nowrap; }
        .cb-prompt-box {
          position: relative; background: #2A2F38; border: 1px solid #3A3F4A; border-radius: 16px;
          padding: 14px; transition: border-color 0.15s ease; display: flex; flex-direction: column;
        }
        .cb-prompt-box:focus-within { border-color: #C99A3E; }
        .cb-prompt-input {
          width: 100%; background: none; border: none; outline: none; resize: none;
          color: #F4EFE4; font-family: 'Work Sans', sans-serif; font-size: 14px; line-height: 1.5;
          min-height: 64px; max-height: 240px;
        }
        .cb-prompt-input::placeholder { color: #7D7A6D; }
        .cb-prompt-bottom-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
        .cb-prompt-send {
          width: 32px; height: 32px; border-radius: 50%; margin-left: auto; flex: 0 0 auto;
          border: none; background: #C99A3E; color: #20242B; font-size: 16px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
        }
        .cb-prompt-send:disabled { background: #4A4636; color: #7D7A6D; cursor: not-allowed; }
        .cb-empty { color: #A9A48F; font-family: 'Work Sans', sans-serif; font-size: 14px; padding: 12px 2px; }
        .cb-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 768px) {
          .cb-layout { display: grid; grid-template-columns: 3fr 7fr; gap: 48px; align-items: start; }
          .cb-left { position: sticky; top: 32px; margin-bottom: 0; }
        }
        .cb-card {
          text-align: left; background: #F8F3E6; border: none; border-top: 5px solid var(--card-accent);
          border-radius: 10px; padding: 18px 20px 20px; cursor: pointer; font-family: 'Work Sans', sans-serif;
          display: flex; flex-direction: column; gap: 6px; transition: transform 0.15s ease;
        }
        .cb-card:hover { transform: translateY(-2px); }
        .cb-card:active { transform: translateY(0px) scale(0.99); }
        .cb-card:focus-visible { outline: 2px solid var(--card-accent); outline-offset: 2px; }
        .cb-card-num { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #8A8267; letter-spacing: 0.05em; }
        .cb-card-title { font-family: 'Libre Caslon Display', serif; font-size: 19px; color: #20242B; line-height: 1.2; }
        .cb-card-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .cb-tag {
          font-size: 11px; font-weight: 600; background: rgba(0,0,0,0.06); color: #4A4636;
          padding: 3px 8px; border-radius: 999px;
        }
        .cb-card-blurb { font-size: 13px; color: #4A4636; line-height: 1.5; }
        .cb-card-meta { font-size: 12px; color: #8A8267; font-style: italic; }
        .cb-card-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 10px; }
        .cb-card-addmenu {
          background: none; border: 1px solid var(--card-accent); color: var(--card-accent);
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
          padding: 5px 10px; border-radius: 999px; cursor: pointer; flex: 0 0 auto;
        }
        .cb-card-addmenu:hover { background: rgba(0,0,0,0.05); }
        .cb-card-cta { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--card-accent); flex: 0 0 auto; white-space: nowrap; }
        .cb-card-cookbook-cta {
          background: none; border: none; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600;
          color: var(--card-accent); cursor: pointer; flex: 0 0 auto; white-space: nowrap; padding: 0;
        }
        .cb-card-cookbook-cta:hover { text-decoration: underline; }
        .cb-card-source-link { color: #8A8267; text-decoration: underline; font-weight: 500; }
        .cb-card-source-link:hover { color: #4A4636; }

        /* ---------- detail view chrome (embedded in the right column) ---------- */
        .cb-detail-nav {
          position: sticky; top: 12px; z-index: 5; background: #20242B;
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding-bottom: 12px; margin-bottom: 10px;
        }
        .cb-back-btn {
          background: #C99A3E; color: #20242B; border: none; border-radius: 999px;
          font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 13px;
          padding: 11px 18px; cursor: pointer; white-space: nowrap;
        }
        .cb-back-btn:hover { background: #DCAE55; }
        .cb-step-group { display: flex; align-items: center; gap: 8px; }
        .cb-step-btn {
          width: 38px; height: 38px; border-radius: 50%; background: #2A2F38; border: 1px solid #3A3F4A;
          color: #F4EFE4; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .cb-step-btn:hover { background: #343A45; }
        .cb-step-label {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #A9A48F; white-space: nowrap;
        }

        /* ---------- shared recipe page chrome ---------- */
        .rp-page {
          background: var(--bg); color: var(--ink); font-family: var(--font-body);
          border-radius: 16px; padding: 22px 20px 28px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        .rp-wrap { width: 100%; }
        .rp-eyebrow {
          font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--muted); margin-bottom: 6px; display: block;
        }
        .rp-title { font-family: var(--font-display); font-weight: 700; font-size: 28px; line-height: 1.15; margin: 0 0 4px; }
        .rp-subtitle { font-size: 14px; color: var(--muted); margin-bottom: 20px; }

        /* two-way switch */
        .rp-switch {
          position: relative; display: flex; background: var(--accent-soft); border-radius: 999px;
          padding: 4px; margin-bottom: 10px;
        }
        .rp-switch-thumb { position: absolute; top: 4px; left: 4px; width: calc(50% - 4px); height: calc(100% - 8px); border-radius: 999px; transition: transform 0.2s ease; }
        .rp-switch button {
          position: relative; flex: 1; z-index: 1; background: none; border: none; padding: 10px 0;
          font-family: var(--font-display); font-weight: 600; font-size: 14px; color: var(--ink); cursor: pointer;
        }
        .rp-switch button.active { color: #F7F4E9; }

        /* multi-way option row */
        .rp-option-row { display: flex; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
        .rp-option-btn {
          flex: 1 1 auto; min-width: 90px; background: var(--accent-soft); border: 2px solid transparent;
          border-radius: 10px; padding: 10px 10px; cursor: pointer; font-family: var(--font-body);
          text-align: left; display: flex; flex-direction: column; gap: 2px;
        }
        .rp-option-btn.active { border-color: var(--accent); background: #fff; }
        .rp-option-sub { font-size: 11px; opacity: 0.65; font-weight: 400; }

        .rp-cuttag { font-size: 13px; color: var(--muted); margin-bottom: 20px; }

        /* nutrition card */
        .rp-nutrition { background: var(--ink); color: #F7F4E9; border-radius: 10px; padding: 16px 18px; margin-bottom: 24px; }
        .rp-nutrition-head { font-family: var(--font-display); font-weight: 700; font-size: 16px; }
        .rp-nutrition-sub { font-size: 12px; opacity: 0.7; margin-bottom: 6px; }
        .rp-rule-thick { border: none; border-top: 3px solid #F7F4E9; margin: 6px 0; }
        .rp-rule-thin { border: none; border-top: 1px solid rgba(247,244,233,0.4); margin: 6px 0; }
        .rp-kcal-row { display: flex; justify-content: space-between; align-items: baseline; }
        .rp-kcal-label { font-size: 15px; font-weight: 600; }
        .rp-kcal-value { font-family: var(--font-mono); font-size: 24px; font-weight: 600; }
        .rp-macro-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
        .rp-nutrition-extra { font-size: 11px; opacity: 0.7; margin-top: 8px; border-top: 1px solid rgba(247,244,233,0.3); padding-top: 8px; }
        .rp-source-note { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--line); }
        .rp-source-note a { color: var(--accent); text-decoration: underline; }
        .rp-macro-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 2px 0 8px; background: rgba(247,244,233,0.15); }
        .rp-macro-seg { display: block; height: 100%; }
        .rp-macro-protein { background: var(--accent); }
        .rp-macro-carb { background: #8FB6D9; }
        .rp-macro-fat { background: #E8B34D; }
        .rp-macro-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; opacity: 0.85; margin-bottom: 10px; }
        .rp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
        .rp-dot-protein { background: var(--accent); }
        .rp-dot-carb { background: #8FB6D9; }
        .rp-dot-fat { background: #E8B34D; }
        .rp-macro-block.compact .rp-macro-bar { height: 5px; margin: 2px 0 4px; background: rgba(0,0,0,0.08); }
        .rp-macro-block.compact .rp-macro-legend { gap: 8px; font-size: 10px; margin-bottom: 0; opacity: 1; color: #4A4636; }
        .rp-macro-block.compact .rp-dot { width: 6px; height: 6px; margin-right: 3px; }

        /* sections */
        .rp-section { margin-bottom: 8px; }
        .rp-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 22px 0 10px; }
        .rp-section-toggle { flex: 1; display: flex; align-items: center; gap: 10px; background: none; border: none; cursor: pointer; padding: 0; text-align: left; }
        .rp-section-num {
          font-family: var(--font-mono); font-size: 11px; font-weight: 600; background: var(--ink); color: var(--bg);
          width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: 0 0 auto;
        }
        .rp-section-toggle h2 { font-family: var(--font-display); font-size: 16px; margin: 0; flex: 1; }
        .rp-chevron { transition: transform 0.15s ease; opacity: 0.5; }
        .rp-chevron.open { transform: rotate(180deg); }
        .rp-section-extra { flex: 0 0 auto; }
        .rp-section-body { display: flex; flex-direction: column; gap: 2px; }

        .rp-select {
          appearance: none; -webkit-appearance: none; background: #fff; border: 1px solid var(--line);
          border-radius: 999px; padding: 8px 28px 8px 12px; font-family: var(--font-display); font-weight: 600;
          font-size: 13px; color: var(--ink); cursor: pointer;
        }

        /* ingredients */
        .rp-ing-row { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
        .rp-ing-amt { font-family: var(--font-mono); font-weight: 600; flex: 0 0 84px; }
        .rp-ing-name { flex: 1; }
        .rp-ing-note { opacity: 0.65; font-size: 12px; }
        .rp-amt-wrap { display: inline-flex; align-items: baseline; gap: 2px; }
        .rp-amt-frac { display: inline-flex; flex-direction: column; font-size: 10px; line-height: 1; margin-left: 1px; }
        .rp-amt-text { font-size: 12px; }

        .rp-amount-row { display: flex; align-items: center; gap: 12px; padding: 8px 0 12px; }
        .rp-amount-label { font-size: 13px; font-weight: 600; }

        /* stepper */
        .rp-stepper { display: flex; align-items: center; gap: 10px; }
        .rp-stepper-amt { font-family: var(--font-mono); font-weight: 600; font-size: 14px; min-width: 56px; text-align: center; }
        .rp-stepper button, .rp-toggle {
          width: 30px; height: 30px; border-radius: 50%; border: none; background: var(--accent); color: #fff;
          font-family: var(--font-mono); font-weight: 600; font-size: 15px; line-height: 1; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .rp-stepper button:disabled { opacity: 0.3; cursor: not-allowed; }

        /* toggle switch */
        .rp-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; }
        .rp-control-label { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
        .rp-control-block { margin-bottom: 22px; }
        .rp-toggle { width: 42px; height: 24px; border-radius: 999px; background: var(--line); padding: 2px; justify-content: flex-start; }
        .rp-toggle.on { background: var(--accent); justify-content: flex-end; }
        .rp-toggle-knob { width: 18px; height: 18px; border-radius: 50%; background: #fff; display: block; }

        /* steps */
        .rp-steps { list-style: none; padding: 0; margin: 0; counter-reset: step; }
        .rp-steps li { counter-increment: step; position: relative; padding: 2px 0 18px 32px; font-size: 14px; line-height: 1.5; }
        .rp-steps li::before {
          content: counter(step); position: absolute; left: 0; top: 1px; width: 21px; height: 21px; border-radius: 50%;
          background: var(--ink); color: var(--bg); font-family: var(--font-mono); font-size: 11px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
        }
        .rp-steps li strong { display: block; font-family: var(--font-display); font-weight: 600; font-size: 15px; margin-bottom: 2px; }
        .rp-note { font-size: 12px; color: var(--muted); font-style: italic; margin-top: 4px; }
        .rp-timing-pill {
          display: inline-block; font-family: var(--font-mono); font-size: 12px; font-weight: 600; background: var(--accent-soft);
          padding: 5px 12px; border-radius: 999px; margin-bottom: 10px;
        }

        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
        button:focus-visible { outline: 2px solid var(--accent, #C99A3E); outline-offset: 2px; }
      `}</style>

      <div className="cb-shell">
        <div className="cb-wrap">
          <div className="cb-layout">
            <div className="cb-left">
              {user ? (
                <div className="cb-userbar">
                  <span className="cb-userbar-email" title={user.email}>{user.email}</span>
                  <button type="button" className="cb-signout" onClick={signOut}>Sign out</button>
                </div>
              ) : null}
              <div className="cb-eyebrow">The Recipe Box</div>
              <h1 className="cb-title">Zara's Plate</h1>
              <div className="cb-tabbar" role="tablist">
                {COMPOSER_TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={activeTab === t.key}
                    className={`cb-tab ${activeTab === t.key ? "active" : ""}`}
                    onClick={() => setActiveTab(t.key)}
                    type="button"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTab === "eat" && (
                <div className="cb-carousel-wrap">
                  <div className="cb-carousel-head">
                    <span className="cb-carousel-label">Today's Picks</span>
                    <button
                      className={`cb-refresh-btn ${recipesLoading ? "spinning" : ""}`}
                      type="button"
                      onClick={() => loadDailyRecipes(true)}
                      disabled={recipesLoading}
                      aria-label="Refresh recipe picks"
                    >
                      ↻
                    </button>
                  </div>
                  {recipesError ? (
                    <div className="cb-carousel-error">{recipesError}</div>
                  ) : recipesLoading && dailyRecipes.length === 0 ? (
                    <div className="cb-carousel-loading">Finding today's picks…</div>
                  ) : (
                    <div className="cb-carousel-track">
                      {dailyRecipes.map((r, i) => {
                        const key = r.url || i;
                        return (
                          <CarouselCard
                            key={key}
                            r={r}
                            imgFailed={imgFailed[key]}
                            onImgError={() => setImgFailed((f) => ({ ...f, [key]: true }))}
                            onAddToPrompt={addRecipeToPrompt}
                            onAddToMenu={openAddToMenuModal}
                            onQuickAddToday={quickAddToday}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {activeTab === "plan" && (
                <>
                  <WeekStrip
                    weekDays={weekDays}
                    selectedDay={selectedDay}
                    onSelectDay={setSelectedDay}
                    menu={menu}
                    todayISO={todayISO}
                    onClearWeek={requestClearWeek}
                  />
                  <PlanMacroSummary weekDays={weekDays} selectedDay={selectedDay} menu={menu} recipes={allRecipes} />
                </>
              )}
              <div className="cb-prompt-block">
                <div className="cb-prompt-box">
                  <textarea
                    key={activeTab}
                    className="cb-prompt-input"
                    placeholder={activeTabConfig.placeholder}
                    value={prompts[activeTab]}
                    onChange={(e) => { setPrompts((p) => ({ ...p, [activeTab]: e.target.value })); autoGrow(e); }}
                    onKeyDown={handlePromptKeyDown}
                    rows={3}
                  />
                  <div className="cb-prompt-bottom-row">
                    {activeTab === "eat" && (
                      <div className="cb-prompt-starters">
                        {PROMPT_STARTERS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="cb-prompt-starter"
                            disabled={!showPromptStarters}
                            onClick={() => insertPromptStarter(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    {activeTab === "plan" && (
                      <div className="cb-prompt-starters">
                        {PLAN_PROMPT_STARTERS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="cb-prompt-starter"
                            onClick={() => insertPromptStarter(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      className="cb-prompt-send"
                      type="button"
                      aria-label="Submit prompt"
                      disabled={!prompts[activeTab].trim()}
                      onClick={() => submitPrompt(activeTab)}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="cb-right">
              {active ? (
                <div className="cb-detail">
                  <div className="cb-detail-nav">
                    <button className="cb-back-btn" type="button" onClick={() => setActiveId(null)}>
                      &larr; All recipes
                    </button>
                    <div className="cb-step-group">
                      <button className="cb-step-btn" type="button" onClick={goPrev} aria-label="Previous recipe">&larr;</button>
                      <span className="cb-step-label">
                        No. {String(activeIndex + 1).padStart(3, "0")} / {String(allRecipes.length).padStart(3, "0")}
                      </span>
                      <button className="cb-step-btn" type="button" onClick={goNext} aria-label="Next recipe">&rarr;</button>
                    </div>
                  </div>
                  <active.Component />
                </div>
              ) : activeTab === "plan" ? (
                <PlanView
                  weekDays={weekDays}
                  selectedDay={selectedDay}
                  todayISO={todayISO}
                  menu={menu}
                  recipes={allRecipes}
                  onOpenRecipe={setActiveId}
                  onAddToMenu={openAddToMenuModal}
                  onQuickAddToday={quickAddToday}
                  onClearDay={requestClearDay}
                  onRequestDelete={requestDeleteFromMenu}
                  onCalculateMacros={calculateExternalMacros}
                  externalMacroStatus={externalMacroStatus}
                  onAddToCookbook={openAddToCookbook}
                />
              ) : (
                <>
                  <div className="cb-toolbar">
                    <div className="cb-search-row">
                      <input
                        className="cb-search"
                        type="text"
                        placeholder="Search recipes…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Search recipes"
                      />
                      <select className="cb-filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by protein or diet">
                        <option value="all">All</option>
                        {proteinOptions.map((p) => (
                          <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                        <option value="vegetarian">Vegetarian</option>
                        <option value="vegan">Vegan</option>
                      </select>
                    </div>
                    <div className="cb-list-header-row">
                      <span className="cb-list-count">{listHeader}</span>
                      <span className="cb-list-date">Last added {lastAddedLabel}</span>
                    </div>
                  </div>
                  <div className="cb-grid">
                    {filtered.length ? (
                      filtered.map((r, i) => (
                        <RecipeCard
                          key={r.id}
                          recipe={r}
                          index={i}
                          onOpen={setActiveId}
                          onAddToMenu={openAddToMenuModal}
                          onQuickAddToday={quickAddToday}
                        />
                      ))
                    ) : (
                      <div className="cb-empty">No recipes match that search and filter.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {pendingMenuItem ? (
        <AddToMenuModal
          item={pendingMenuItem}
          weekDays={weekDays}
          todayISO={todayISO}
          isAlreadyOn={(iso, meal) => (menu[iso] || []).some((e) => itemsMatch(e, { ...pendingMenuItem, meal }))}
          onConfirm={handleAddToDays}
          onClose={closeAddToMenuModal}
        />
      ) : null}
      {confirmAction ? (
        <ConfirmModal
          title={confirmAction.type === "clear-week" ? "Clear this week?" : `Clear ${confirmAction.label}?`}
          message={
            confirmAction.type === "clear-week"
              ? `This removes every recipe planned for all 7 days this week (${confirmAction.label}). This can't be undone.`
              : `This removes every recipe planned for ${confirmAction.label}. This can't be undone.`
          }
          confirmLabel="Clear"
          onConfirm={runConfirmedClear}
          onCancel={() => setConfirmAction(null)}
        />
      ) : null}
      {undoState ? (
        <div className="cb-undo-toast">
          <span>Removed "{undoState.item.label}" from {formatFullDate(undoState.iso)}.</span>
          <button type="button" className="cb-undo-btn" onClick={undoDelete}>Undo</button>
        </div>
      ) : null}
      {cookbookDraft ? (
        <AddToCookbookModal
          draft={cookbookDraft}
          onApprove={approveCookbookDraft}
          onReject={rejectCookbookDraft}
          onRetry={retryCookbookDraft}
        />
      ) : null}
    </div>
  );
}
