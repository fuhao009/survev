# Survev gameplay smoke results

Generated on 2026-08-05T10:15:46.785Z.

## Verified flows

- Account register: success (SQLite-backed local auth).
- World enter: success with cookie-authenticated session.
- Move action: success, revision advanced.
- Fire action: success, AK47 durability dropped from 1000 to 999.
- Repair action: failed with `insufficient_points` as expected for a fresh account.
- Extract action: success, settlement finalized, wallet became 48.
- Damage-to-death: success, life status became dead.
- Re-enter after death: preserved dead state, no accidental respawn.

## Notes

- This is a backend/world smoke pass, not the full weapon-by-weapon or map-by-map live playthrough yet.
- Full inventory checklist is in `outputs/gameplay-test-inventory.md`.