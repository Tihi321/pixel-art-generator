# Changelog PAR-21

## 2026-11-22 PAR-21: no local vision model, dead `lmstudio` alias removed

- Repo pixel-art-generator, branch `PAR-21_vision-rows` (from master).
- `seed/config/roles.md`: removed the unused `lmstudio` alias.
- `seed/config/providers.md`: comment above the Inkling row; `acp` paragraph says Pixel Studio has no local vision model and why, LM Studio optional; Strata paragraph no longer advises keeping the nomic model in LM Studio.
- `ROADMAP.md`: PAR-21 bullet.
- Deviations: none.
- Verification: B1 and B2 greps as specified (B1 prints nothing, B2 prints nothing and the count is 1); `yarn test` 50 files, 531 tests passed; `yarn typecheck`, `yarn lint`, `yarn build` exit 0; `git diff master --stat` lists the three files only.
- Not run: real token count of the JSON-action prompt (HUB-41 K1); live folder edit (HUB-41 L1).
- Commit: committed on the branch (not merged, not pushed).
