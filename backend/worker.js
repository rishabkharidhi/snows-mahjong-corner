/**
 * Snows Mahjong Corner — backend worker.
 *
 * This replaces the Claude-artifact-only `window.storage` API with a real,
 * tiny key-value backend so the game can run on any website. It does three
 * things: GET a key, SET a key, and (rarely) DELETE a key, all backed by a
 * Cloudflare KV namespace.
 *
 * DEPLOY (see DEPLOY.md for the full walkthrough with screenshots-in-words):
 *   1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker.
 *   2. Paste this whole file in as the Worker's code. Deploy.
 *   3. Workers & Pages -> KV -> Create a namespace (any name, e.g. MAHJONG_ROOMS).
 *   4. Back on your Worker -> Settings -> Variables -> KV Namespace Bindings
 *      -> Add binding: variable name = MAHJONG_KV, namespace = the one you
 *      just made. Save and deploy.
 *   5. Copy your Worker's URL (https://<name>.<you>.workers.dev) into
 *      WORKER_URL at the top of storage.js, then re-upload the site files.
 *
 * That's it — no servers to maintain, generous free tier, and it has
 * nothing to do with Claude.ai at all once deployed.
 */

// Only these origins are allowed to call this Worker. Add/remove as needed.
// Using "*" is simplest if you don't mind any website being able to call it
// (low risk here since the data is just mahjong room state, not anything
// sensitive) — tighten this if you'd rather lock it to your own domain.
const ALLOWED_ORIGIN = "*"; // or e.g. "https://rishabkharidhi.com"

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (!env.MAHJONG_KV) {
      return json({ error: "MAHJONG_KV binding missing — see DEPLOY.md step 4" }, 500);
    }

    try {
      if (request.method === "GET" && url.pathname === "/get") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "missing key" }, 400);
        const value = await env.MAHJONG_KV.get(key);
        return json({ value }); // value is null if not found — that's expected
      }

      if (request.method === "POST" && url.pathname === "/set") {
        const body = await request.json();
        if (!body || !body.key) return json({ error: "missing key" }, 400);
        // Cap stored value size defensively (KV allows much more, but a
        // mahjong room should never legitimately need more than ~200KB).
        if (typeof body.value === "string" && body.value.length > 500000) {
          return json({ error: "value too large" }, 413);
        }
        await env.MAHJONG_KV.put(body.key, body.value ?? "");
        return json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/delete") {
        const body = await request.json();
        if (!body || !body.key) return json({ error: "missing key" }, 400);
        await env.MAHJONG_KV.delete(body.key);
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/list") {
        const prefix = url.searchParams.get("prefix") || "";
        const result = await env.MAHJONG_KV.list({ prefix });
        return json({ keys: result.keys.map((k) => k.name) });
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};
