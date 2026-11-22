# Changelog PAR-23

## 2026-11-22 PAR-23: the artist agent is idle only after its last chat save; three tests; prompt-size prose

Repo `pixel-art-generator`, branch `PAR-23_agent-tests-and-prose` (from master 2e0d3fc).

Files:
- `src/main/agent.ts`: the run's `finally` keeps the chat save and `done` delivery as a `settling` promise; `whenIdle()` waits while a run is going or settling.
- `src/main/headless.ts`: `stopAgent` waits at most 10 s for `whenIdle()` (timer cleared when it resolves, so it does not keep the process alive).
- `seed/config/providers.md:296`: about 34,000 tokens, context of at least 65536.
- `ROADMAP.md`: PAR-23 entry on top.
- `tests/main/agent.test.ts`: whenIdle waits for the gated save and `done` (P13).
- `tests/main/agentMcp.test.ts`: a start while the save is pending is refused, works after (P12).
- `tests/renderer/chatSync.test.ts` (new): a `start` event with a new chatId resets the transcript (P14).

Deviations: `chatSync.test.ts` has `/// <reference lib="dom" />` and `import type {} from '../../src/renderer/pixelStudio'` because `tsconfig.node.json` includes tests without DOM types. The headless timer is cleared in a `finally` (plan's one-liner would leave a 10 s timer).

Verification: `yarn test` 52 files / 540 tests pass (3 new; the two runner tests fail on master's agent.ts); `yarn typecheck` exit 0; `yarn lint` exit 0; `yarn build` exit 0; `git diff master -- src/llm` empty.
Not run: the Pixel window with a real MCP run; a real headless stop while a chat saves.

Commit status: committed on the branch (not merged, not pushed).
