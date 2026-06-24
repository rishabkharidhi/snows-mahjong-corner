# Deploying Snows Mahjong Corner to rishabkharidhi.com/mahjong

This is a real, standalone webapp — no Claude.ai dependency. It has two parts:

- **`site/`** — the actual webapp (HTML/CSS/JS). Upload these 7 files to
  `rishabkharidhi.com/mahjong/` the same way you deploy your other apps
  (valuation-app, domsi, etc).
- **`backend/worker.js`** — a tiny free backend that the webapp talks to for
  shared multiplayer state (room data, chip balances). This does **not** get
  uploaded to your site — it gets deployed once to Cloudflare.

You only need to set up the backend once. After that, updating the site is
just re-uploading files like normal.

## Part 1 — Deploy the backend (one-time, ~5 minutes)

1. Go to **dash.cloudflare.com** and sign up free if you don't have an account.
2. **Workers & Pages** (left sidebar) → **Create** → **Create Worker**.
3. Give it any name (e.g. `snows-mahjong-kv`) → **Deploy** (deploys a default
   placeholder — that's fine, you'll replace the code next).
4. Click **Edit code**. Delete everything in the editor and paste in the
   entire contents of `backend/worker.js`. Click **Deploy**.
5. Back in **Workers & Pages**, go to **KV** (left sidebar) → **Create a
   namespace**. Name it anything, e.g. `MAHJONG_ROOMS` → **Add**.
6. Go back to your Worker → **Settings** tab → **Variables** → **KV Namespace
   Bindings** → **Add binding**.
   - Variable name: `MAHJONG_KV` (must match exactly — the code expects this name)
   - KV namespace: select the one you just created (`MAHJONG_ROOMS`)
   - **Save and deploy**.
7. Go to your Worker's main page and copy its URL — it looks like
   `https://snows-mahjong-kv.<your-subdomain>.workers.dev`.

That's the whole backend. No servers to maintain, and it's on Cloudflare's
generous free tier (well beyond what a friend-group mahjong game needs).

## Part 2 — Point the site at your backend

1. Open `site/storage.js` in a text editor.
2. Near the top, find this line:
   ```js
   const WORKER_URL = "https://REPLACE-WITH-YOUR-WORKER-URL.workers.dev";
   ```
3. Replace the placeholder with the real URL you copied in step 7 above.
4. Save the file.

## Part 3 — Upload the site

Upload everything in `site/` to `rishabkharidhi.com/mahjong/`, preserving
the flat file structure (no subfolders needed):

```
rishabkharidhi.com/mahjong/index.html
rishabkharidhi.com/mahjong/style.css
rishabkharidhi.com/mahjong/mahjong-logic.js
rishabkharidhi.com/mahjong/storage.js
rishabkharidhi.com/mahjong/engine.js
rishabkharidhi.com/mahjong/render.js
rishabkharidhi.com/mahjong/app.js
```

Use whatever method you already use for your other apps (FTP, git push,
your host's file manager, etc.) — there's nothing special about these files,
they're just static HTML/CSS/JS.

Visit `rishabkharidhi.com/mahjong` and you should see the game load. Create
a room, open the link on another device or send the room code to a friend,
and you're playing — for real, independent of Claude.ai.

## Notes

- **CORS**: the Worker is set to allow requests from any website
  (`ALLOWED_ORIGIN = "*"` near the top of `worker.js`). If you'd rather lock
  it down to just your domain, change that line to
  `const ALLOWED_ORIGIN = "https://rishabkharidhi.com";` and redeploy the Worker.
- **No accounts, no passwords**: anyone who knows a 4-letter room code can
  read and join that room. Fine for a casual game with friends — just don't
  post room codes somewhere public.
- **Updating the game later**: if you ask Claude to add a feature or fix a
  bug, you'll get a new set of files for `site/` — just re-upload them. The
  backend (`worker.js`) almost never needs to change once it's deployed.
- **Costs**: $0 at the usage levels a friend-group game will ever hit.
  Cloudflare's free tier covers 100,000 Worker requests/day and generous KV
  read/write limits.
