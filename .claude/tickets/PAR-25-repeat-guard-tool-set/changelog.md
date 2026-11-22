# PAR-25 part A changelog

Branch `PAR-25_repeat-guard-tool-set`, one commit. Part B (Strata `vision: true`) not built.

## Failing first (old code)

A1, `tests/llm/agent.test.ts` "repeat guard: ..." (the same-picture block):

```
AssertionError: expected [ { model: 'mock', ... }, ... ] to have a length of 2 but got 4
 > tests/llm/agent.test.ts:453  expect(same.requests).toHaveLength(2)
```

A1, alternating block (the first block's assertions were stubbed out in a throwaway copy to reach it):

```
AssertionError: expected [ ... ] to have a length of 5 but got 7
```

A2, `tests/main/agentLlm.test.ts` appSettings (`agentToolSet` key missing from the read object):

```
AssertionError: expected { selectedModel: null, ... } to deeply equal { selectedModel: null, ... }
```

A2, `tests/main/agent.test.ts` no-files tool set:

```
AssertionError: expected [ 'get_document', 'draw_grid', ... ] to not include 'export_png'
```

All four pass after the code.

## Measured (`jsonModeInstructions`, throwaway test, not committed)

71 tools from `createDefaultRegistry().defs()`; all 10 `NO_FILES_TOOLS` names exist.

- all tools: 99,843 characters
- no-files: 84,101 characters
- difference: 15,742 characters (README says "about 15,700")

## Results

- `yarn test`: 52 files, 542 tests passed. `yarn typecheck`: exit 0. `yarn lint`: exit 0.
- New tests: 3 `it` (1 in tests/llm/agent.test.ts with three scenarios, 1 in tests/main/agent.test.ts, plus extra lines in the existing appSettings `it`).

## Deviations

1. `ResolvedModel.toolSet` in `src/main/llm.ts` is optional (`toolSet?: AgentToolSet`), not required as the plan says: the test doubles of `tests/main/agentMcp.test.ts` and `tests/main/headless.test.ts` return a `ResolvedModel` without it and failed typecheck. `resolveModel` always sets it.
2. README: `config/app.json` is not described anywhere in README.md or docs, so the `agentToolSet` paragraph is added at the end of "The artist agent over MCP", with the file list and one sentence on the repeat guard.
3. The alternating-host scenario sits in the same `it` as the plan says; to show its old-code failure (7 requests) the first scenario was bypassed in a throwaway copy of the test file (deleted).
