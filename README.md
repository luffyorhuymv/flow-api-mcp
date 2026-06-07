# flow-api-mcp

Web2API wrapper for [Google Labs Flow](https://labs.google/fx/tools/flow) — exposes image generation as an MCP (Model Context Protocol) server.

Uses Playwright to drive a persistent **Google Chrome** profile, so you authenticate once with your own Google account and the session is reused for every subsequent call.

```
AI agent (Claude/Cursor/opencode)  →  MCP (stdio)  →  Playwright + Chrome  →  Google Flow
```

## Features

- `generate_image` — text-to-image via Nano Banana 2 / Nano Banana Pro / Imagen 4
- `flow_status` — verify session and list available models / aspect ratios
- `flow_login` — open a visible browser for one-time sign-in
- `flow_close` — shut down the browser
- Aspect ratios: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
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

# Start MCP server
npx flow-api serve
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

## Tools

### `generate_image`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | yes | — | Text prompt |
| `model` | enum | no | `nano-banana-2` | `nano-banana-2` / `nano-banana-pro` / `imagen-4` |
| `aspect_ratio` | enum | no | — | `16:9` / `4:3` / `1:1` / `3:4` / `9:16` |
| `output_dir` | string | no | `./output` | Override save location |

Returns: `{ ok, jobId, prompt, files: [...absolute paths] }`

### `flow_status`

Returns login state, browser uptime, model list, and config paths.

### `flow_login`

Opens a headed Chrome window for manual Google sign-in. After the user signs in, the session cookie is persisted in the local profile. Idempotent — safe to call any time the session has expired.

### `flow_close`

Releases the browser.

## CLI

```
npx flow-api login               # open browser, sign in interactively
npx flow-api status              # check session, list models
npx flow-api import-cookies [f]  # import Chrome cookies from a JSON file
npx flow-api test "<prompt>"     # generate a single image from CLI
npx flow-api serve               # start MCP server (stdio)
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
POLL_INTERVAL_MS=2000
ACTION_TIMEOUT_MS=30000
```

## How it works

1. **First run** — `flow_login` launches headed Chrome, user signs in to Google, session cookies persist to `./data/chrome-profile/`. (Or `import-cookies` injects cookies from a JSON file exported via any cookie-export extension.)
2. **`generate_image`** — Playwright opens the persisted profile, navigates to Flow, clicks *New project*, switches to *Images* mode (if needed), selects the aspect ratio, types the prompt into the Slate.js editor, clicks *Create* (the `arrow_forward` icon button), polls the DOM for `<img>` tags whose `src` matches `media.getMediaUrlRedirect?name={uuid}`, then downloads each UUID via the authenticated session.
3. **Result** — image bytes saved to `./output/flow_<jobId>_<uuid>.jpg`.

## Project structure

```
flow api/
├── package.json
├── .env.example
├── README.md
├── bin/
│   ├── flow-api.js              # CLI entry: login | status | test | serve | import-cookies
│   └── import-cookies.js        # standalone cookie import
├── src/
│   ├── server.js                # MCP server (stdio)
│   ├── browser.js               # Playwright + stealth init script
│   ├── flow.js                  # Flow UI automation
│   ├── tools/
│   │   └── index.js             # MCP tool definitions
│   └── utils/
│       ├── logger.js
│       └── downloader.js
├── data/
│   ├── chrome-profile/          # persistent Chrome profile (gitignored)
│   └── cookies-import.json      # last imported cookie dump
└── output/                      # generated images (gitignored)
```

## Safety

- **Your account, your data** — uses your own Chrome profile, no credentials ever leave your machine
- **No token export** — sessions are not copied, exported, or shared
- **Captcha-aware** — stops cleanly if Google challenges the session
- **No parallel abuse** — single browser context, one job at a time
- **Free tier friendly** — works on the free 50-credits/day plan

## Troubleshooting

| Problem | Fix |
|---|---|
| `AUTH_REQUIRED` | Run `npx flow-api login` |
| `CAPTCHA` | Open Flow manually in Chrome, solve the challenge, retry |
| `PROMPT_INPUT_NOT_FOUND` | Flow UI changed — re-run with headed=true to inspect |
| `GENERATE_BUTTON_NOT_FOUND` | Same as above |
| `GENERATION_TIMEOUT` | Free tier daily credits may be exhausted, or Google is throttling. Check `flow_status`. |
| HTTP 403 on generate | Make sure `USE_SYSTEM_CHROME=true` in `.env`. Bundled Chromium triggers anti-bot. |
| Browser won't start | Install Google Chrome from <https://google.com/chrome> |
| Stale session | Re-run `npx flow-api login` or `npx flow-api import-cookies <file>` |

## License

MIT
