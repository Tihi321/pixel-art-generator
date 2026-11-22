# Changelog

## 2026-11-22 PAR-20 (REQ-0030, creative-hub HUB-40)
Seed prose now names `D:\Strata\terminal` as the folder of the Strata `run-*.bat` scripts.

- Repo pixel-art-generator, branch `PAR-20_extra-ideas`.
- `seed/config/providers.md`: line 291 path changed from `D:\Strata` to `D:\Strata\terminal`.
- `ROADMAP.md`: PAR-20 bullet above PAR-19.
- Deviations: none.
- Verification: `yarn test` 531 passed (50 files); `yarn typecheck` exit 0; `ls D:/Strata/terminal/run-*.bat` lists 4 files.
- Untested: nothing (prose only).
- Commit: committed on the branch, not merged or pushed.
