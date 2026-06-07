# flow-api-mcp

Web2API wrapper for [Google Labs Flow](https://labs.google/fx/tools/flow) — exposes image and video generation as an MCP (Model Context Protocol) server.

Uses Playwright to drive a persistent **Google Chrome** profile, so you authenticate once with your own Google account and the session is reused for every subsequent call.

```
AI agent (Claude/Cursor/opencode)  →  MCP (stdio or HTTP)  →  Playwright + Chrome  →  Google Flow
```

## Features

- `generate_image` — text-to-image via Nano Banana 2 / Nano Banana Pro / Imagen 4
- `generate_video` — storyboard-driven video generation via Omni Flash / Veo 3 / Veo 3.1 (multi-step agent, several minutes per clip)
- `flow_status` — verify session, list image and video models, aspect ratios
- `flow_login` — open a visible browser for one-time sign-in
- `flow_close` — shut down the browser
- **HTTP transport** — same tools exposed via `POST /mcp` with bearer-token auth, plus `GET /health`, `POST /admin/import-cookies`, `GET /admin/cookie-status`
- **Auto browser cleanup** — every script closes Chrome in `finally`, kills orphan processes, removes profile locks; no more manual `Stop-Process` between runs
- Aspect ratios: `16:9`, `4:3`, `1:1`, `3:4`, `9:16` (image); `16:9`, `9:16` (video)
- Configurable output directory
- Headless by default (browser only opens visibly for login)
- Cookie import — re-use cookies from another Chrome instance

## Quick start

```bash
cd "D:/code/flow api"
npm install
copy .env.example .env

# Option A — Sign in interactively (opens a visible Chrome window)
npx flow-api login
#  ... then sign in to Google, close the tab, Ctrl+C

# Option B — Import cookies exported from another browser
#   (e.g. via a Chrome extension like "Cookie-Editor", save as JSON)
npx flow-api import-cookies path/to/cookies.json

# Verify session
npx flow-api status

# Quick CLI test
npx flow-api test "a cinematic cat in a neon city"

# Start MCP server (stdio)
npx flow-api serve

# Or start HTTP server (for remote clients)
npx flow-api serve-http
```

The Chrome profile lives in `./data/chrome-profile/` and lasts ~30 days.

## Why real Chrome?

Google's generation endpoint (`aisandbox-pa.googleapis.com`) returns **HTTP 403** when called from Playwright's bundled Chromium with default anti-bot flags. To get around that, we launch your installed `Google Chrome` (`channel: 'chrome'`) and inject a small stealth init script that hides `navigator.webdriver`, the automation toggle, and a few other fingerprints.

If you really want bundled Chromium, set `USE_SYSTEM_CHROME=false` in `.env` — but expect most generations to fail with 403.

## MCP client config

### opencode / Claude Desktop

Add to your MCP config (e.g. `~/.config/opencode/opencode.jsonc` or `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flow-api": {
      "command": "npx",
      "args": ["flow-api", "serve"],
      "cwd": "D:/code/flow api"
    }
  }
}
```

Or directly with node:

```json
{
  "mcpServers": {
    "flow-api": {
      "command": "node",
      "args": ["D:/code/flow api/bin/flow-api.js", "serve"]
    }
  }
}
```

## HTTP transport

The same MCP tools are exposed via HTTP for remote clients:

```bash
npx flow-api serve-http   # listens on $HTTP_PORT (default 8787)
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer $HTTP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"flow_status","arguments":{}}}'
```

Endpoints:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/mcp` | bearer | JSON-RPC MCP calls |
| `GET` | `/health` | optional bearer | `{ ok, status, cookieCount, lastImport }` |
| `POST` | `/admin/import-cookies` | bearer | multipart upload of cookies.json, or JSON body `{ cookies: [...] }` |
| `GET` | `/admin/cookie-status` | bearer | inspect current cookies + expiry |

Generate a token with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Tools

### `generate_image`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | yes | — | Text prompt |
| `model` | enum | no | `nano-banana-2` | `nano-banana-2` / `nano-banana-pro` / `imagen-4` |
| `aspect_ratio` | enum | no | — | `16:9` / `4:3` / `1:1` / `3:4` / `9:16` |
| `output_dir` | string | no | `./output` | Override save location |

Returns: `{ ok, jobId, prompt, files: [...absolute paths] }`

### `generate_video`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | yes | — | Scene description (e.g. "A paper boat floats down a moonlit river") |
| `aspect_ratio` | enum | no | `16:9` | `16:9` / `9:16` |
| `count` | int | no | `1` | Number of clips to generate, `1`-`4` |
| `output_dir` | string | no | `./output` | Override save location |

Returns: `{ ok, jobId, prompt, files: [...absolute paths to .mp4] }`

> **Note** — video generation is **multi-step and slow**. Flow's storyboard agent first drafts a 4-6 scene plan, then generates each clip sequentially. Plan time is typically 10-30 seconds; clip time is 1-5 minutes per scene. Total runtime for `count=4` can be **15-30 minutes**. The HTTP request blocks for the full duration.
>
> Requires a **Pro / paid** Flow plan — the free tier doesn't have Omni/Veo access.

### `flow_status`

Returns login state, browser uptime, image and video model list, aspect ratios, and config paths.

### `flow_login`

Opens a headed Chrome window for manual Google sign-in. After the user signs in, the session cookie is persisted in the local profile. Idempotent — safe to call any time the session has expired.

### `flow_close`

Releases the browser.

## CLI

```
npx flow-api login               # open browser, sign in interactively
npx flow-api status              # check session, list models (image + video)
npx flow-api import-cookies [f]  # import Chrome cookies from a JSON file
npx flow-api test "<prompt>"     # generate a single image from CLI
npx flow-api serve               # start MCP server (stdio)
npx flow-api serve-http          # start MCP server (HTTP transport)
npx flow-api cleanup             # kill stuck Chrome, remove profile locks
```

## Configuration (`.env`)

```ini
CHROME_PROFILE_DIR=./data/chrome-profile
OUTPUT_DIR=./output
LOCALE=en
HEADLESS=true
USE_SYSTEM_CHROME=true
FLOW_URL=https://labs.google/fx/tools/flow
GENERATION_TIMEOUT_MS=180000
VIDEO_GENERATION_TIMEOUT_MS=480000
POLL_INTERVAL_MS=2000
ACTION_TIMEOUT_MS=30000
HTTP_PORT=8787
HTTP_AUTH_TOKEN=                 # generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How it works

1. **First run** — `flow_login` launches headed Chrome, user signs in to Google, session cookies persist to `./data/chrome-profile/`. (Or `import-cookies` injects cookies from a JSON file exported via any cookie-export extension.)
2. **`generate_image`** — Playwright opens the persisted profile, navigates to Flow, clicks *New project*, switches to *Images* mode (if needed), selects the aspect ratio, types the prompt into the Slate.js editor, clicks *Create* (the `arrow_forward` icon button), polls the DOM for `<img>` tags whose `src` matches `media.getMediaUrlRedirect?name={uuid}`, then downloads each UUID via the authenticated session.
3. **`generate_video`** — Playwright navigates to Flow, creates a new project, switches the canvas to **video** mode (aspect + count), clicks a storyboard starter chip (e.g. "Develop a storyboard"), types the prompt into the chat, waits for the agent's plan response (with confirmation), sends "Looks great. Please generate the videos now." to kick off generation, then polls the canvas for `<video>` elements and downloads each rendered `.mp4` via the same `media.getMediaUrlRedirect` endpoint used for images.
4. **Result** — image bytes saved to `./output/flow_<jobId>_<uuid>.jpg`, video bytes saved to `./output/flow_<jobId>_<uuid>.mp4`.
5. **Auto cleanup** — every script (including `status`, `test`, `import-cookies`) wraps its work in `withBrowser(fn)` which closes Playwright, kills the Chrome process, and removes profile lock files in a `finally` block. The `cleanup` subcommand exists for manual recovery when something else killed the process and left locks behind.

## Project structure

```
flow api/
├── package.json
├── .env.example
├── README.md
├── NOTES.md                     # dev journal (decisions, bugs, model catalog)
├── bin/
│   ├── flow-api.js              # CLI entry
│   ├── _runner.js               # withBrowser/withPage auto-cleanup helpers
│   ├── cleanup.js               # kill Chrome + remove profile locks
│   └── import-cookies.js        # standalone cookie import
├── src/
│   ├── server.js                # MCP server (stdio)
│   ├── http.js                  # MCP server (HTTP transport)
│   ├── handler.js               # MCP tool dispatch
│   ├── browser.js               # Playwright + stealth init script
│   ├── flow.js                  # Flow UI automation (image + video)
│   ├── tools/
│   │   └── index.js             # MCP tool definitions
│   └── utils/
│       ├── logger.js
│       └── downloader.js        # image + video UUID extraction
├── data/
│   ├── chrome-profile/          # persistent Chrome profile (gitignored)
│   └── cookies-import.json      # last imported cookie dump
└── output/                      # generated images + videos (gitignored)
```

## Safety

- **Your account, your data** — uses your own Chrome profile, no credentials ever leave your machine
- **No token export** — sessions are not copied, exported, or shared
- **Captcha-aware** — stops cleanly if Google challenges the session
- **No parallel abuse** — single browser context, one job at a time
- **Pro account required for video** — image generation works on free tier (50 credits/day), video needs paid plan

## Troubleshooting

| Problem | Fix |
|---|---|
| `AUTH_REQUIRED` | Run `npx flow-api login` |
| `CAPTCHA` | Open Flow manually in Chrome, solve the challenge, retry |
| `PROMPT_INPUT_NOT_FOUND` | Flow UI changed — re-run with headed=true to inspect |
| `GENERATE_BUTTON_NOT_FOUND` | Same as above |
| `GENERATION_TIMEOUT` | Daily credits may be exhausted, or Google is throttling. Check `flow_status`. |
| `AGENT_ERROR` (video) | Flow service / rate limit. Retry in a few minutes. |
| HTTP 403 on generate | Make sure `USE_SYSTEM_CHROME=true` in `.env`. Bundled Chromium triggers anti-bot. |
| Browser won't start | Install Google Chrome from <https://google.com/chrome> |
| Stale session | Re-run `npx flow-api login` or `npx flow-api import-cookies <file>` |
| Profile locked (SingletonLock) | Run `npx flow-api cleanup` |

## License

MIT
