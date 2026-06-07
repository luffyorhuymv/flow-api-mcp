# NOTES — flow-api-mcp

Ghi chú quá trình code + sửa lỗi cần nhớ cho project `D:\code\flow api`.

## Quá trình chính

### Phase 1 — Khởi tạo & browser automation
- Node.js + Playwright + MCP SDK 1.29.0
- ES modules (`"type": "module"`)
- Chrome system channel (`USE_SYSTEM_CHROME=true`) — bundled Chromium bị 403 từ `aisandbox-pa.googleapis.com`
- Stealth init: ẩn `navigator.webdriver`, fake `chrome.runtime`, plugins, languages

### Phase 2 — Login & cookies
- `flowLogin` headed để user đăng nhập thủ công
- Export cookies qua Cookie-Editor extension → `data/cookies-import.json`
- `bin/import-cookies.js` import 73 cookies (filter domain, convert format)
  - 3 `__Host-` cookies skip (vi phạm host-only rules)
  - 1 cookie skip domain khác
  - 69 cookies thành công

### Phase 3 — Generate image (đã chạy OK)
- Slate.js editor: phải dùng `selectNodeContents` + `Delete` + `keyboard.type(delay)` (không được `textContent=''`)
- Generate button: target `button:has(i:text("arrow_forward"))` tránh button "Add Media"
- Polling `<img>` UUIDs mới cho từng ảnh

### Phase 4 — MCP stdio
- `bin/test-mcp.js` roundtrip: initialize → tools/list → flow_status → generate_image → flow_close ✓
- Output 8 ảnh ~1MB/ảnh

### Phase 5 — HTTP transport (StreamableHTTPServerTransport SDK 1.29.0)
- `src/http.js` default `127.0.0.1:5555`
- Stateful session theo `Mcp-Session-Id` header
- `bin/test-http-inline.js` chạy 4 ảnh 4:3 trong 57.6s
- Bearer auth optional (`HTTP_AUTH_TOKEN` env)
- `Dockerfile` (Linux + Chrome + xvfb) + `docker-compose.yml`

### Phase 6 — Cookie importer HTTP endpoints
- Refactor logic vào `src/cookie-importer.js` (pure functions: `filterAndConvert`, `convertCookie`, `parseCookieFile`, `importCookiesIntoContext`, `getCookieStatus`)
- `POST /admin/import-cookies` (Bearer, JSON body, 5MB limit)
- `GET /admin/cookie-status` (session validity, expiry days, count)
- `GET /health` cũng trả cookie status
- `bin/test-admin.js` verify tất cả endpoints

### Phase 7 — GitHub
- Repo `luffyorhuymv/flow-api-mcp` (public, branch `main`)
- 4 commits: initial, HTTP transport, log cleanup, admin endpoints

### Phase 8 — Video research (đang làm)
- User có **PRO plan** (badge "PRO" trên header)
- Tìm thấy video models: **Veo 2/3/3.1 + Gemini Omni** (chỉ trong storyboard workflow)
- Storyboard là **multi-step agent workflow**:
  1. Click "Develop a storyboard" chip
  2. Gửi prompt vào chat
  3. Agent phân tích → trả scene list
  4. User duyệt (hoặc Settings → "Never" để auto)
  5. Agent gọi Veo cho từng scene
  6. Output: N video .mp4
- Thời gian: 1-5 phút/video

## Lỗi đã sửa — cần nhớ

### Chrome profile lock
- **Vấn đề**: `data/chrome-profile/SingletonLock` bị lock khi Chrome chưa đóng → lần launch sau dùng context rỗng
- **Triệu chứng**: cookies import thành công, status OK, nhưng session bị mất giữa các run
- **Fix**: luôn `await closeBrowser()` trong `try/finally` + signal handler (xem `bin/cleanup.js`)

### OAuth redirect wipe cookies
- **Vấn đề**: Khi session hết hạn thật, Google redirect tới `accounts.google.com/v3/signin` → Chrome OAuth flow xóa `__Secure-next-auth.session-token`
- **Triệu chứng**: Profile từ 68 cookies xuống còn 9
- **Fix**: `/admin/import-cookies` để re-import; check `getCookieStatus` trước mỗi job
- **Không phải bug code** — đây là behavior của Google

