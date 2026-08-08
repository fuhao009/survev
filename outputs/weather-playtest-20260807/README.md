# Weather playtest evidence

Date: 2026-08-07
Workspace: `/Volumes/RAID/survev`

## Runtime checks

- Local API started on `8000`.
- Local game server started on `8001`.
- Vite client started on `3000`.
- Fixed world weather calculation at capture time: `rain`, stable, intensity `0.65`, revision `280`.
- Existing real-game smoke capture shows the playable map, player, HUD, equipment and extraction UI.

## Screenshots

- `01-home.png`: fresh local client boot and world entry screen.
- `04-world-game-clear-hud.png`: real game world capture from the same local client, including map, player and HUD.
- `05-tab1.png`, `06-tab3.png`, `07-tab4.png`: repeated fresh-client checks; these remain entry screens and are not counted as in-game weather captures.

## Acceptance boundary

The code and automated weather tests cover rain/fog/thunderstorm presentation, terrain patches, lightning warning/active/expiry and indoor particle hiding. This run captured a real gameplay frame, but did not produce a clean browser screenshot of rain particles or an active lightning flash because the current Chrome multi-tab session did not complete the world-entry transition.
