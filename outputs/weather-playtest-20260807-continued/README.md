# Weather playtest evidence

Date: 2026-08-07
Workspace: `/Volumes/RAID/survev`

## Automated verification

- Full Vitest: **PASS** — 24 files, 11,463 tests.
- Repository lint: **PASS** — `pnpm lint:ci`.
- Client typecheck: **PASS** — `pnpm --dir client typecheck`.
- Client production build: **PASS** — `pnpm --dir client build`.
- Local API/game/client cold start: **PASS** — ports 8000, 8001, 3000 listened successfully.
- Post-restart localhost console check: **PASS** — no page error/warning entries.

## Real browser captures

- `01-home.png`: boot screen.
- `02-rain-world.png`: entered world; HUD says `天气：降雨`, and diagonal rain particles are visible across the playfield without covering the HUD.
- `03-fog-world.png`: entered world; HUD says `天气：浓雾`. The weather state and visual tone are present, but fog blobs are subtle against this map and are not counted as independently obvious particle proof.
- `04-thunderstorm-warning.png`, `05-thunderstorm-warning-window.png`, `07-thunderstorm-warning-precise.png`, `09-thunderstorm-warning-capture.png`: thunderstorm HUD/precapture frames. No unambiguous on-screen warning circle/bolt is counted because the deterministic target was outside the camera in these frames.
- `10-thunderstorm-flash-capture.png`: entered world; HUD says `天气：雷暴`, rain is visible, and the bright lightning flash/impact visual is clearly visible over the playfield.
- `13-home-after-restart.png`: clean post-restart boot screen; no residual in-game weather UI.

`06`, `08`, and `11`/`12` are intermediate captures. `11`/`12` were taken before the final service cold restart and are not acceptance evidence.

The screenshot backend captures this page at a high-DPI tiled viewport; the duplicated quadrants are capture scaling, while the central game viewport and HUD are still visible for visual inspection.
