// Supabase Edge Function: server-side proxy to the Anthropic Messages API.
// Holds ANTHROPIC_API_KEY as a secret so it never reaches the browser, and only
// runs for signed-in users (the public anon key alone must not be able to spend
// Anthropic credits). The client calls this via supabase.functions.invoke("claude").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Models the client may request (future: a user-facing picker); anything else
// falls back to DEFAULT_MODEL.
const ALLOWED_MODELS = new Set(["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"]);
const DEFAULT_MODEL = "claude-sonnet-5";

// Basic web search — faster and far fewer server round-trips than the
// dynamic-filtering variant (which runs code execution under the hood), and
// plenty for finding a handful of recipe links. max_uses bounds latency.
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 6 };

// Web search runs a server-side tool loop that can stop with stop_reason
// "pause_turn" after ~10 iterations; re-send to let it finish (bounded).
const MAX_CONTINUATIONS = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Require a real signed-in user — not just a valid anon key (which is public).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ type: "error", error: { message: "Not authenticated." } }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ type: "error", error: { message: "Server missing ANTHROPIC_API_KEY." } }, 500);

    const { prompt, useSearch, shape, maxTokens, model } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return json({ type: "error", error: { message: "Missing prompt." } }, 400);
    }

    const chosenModel = model && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const base: Record<string, unknown> = {
      model: chosenModel,
      max_tokens: maxTokens || (shape === "object" ? 400 : 1500),
      // Constrained JSON generation; thinking would only add latency/cost, and the
      // client already regex-extracts the JSON from the final text block.
      thinking: { type: "disabled" },
    };
    if (useSearch) base.tools = [WEB_SEARCH_TOOL];

    // Drive the server-tool loop to completion, continuing past any pause_turn.
    let messages: unknown[] = [{ role: "user", content: prompt }];
    let data: any;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...base, messages }),
      });
      data = await res.json();
      // Pass Anthropic errors back as 200 so the client can read data.type === "error".
      if (!res.ok || data?.type === "error") return json(data, 200);
      if (data?.stop_reason === "pause_turn" && Array.isArray(data.content)) {
        messages = [...messages, { role: "assistant", content: data.content }];
        continue;
      }
      break;
    }
    return json(data, 200);
  } catch (e) {
    return json({ type: "error", error: { message: (e as Error)?.message || "Proxy error." } }, 500);
  }
});
