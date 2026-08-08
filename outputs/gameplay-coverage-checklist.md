# Survev gameplay coverage checklist

Generated on 2026-08-05.

## Inventory

- Weapons:
  - Guns: 74
  - Melees: 46
  - Throwables: 16
- Maps: 21
- Point lists: covered by map definitions in `outputs/gameplay-test-inventory.md`

## Verified

- [x] Local auth register/login
- [x] Session-authenticated account profile
- [x] User center navigation
- [x] World enter
- [x] Move action
- [x] Fire action
- [x] Repair action rejection on low points
- [x] Extraction settlement
- [x] Death state
- [x] Re-enter after death keeps dead state
- [x] Weapon durability behavior
- [x] Map definitions and point definitions
- [x] Terrain / lightning / world mechanic regression suite
- [x] Chinese localization coverage

## Test evidence

- Backend smoke: `outputs/gameplay-smoke-results.md`
- Inventory checklist: `outputs/gameplay-test-inventory.md`
- Vitest: 20 files, 11,441 tests passed

## Current status

- Full automated regression suite: passed
- Manual world smoke: passed
- Remaining gap: per-item live playthrough for every single weapon/map point is not yet individually recorded in a human-play log
