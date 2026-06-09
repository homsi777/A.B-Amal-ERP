# Electron development workflow fix

## 1. Why `electron:dev` was not working

1. **`npm run electron:dev` ran only a Windows PowerShell script** (`electron-dev-all.ps1`) that required an SSH tunnel to `127.0.0.1:5433`, `db:tunnel:check`, then `electron:dev:stack`. That path fails if SSH/tunnel/`server/.env` is not exactly as expected, or if the developer only wanted a quick local stack from **`server/.env`** without the scripted tunnel.

2. **Electron `isDev` was tied only to `NODE_ENV === 'development'`**. Running `electron .` without setting `NODE_ENV` made `isDev` false, so the main process tried **`loadFile(dist/index.html)`** instead of the Vite URL → blank or missing UI in development.

3. **API base URL in the renderer**: for Electron + Vite HMR, `import.meta.env.PROD` is false, so the packaged-only fallback to `http://127.0.0.1:4010` did not apply. If `desktopApiBaseAtBoot` and localStorage were empty, **`getApiBaseUrl()` could return an empty string**, so the app did not talk to the local Fastify dev server.

4. **Vite was bound to `0.0.0.0` in `npm run dev`**, while Electron and wait logic used **`127.0.0.1`**. On some systems this is harmless; aligning to **`127.0.0.1`** avoids IPv6/localhost ambiguity with the existing comments in `main.ts` and `wait-and-launch.cjs`.

## 2. Files changed

| File | Purpose |
|------|---------|
| `package.json` | Added `dev:renderer`, `dev:server`, `dev:electron`; **`electron:dev`** runs `concurrently` (server + Vite + Electron); renamed tunnel script entry to **`electron:dev:windows-tunnel`**; `dev` / `dev:renderer` use `127.0.0.1:3000`; stack inner uses `dev:renderer`. |
| `electron/main.ts` | `isDev` includes **`ELECTRON_DEV=1`**; dev URL from **`VITE_DEV_SERVER_URL`** (default `http://127.0.0.1:3000`); dev-only startup logs. |
| `electron/wait-and-launch.cjs` | Passes **`ELECTRON_DEV=1`** and **`VITE_DEV_SERVER_URL`** to the Electron child (with `wait-for` messaging). |
| `src/lib/api/client.ts` | **Electron + non-PROD (Vite HMR)** → fallback **`http://127.0.0.1:4010`** when no higher-priority URL is set. |
| `scripts/electron-dev-all.ps1` | Header comment updated; script still runs **`electron:dev:stack`** (tunnel workflow). |

## 3. Scripts added / changed

| Script | Behavior |
|--------|----------|
| `dev:renderer` | `vite --host 127.0.0.1 --port 3000` |
| `dev:server` | `tsx watch server/src/index.ts` (same as `server:dev`) |
| `dev:electron` | `electron:compile` → `wait-on` (4010 `/api/health/live` + Vite 3000) → `electron .` with `NODE_ENV=development`, `ELECTRON_DEV=1`, `VITE_DEV_SERVER_URL` |
| **`electron:dev`** | `concurrently -k` → `dev:server` + `dev:renderer` + `dev:electron` |
| **`electron:dev:windows-tunnel`** | Former `electron:dev` PowerShell flow (tunnel + db check + `electron:dev:stack`) |

Unchanged for production: **`electron:build`**, **`electron:preview`**, embedded server packaging.

## 4. Dev command to use

```bash
npm run electron:dev
```

**Requirements:** valid **`server/.env`** (at least `DATABASE_URL`, `JWT_SECRET`, etc. per `server/src/config/env.ts`), **`npm run electron:compile`** runs automatically inside `dev:electron` before launch.

**Optional Windows tunnel + vps JSON stack (unchanged):**

```bash
npm run electron:dev:windows-tunnel
# or
npm run electron:dev:stack
```

## 5. Backend URL in dev

- **Fastify:** `http://127.0.0.1:4010` (default `PORT` from env; health probe: `GET /api/health/live`).
- Loads **`server/.env`** via existing `dotenv` in `server/src/config/env.ts` (non-embedded).

## 6. Vite URL in dev

- **`http://127.0.0.1:3000`**
- Electron loads **`VITE_DEV_SERVER_URL`** when set (defaults to the same).

## 7. Electron dev vs production loading

| Mode | Detection | Loader |
|------|-----------|--------|
| Dev | `NODE_ENV === 'development'` **or** `ELECTRON_DEV === '1'` | `mainWindow.loadURL(VITE_DEV_SERVER_URL \|\| http://127.0.0.1:3000)` |
| Production (packaged) | otherwise | `loadFile(…/dist/index.html)` |

`electron:build` / packaged EXE behavior is unchanged (no reliance on dev env vars).

## 8. Manual verification checklist (`npm run electron:dev`)

1. Backend listens on **4010**; `GET http://127.0.0.1:4010/api/health/live` returns OK.
2. Vite serves on **http://127.0.0.1:3000**.
3. Electron window opens; login UI loads from Vite (not blank `file://`).
4. Connection / health badge uses **local API**.
5. DB works per **`server/.env`** / tunnel (unchanged).
6. Edit a React file → HMR updates without `electron:build`.
7. Ctrl+C in the terminal stops **server + Vite + Electron** (`concurrently -k`).
8. **`npm run electron:build`** still succeeds (not altered by this task beyond scripts).

## 9. Automated test commands run

```text
npm run lint
npm run server:check
npm run test
npm run server:build
```

## 10. Automated test results

All of the following completed with **exit code 0** on the development machine:

- `npm run lint`
- `npm run server:check`
- `npm run test` (fabricInvoiceSummary tests passed)
- `npm run server:build`

**Note:** `npm run electron:dev` was not executed in this automated pass (requires interactive desktop / DB). Use §8 for manual checks.

## 11. Remaining risks

- **`dev:electron` runs `electron:compile` every time** `electron:dev` starts — a few seconds overhead; main/preload changes still require restart and recompile.
- **Concurrently `-k`**: stopping one process stops all (intended for Ctrl+C).
- **`electron:dev:windows-tunnel`** is a separate path; docs elsewhere that still say “`electron:dev` opens SSH” should be updated manually to **`electron:dev:windows-tunnel`** where appropriate.
- If **`desktopApiBaseAtBoot` / localStorage** points to a **non-loopback** API, that still **overrides** the dev fallback (by design).
