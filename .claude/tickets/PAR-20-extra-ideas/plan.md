---
status: in-progress
request: creative-hub/REQ-0030
repos: [pixel-art-generator]
branch: PAR-20_extra-ideas
updated: 2026-11-22
---

# PAR-20 Seed prose: the Strata scripts are in `D:\Strata\terminal`

Part of creative-hub HUB-40 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-40-extra-ideas\plan.md`, idea 6 of REQ-0030). One line of seed prose; no behaviour change.

## Scope

`seed/config/providers.md:291`: the folder the `run-*.bat` scripts are in. Checked on disk 2026-11-22: `D:\Strata\terminal\run-unsloth-ud-iq4_xs-parallel.bat`, `run-unsloth-ud-iq4_xs.bat`, `run-deepseek-v4.1-flash-ist-das-2.00bpw.bat`, `run-deepseek-v4.1-flash-ista-das-coder.bat`; none is in `D:\Strata` itself. ROADMAP row.

## Out of scope

- Anything else in line 291 or the seed (for example its LM Studio sentence), Pixel's vision rows, an MCP tool for the artist agent (both are user decisions in the hub plan).
- The live data folder `C:\Users\Infplane\PixelStudio`.

## Files and modules to touch (verified on master, 2026-11-22)

- `seed/config/providers.md:291`: "chosen by the `run-*.bat` you start in `D:\Strata`:" becomes "chosen by the `run-*.bat` you start in `D:\Strata\terminal`:". Nothing else in the line changes.
- `ROADMAP.md`: a bullet directly above the PAR-19 bullet (line 10), same style:
  `- **PAR-20** (2026-11-22, branch `PAR-20_extra-ideas`; creative-hub HUB-40, REQ-0030): the seed names `D:\Strata\terminal` as the folder of the Strata scripts. Prose only.`

## Tasks for workers

One task: the two edits.

## Acceptance criteria and the command that proves each

Commands (Bash): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"; cd /c/projects/Personal/pixel-art-generator`, then `yarn test`, `yarn typecheck`.

| # | criterion | proof |
|---|---|---|
| A1 | The seed's Strata path exists on disk | `grep -n "you start in" seed/config/providers.md` shows `D:\Strata\terminal`; `ls D:/Strata/terminal/run-*.bat` lists four files |
| A2 | Nothing else changed | `git diff --stat` shows two files; `yarn test` and `yarn typecheck` pass (seed tests read this file) |

## UNTESTED

Nothing (prose only).