### Slate.js không nhận text
- **Vấn đề**: `textContent = '...'` không trigger React state update
- **Fix**: `selectNodeContents()` + `Delete` + `keyboard.type(..., { delay: 30 })`

### Generate button nhầm "Add Media"
- **Vấn đề**: `button:has-text("Create")` cũng match button "Add Media" (cùng icon add_2)
- **Fix**: target icon cụ thể: `button:has(i:text("arrow_forward"))`

### Polling `waitForFunction` không support pseudo-selector
- **Vấn đề**: `:has()` và `:text()` là Playwright pseudo-selectors, không có trong DOM standard
- **Fix**: dùng polling loop với `btn.evaluate(...)` thay vì `page.waitForFunction`

### `getCookieStatus` nhận context không phải array
- API sai: phải truyền `BrowserContext`, không phải `cookies[]`

## Tại sao phải kill Chrome mỗi lần

**Nguyên nhân gốc**: Script test/research trước đây KHÔNG cleanup browser → process Chrome vẫn sống → SingletonLock còn trong profile → lần sau Playwright mở context mới (rỗng) thay vì persistent.

**Cách fix (đã làm)**:
- Mọi script trong `bin/` giờ dùng pattern:
  ```js
  const browser = getBrowser(config);
  try {
    await browser.launch({ headed: false });
    // ... do stuff
  } finally {
    await closeBrowser();
  }
  ```
- Signal handler `process.on('SIGINT')` và `process.on('uncaughtException')` → gọi `closeBrowser()` rồi exit
- Nếu vẫn stuck (crash cứng), chạy `node bin/cleanup.js` để:
  - Kill tất cả Chrome process của profile
  - Xóa `SingletonLock`, `LOCK`, `LOCKFILE` trong `data/chrome-profile/`

**Không cần** kill Chrome thủ công giữa các run nữa nếu script có cleanup đúng.

## Files quan trọng

| File | Vai trò |
|---|---|
| `src/browser.js` | Persistent Chrome + stealth |
| `src/flow.js` | Image automation (Slate.js + arrow_forward) |
| `src/handler.js` | Shared `handleToolCall`, `buildConfig`, `toolDefinitions` |
| `src/http.js` | HTTP server `/mcp` + `/health` + `/admin/*` |
| `src/cookie-importer.js` | Pure import logic + status check |
| `bin/flow-api.js` | CLI dispatcher |
| `bin/import-cookies.js` | CLI import wrapper |
| `bin/test-mcp.js` | MCP stdio roundtrip test |
| `bin/test-http-inline.js` | In-process HTTP test |
| `bin/test-admin.js` | Admin endpoints test |
| `bin/cleanup.js` | Kill Chrome + remove profile locks |
| `bin/research-*.js` | Ad-hoc research scripts (debug) |

## Models & aspects (cập nhật 2026-06-07)

### Image (đã support)
- Models: `nano-banana-2`, `nano-banana-pro`, `imagen-4`
- Aspects: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
- Free tier: 50 credits/ngày

### Video (chưa support — research thấy)
- Models: `veo-2`, `veo-3`, `veo-3.1`, `gemini-omni`
- Workflow: storyboard chat-based (multi-step agent)
- Aspects: `16:9`, `9:16` (chưa verify hết)
- User trên **PRO plan** — full access

## Endpoints hiện có

| Path | Method | Auth | Mô tả |
|---|---|---|---|
| `/mcp` | POST/GET/DELETE | Bearer | MCP streamable HTTP |
| `/health` | GET | Bearer | Service + cookie health |
| `/admin/cookie-status` | GET | Bearer | Session expiry detail |
| `/admin/import-cookies` | POST | Bearer | Import Chrome cookies JSON |

## Tính năng còn lại (backlog)

- [ ] **Video generation** (storyboard workflow) — đang làm
- [ ] Auto-reload cookies từ URL backup (cron)
- [ ] Telegram bot (skipped — dùng HTTP thay)
- [ ] Cloudflare Tunnel setup guide trong README
- [ ] Credits usage tracking (xem `aisandbox` API)
- [ ] Webhook callback khi generation xong
- [ ] Video polling cho từng scene (sau khi implement storyboard)

## Tài khoản & repo

- Google: `haowama240@gmail.com`
- GitHub: `luffyorhuymv`
- Repo: https://github.com/luffyorhuymv/flow-api-mcp (public, branch `main`)
- Plan: Google AI Pro (PRO badge)
