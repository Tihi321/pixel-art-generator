---
status: done
request: creative-hub/REQ-0030
repos: [pixel-art-generator]
branch: PAR-22_mcp-artist-agent
updated: 2026-11-22
---

# PAR-22 The artist agent over MCP: `start_agent_run`, `get_agent_run`, `stop_agent_run`, `list_models`

Hub ticket: creative-hub HUB-41 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-41-pixel-agent-and-small-ideas\plan.md`), request REQ-0030. The user said "yes mcp tool for artist agent", and on 2026-11-22 approved two additions ("Approve with both"): a stop tool, and a new chat by default over MCP. Reading built: the narrow one. Four MCP tools that start the existing chat agent (role `artist`), follow its run, stop it and list the models, in the window app and in headless mode (`--mcp-only`). No new agent behaviour: the same `AgentRunner`, the same `runAgent` loop, the same model choice, the same JSON-action mode for `tools: false` models.

Build after PAR-21 (`PAR-21_vision-rows`): cut this branch from the head of `PAR-21_vision-rows` if PAR-21 is not merged yet (else from master after that merge), so the two can be built back to back without a merge in between. Both tickets add a row to `ROADMAP.md`; PAR-21 is small and independent, so it goes first and this branch starts from it.

Honest size: 10 source files (1 new, about 240 lines; 9 edited, about 80 lines together), 3 test files (1 new, about 160 lines; 2 edited, about 55 lines), README and ROADMAP. Larger than the "about 6 files" guess: the stop tool adds about 25 lines to the new file, and the new-chat default needs a 1-line event field and a 5-line view sync in the window (C3).

## What the code does today (master 7874eca, read 2026-11-22)

- The MCP server (`src/main/mcp.ts`, class `McpHttpServer`) lists `host.tools()` (`:274-276`) and runs `host.execute(name, args, extra.signal)` (`:278-286`). Its host type is `McpHost` (`src/main/mcpContent.ts:6-8`): `tools()` and `execute()`.
- Window app: `src/main/index.ts:206` `startMcp(toolBridge, ...)`, then `:207` `registerAgentIpc(ipcMain, toolBridge)`. `startMcp` (`src/main/mcpApp.ts:33`) takes `bridge: ToolBridge` and hands it to `registerMcp(ipcMain, bridge, ...)` (`:51`), whose parameter is already an `McpHost` (`src/main/mcpSettings.ts:97`).
- `registerAgentIpc` (`src/main/agentIpc.ts:40-76`) makes the only `LlmService` (`:41`) and `AgentRunner` (`:46`); `emit` (`:42-44`) sends each `AgentUiEvent` to every `BrowserWindow`. Nothing else can start a run.
- Headless: `startHeadless` (`src/main/headless.ts:79-117`) builds the host with `createHeadlessHost` (`:59-63`, `createToolHost(registry, () => ({ session: documents.session, services, documents }))`) and has no LLM or agent. `runHeadless` (`src/main/index.ts:151-176`) calls it.
- `AgentRunner.send` (`src/main/agent.ts:146-155`) returns `{ ok: true, runId }` at once, refuses a second run while one is going (`:149`), streams `AgentUiEvent`s through `emit`, and sends `done` after the chat is saved (`:283-286`). `stop()` aborts the running turn and is a no-op when idle (`:158-160`); an aborted run keeps its work as one undo step (the turn ends without rollback, `:262`, and `tests/main/agent.test.ts:179-198`), and its messages stay in the conversation (`:267`, only `error` drops them). The abort reaches every wait of the run: `buildSystem(abort.signal)` and the check after it (`:232-235`), and the loop's `signal` (`:256`). `reset()` (`:163-167`) aborts a running turn and starts a new conversation (`convo = newConversation()`, a new `id`); it sends no event. `getState()` (`:136-138`) gives `running`, `runId`, `messageCount`, `chatId` (the conversation's id). `whenIdle()` (`:194-196`) waits on the run's `execute` promise (`:152`), which settles only after its `finally` (`:282-286`): `current = null`, the chat saved, then `done` delivered. So once `whenIdle()` resolves, every listener of `emit` has the run's `done`. Tests can replace the loop with `run` (`:108`).
- Chats are saved by `ChatHistoryStore` after every turn, from the runner (`save`, `:284`, `:289-292`; skipped only for a conversation with no events). The window's view of the chat is the renderer store `useChat` (`src/renderer/state/chat.ts`): `chatId` (`:21`) is set from `agent:getState` at start-up (`:194-198`), by New chat (`:133-141`, `agentApi.reset()` then `resetChat()`), open (`:151-159`) and delete (`:161-169`). The unsent text of the input box is the store's `draft` (`:19`), not part of `ChatState` (`chatReducer.ts:15-27`), so `resetChat()` does not touch it. Pushed events go through `applyEvent` (`chat.ts:182-189`); a `start` event adopts its `runId` and keeps the earlier transcript (`src/renderer/state/chatReducer.ts:60-65`, comment "A new run: keep the earlier transcript"). So in the window an MCP run shows up in the open chat like a typed message.
- The mode is chosen in `runAgent` from the first candidate's `tools` flag (`src/llm/agent.ts:199-218`): `tools: false` (every local row through the proxy, `seed/config/providers.md:136-167`) runs in JSON-action mode. With no available model `runAgent` ends with `error` "no available model for role "artist": check config/providers.md and the API keys" (`src/llm/agent.ts:202`). An unknown `modelRef` is skipped silently and the role's list is used (`src/llm/router.ts:75-83`).
- `LlmService.resolveModel` (`src/main/llm.ts:400-405`) returns `{ source, vision, ref }`; `overview()` (`:149-195`) returns providers, models (`LlmModelInfo`), `defaultModel` (the artist's first candidate) and `selectedModel` (from `config/app.json`). The registry is created lazily on first use (`:122-141`), so creating an `LlmService` costs nothing at start.
- `createToolHost` (`src/tools/registry.ts:270-296`): `beginTurn` and `endTurn` both call `ctxFactory().session`. In the renderer the session is fixed (`src/renderer/toolBridgeClient.ts:59`), but in headless it is `documents.session`, the current document. When the agent calls `new_document` during a run (the guide tells it to), `endTurn` ends the turn on the new document (a no-op, `src/tools/session.ts:221-223`) and the first document's turn stays open for good. Headless would hit this as soon as it runs the agent, so this ticket fixes it (task T1).
- The headless host has no `mutates` / `fingerprint`, so the PAR-16 result check (`src/llm/agent.ts:294-319`) would be off in headless. `ToolBridge` implements both (`src/main/toolBridge.ts:129-144`) with `isMutatingTool` (`src/tools/defs/reading.ts`) and the internal tool `canvas_fingerprint`. Task T3 gives the headless agent the same two functions, so both modes run the same loop.
- Existing tool names are lowercase `verb_noun` (`list_palettes`, `list_assets`, `get_document`, `get_asset`, `select_document`; `defineTool` enforces `/^[a-z_]+$/`, `src/tools/registry.ts:58`), and arguments are camelCase (`newLayer`, `exportTo`).
- `docs/llm-guide.md` is the agent's own system prompt (`GUIDE`, generated by `yarn gen:guide`). Do not list the agent tools there: the agent would read about itself. Document them in `README.md` only.

## Scope

1. Four MCP tools (contract C1), served next to the drawing tools in both modes. The agent itself never sees them (its host is the bridge, not the MCP host).
2. A per-run event log, bounded (contract C2).
3. One run at a time for the whole process, no queue; a new conversation per MCP request unless `continueChat: true`, with the window's chat view kept in sync (contract C3).
4. A time limit and a stop tool for runs (contract C3).
5. A clear error at once when no model can run (contract C4).
6. The headless agent: an `LlmService`, an `AgentRunner` with chats saved in `~/PixelStudio/chats`, the result check, and turns that end on the document they began on.
7. README section, ROADMAP row, tests.

## Out of scope

- A queue, several runs at once, a run pinned to a document id (the agent works on the current document, as in the chat).
- Any change to `runAgent`, the JSON-action mode, model choice, the guide, the stdio shim (`src/mcp-stdio/relay.ts` relays every message as it is: nothing to change). The chat panel changes only by the view sync of T4 (a new `chatId` on a `start` event clears the view); the reducer (`chatReducer.ts`) and `ChatPanel.tsx` are not changed.
- MCP prompts or resources for the agent.

## Contracts

### C1 The four tools (names, schemas, results)

All four are plain `ToolDef`s (`src/shared/tools.ts`) with hand-written JSON-schema `parameters`, `additionalProperties: false`. A result is one text item with a JSON object (like the other tools' JSON results); an error is `isError: true` with one text item.

```ts
start_agent_run: {
  description: 'Start the built-in artist agent (the chat agent of Pixel Studio) on a request and return at once with a run id. It draws on the current document with the same tools, as one undo step; follow it with get_agent_run, stop it with stop_agent_run. Each request starts a new conversation unless continueChat is true. One run at a time, shared with the chat panel. Local models run in JSON-action mode and take minutes.',
  parameters: { type: 'object', additionalProperties: false, required: ['text'], properties: {
    text: { type: 'string', minLength: 1, description: 'The request, as typed in the chat, e.g. "Draw a 16x16 red mushroom with white spots".' },
    model: { type: 'string', description: 'provider/model or an alias of roles.md (list_models shows them). Default: the model picked in the chat, else the artist role\'s first available model.' },
    continueChat: { type: 'boolean', description: 'Continue the current conversation, as the chat panel does (the agent sees the earlier messages). Default false: start a new conversation first; the earlier one stays saved in the chat history.' } } }
}
// result: {"runId":"<uuid>","model":"acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs"}

get_agent_run: {
  description: 'The state of an agent run: running or how it ended, the last events (steps, tool calls, results, errors), the reply, usage and cost. Runs are kept in memory (the last 20 of this Pixel Studio process).',
  parameters: { type: 'object', additionalProperties: false, required: ['runId'], properties: { runId: { type: 'string', description: 'The id start_agent_run returned.' } } }
}
// result: {"runId","state":"running"|"completed"|"max_steps"|"aborted"|"error","text","startedBy":"mcp"|"chat",
//          "startedAt","endedAt"?,"steps"?,"model"?,"usage"?,"costUsd"?,"reply"?,"error"?,"timedOut"?,"stoppedBy"?:"mcp",
//          "events":[...last 20 compact events],"droppedEvents":<n>}

stop_agent_run: {
  description: 'Stop an agent run and return its final state (as get_agent_run, plus stopped). What it drew so far is kept as one undo step, as with the Stop button of the chat. Works on a run started from the chat panel too. A run that has already ended is returned as it is, with stopped false.',
  parameters: { type: 'object', additionalProperties: false, required: ['runId'], properties: { runId: { type: 'string', description: 'The id start_agent_run (or get_agent_run) gave.' } } }
}
// result: {"stopped":true|false, ...the get_agent_run object}   (stopped true: this call stopped it; state then normally "aborted")

list_models: {
  description: 'The models the artist agent can use: default and selected model, and each model\'s ref, label, tools, vision, local and free flags. A model with tools false runs in JSON-action mode.',
  parameters: { type: 'object', additionalProperties: false, properties: {} }
}
// result: {"defaultModel","selectedModel","models":[{"ref","label","tools","vision","local","free","shown"}],"unavailable":<count>,"error"?}
```

- `list_models` maps `LlmService.overview()`: `defaultModel`, `selectedModel`, and the models whose `available` is true (fields above); `unavailable` counts the others; `error` is copied when the overview has one.
- `state` is `running` until the run's `done` event, then the `done` event's `reason`. `reply` is the text of the run's last `text` event (cut to 4000 chars). `usage`, `costUsd`, `steps`, `model`, `error` come from the `done` event.
- Unknown `runId` (in `get_agent_run` and `stop_agent_run`): error "Unknown run id <id>. Runs are kept in memory for the last 20 runs of this Pixel Studio process." Bad arguments (missing `text` or `runId`, wrong types, extra keys, the old name `newChat`): error naming the argument, like the registry's messages.

### C2 The run log (`AgentRunLog`)

- Fed by the runner's `emit` (every run, started from the chat or MCP). Keyed by `runId`.
- Keeps the last `MAX_RUNS = 20` runs; when a 21st starts, the oldest finished run is dropped (a running one is never dropped).
- Keeps the last `MAX_RUN_EVENTS = 50` events per run (`droppedEvents` counts the rest); `get_agent_run` returns the last 20.
- Compaction when an event is stored: `text` events of one run in a row merge into one (as `record` in `src/main/agent.ts:71-75`), cut to 2000 chars; `tool_call.args` becomes `argsJson` (`JSON.stringify`, cut to 300 chars); `tool_result.image` (a data URL of up to 3 MB) is dropped and `hasImage: true` set; `summary` stays (already at most 600 chars). The `done` event is kept whole (no image in it).
- Two flags set from outside the events: `markTimedOut(runId)` sets `timedOut: true` (the C3 time limit), `markStopped(runId)` sets `stoppedBy: 'mcp'` (`stop_agent_run`). Each is set before `runner.stop()` is called, so the entry carries it when the `aborted` `done` arrives. A stop with the window's Stop button sets neither (the runner cannot tell who called `stop()`); its entry is `aborted` with no flag.
- In memory only. Nothing is written by the log (the chat store still saves each conversation, as today).

### C3 One run at a time; new conversation; time limit; stop

- One `AgentRunner` per process. In the window app the chat panel and MCP share it; in headless MCP is its only user.
- `start_agent_run` while any run is going: error "The agent is busy with run <runId>. Wait for it with get_agent_run, or stop it with stop_agent_run." No queue. The chat panel gets the runner's existing message (`agent.ts:149`) when MCP holds the run.
- New conversation by default. Without `continueChat` (or with `false`), `start_agent_run` calls `runner.reset()` after the model check and before `runner.send` (the busy check before it means the runner is idle, so `reset()` aborts nothing). With `continueChat: true` there is no reset and the run continues the current conversation, as a message typed in the chat panel does. A failed model check (C4) returns before the reset, so a refused request never ends the current conversation.
- What a default reset does in the window app, when the Pixel window shows a chat:
  - Nothing is lost. The conversation on screen was saved by `ChatHistoryStore` after its last turn (`agent.ts:284`); it stays in the chat history and can be opened again. A conversation with no turn yet has nothing to save (`agent.ts:290`). The unsent text in the input box (`draft`) is kept: it is not part of `ChatState`.
  - Today the renderer would not learn about it: `reset()` sends no event, so the store keeps the old transcript and the old `chatId`, the MCP run's `start` would be appended under the old transcript (`chatReducer.ts:60-63`), and the history list would mark the old chat as current (`ChatPanel.tsx:58`). That view would be wrong. The smallest correct fix (T4): the `start` event carries the conversation's id, `chatId` (`src/shared/agent.ts:100` gets an optional `chatId?: string`; `agent.ts:217` sends `chatId: convo.id`), and the store's event handler (`chat.ts:182-189`), on a `start` whose `chatId` differs from `s.chatId`, first clears the view (`resetChat()`, `turn: null`), sets `chatId: ev.chatId`, then applies the event. A start in the same conversation (every chat-panel send, and `continueChat: true`) changes nothing. Saved chats replayed by `replayChat` are not affected (they go through the reducer, not this handler; old saved events have no `chatId`).
  - The window then shows the MCP run alone in a new chat. A message the user types next continues that conversation (it is the runner's current one); the user's earlier chat is one click away in the history.
- Headless always honours the default (no window; each request is its own job).
- A run started over MCP is stopped after `AGENT_RUN_TIMEOUT_MS = 30 * 60_000` (option `timeoutMs` for tests): if `runner.getState().runId` is still that run, `runs.markTimedOut(runId)`, then `runner.stop()`. It then ends `aborted`, keeping what was drawn as one undo step (the runner's policy). The timer is `unref()`ed and cleared when the run ends. Runs started from the chat have no time limit (unchanged). `MAX_AGENT_STEPS = 25` (`agent.ts:17`) still bounds every run.
- `stop_agent_run {runId}`, in this order:
  1. `runs.get(runId)` is undefined: the unknown-run error of C1, `isError`.
  2. the entry's `state` is not `running`: not an error; returns `{ stopped: false, ...view }` with its final state.
  3. `runner.getState().runId === runId`: `runs.markStopped(runId)`, `runner.stop()`, then `await runner.whenIdle()` raced against `STOP_WAIT_MS = 10_000` (timer `unref()`ed); returns `{ stopped: true, ...runs.get(runId) }`. Normally the state is then `aborted` with `stoppedBy: 'mcp'`.
  4. else (the entry still says `running` but it is not the runner's run: a run already aborted by `reset()` and finishing, a moment only): `{ stopped: false, ...view }`; nothing is called, so another run is never stopped by mistake.
  - Why wait for the end rather than return at once: one call then gives the caller the final state (`aborted`, steps, usage, the reply so far) with no polling, and the wait is short because the abort reaches every wait of the run (`agent.ts:232-235`, `:256`) and `whenIdle()` resolves only after `done` is in the log (`agent.ts:152`, `:282-286`). The 10 s cap only guards against a tool that ignores the signal; past it the result has `stopped: true` and `state` still `running`, and `get_agent_run` shows the end.
  - Yes, an MCP client may stop a run the chat window started: it is the same runner and the same one-run-at-a-time rule, the busy error hands MCP clients that run's id, and a hub job that finds the agent busy has no other way to free it (headless has no window, and in the window the user may be away). The window's Stop button can likewise stop an MCP run, so the two are symmetric. The window shows such a stop as any stop ("Stopped. What was drawn so far is kept (one undo step).", `chatReducer.ts:113`). The README says so.
  - A stopped run ends `aborted`, keeps what it drew as one undo step and keeps its messages in the conversation, exactly as the window's Stop (it calls the same `runner.stop()`).
- Known and kept: drawing calls another MCP client makes on the same document while a run goes become part of the run's undo step (the turn is open on that document). The README says to leave the document alone while the agent runs.
- Headless stop and handover: `stop()` and `POST /engine/handover` first call `runner.stop()` and `await runner.whenIdle()`, so the turn is closed before the documents are written or the server stops.

### C4 No model, wrong model

Before `runner.reset()` and `runner.send`, `start_agent_run` calls `LlmService.checkAgentModel(model)` (new, task T2):
- config cannot load: `{ ok: false, error: 'Could not set up the language models: <message>' }`
- `model` given but unknown, its provider off or unavailable: `{ ok: false, error: 'Model "<model>" is not available (unknown, or its provider is off or has no key). list_models shows the models that are.' }`
- no candidate for the artist (with `model`, else the saved selection): `{ ok: false, error: 'No model is available for the artist: check config/providers.md, roles.md and the API keys (list_models).' }`
- else `{ ok: true, ref }` (the first candidate's ref).
An error is returned as `isError` and no run starts (and the conversation is not reset). A run that fails later (the proxy is down, the model answers badly) ends `error` with the loop's message in `get_agent_run`.

## Files and modules to touch

| file | where (verified) | change |
|---|---|---|
| `src/main/agentMcp.ts` | new | `AgentRunLog` (C2), `AGENT_TOOL_DEFS` (C1), `createAgent()` (T2), `withAgentTools()` (C1, C3, C4) |
| `src/main/agentIpc.ts` | `:34-37` `AgentHandles`, `:41-46` | use `createAgent`; `AgentHandles` gets `runs: AgentRunLog` |
| `src/main/mcpApp.ts` | `:9`, `:33`, `:51` | `startMcp(host: McpHost, ...)` in place of `bridge: ToolBridge` |
| `src/main/index.ts` | `:206-207`, `:151-163` | window: agent first, then `startMcp(withAgentTools(toolBridge, agent))`; headless: pass `agent` |
| `src/main/headless.ts` | `:21-36` options, `:59-63`, `:79-117` | optional agent (T3) |
| `src/main/llm.ts` | after `resolveModel` `:400-405` | `checkAgentModel()` (C4) |
| `src/main/agent.ts` | `:217` | the `start` event carries `chatId: convo.id` (C3) |
| `src/shared/agent.ts` | `:100` | `start` event type gets `chatId?: string` |
| `src/renderer/state/chat.ts` | `:182-189` (`initChat`'s event handler) | a `start` with another `chatId` clears the view first (C3) |
| `src/tools/registry.ts` | `:286-294` | turn ends on the session it began on (T1) |
| `tests/main/agentMcp.test.ts` | new | T5 |
| `tests/main/headless.test.ts` | after the first `it` (`:21`) | T5 |
| `tests/tools/registry.test.ts` | next to the turn test (`:115-130`) | T5 |
| `README.md` | after `:46` (the `PIXEL_STUDIO_MCP_PORT` paragraph) | T6 |
| `ROADMAP.md` | above the `PAR-21` bullet in "Where it stands" | T6 |

## Tasks for workers

Commands (Bash; Node under fnm): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"`, then in `C:\projects\Personal\pixel-art-generator`: `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build`. Tests never call a real model (MockProvider or a fake `LlmService`).

**T1 `src/tools/registry.ts` `createToolHost`: a turn ends where it began.**
Input: `:270-296`. Keep a stack `const turnSessions: EditorSession[] = []` inside `createToolHost`. `beginTurn(label)`: `const s = ctxFactory().session; s.beginTurn(label ?? opts.turnLabel ?? 'Agent turn'); turnSessions.push(s)`. `endTurn(o)`: inside the existing `enqueue`, `(turnSessions.pop() ?? ctxFactory().session).endTurn(o)`. Nothing else changes. Output: the same `TurnToolHost`; the renderer (fixed session) behaves as before.

**T2 `src/main/agentMcp.ts` (new) and `src/main/llm.ts`.**
- `llm.ts`: add `async checkAgentModel(modelRef?: string | null): Promise<{ ok: true; ref: string } | { ok: false; error: string }>` per C4, using `this.get()`, `registry.resolve`, `registry.getModel`, `m.provider.available && m.provider.client`, and `router.candidates(AGENT_ROLE, { agentModel: modelRef ?? (await this.selectedModel()) })`.
- `agentMcp.ts`, no Electron import:
  - `export type AgentLlm = Pick<LlmService, 'resolveModel' | 'overview' | 'checkAgentModel'>`
  - `export class AgentRunLog` with `record(ev: AgentUiEvent): void`, `begin(runId: string, text: string, startedBy: 'mcp' | 'chat'): void` (idempotent; a `start` event also begins an entry with `startedBy: 'chat'` unless `begin` came first), `markTimedOut(runId)`, `markStopped(runId)` (sets `stoppedBy: 'mcp'`), `get(runId): AgentRunView | undefined` (C1 `get_agent_run` shape) and the bounds of C2 as exported constants `MAX_RUNS`, `MAX_RUN_EVENTS`.
  - `export interface AgentHandles { runner: AgentRunner; llm: AgentLlm; runs: AgentRunLog }` (move the interface here from `agentIpc.ts`, re-export it there).
  - `export function createAgent(o: { bridge: TurnToolHost; llm: AgentLlm; emit?: (ev: AgentUiEvent) => void; chats?: ChatHistoryStore; run?: typeof runAgent }): AgentHandles` builds `new AgentRunner({ bridge, guide: GUIDE, emit: (ev) => { runs.record(ev); o.emit?.(ev) }, resolveModel: (ref) => o.llm.resolveModel(ref), chats: o.chats, run: o.run })`. A throwing `o.emit` must not stop `runs.record` (record first).
  - `export const AGENT_TOOL_DEFS: ToolDef[]` (C1, in the order `start_agent_run`, `get_agent_run`, `stop_agent_run`, `list_models`), exported constants `AGENT_RUN_TIMEOUT_MS`, `STOP_WAIT_MS`, and `export function withAgentTools(host: McpHost, agent: AgentHandles, opts: { timeoutMs?: number; stopWaitMs?: number } = {}): McpHost`: `tools()` = `[...host.tools(), ...AGENT_TOOL_DEFS]`; `execute(name, args, signal)` handles the four names (validate args with a small zod object each, `.strict()`, messages via `formatZodError` from `src/tools/registry.ts`), everything else goes to `host.execute`.
  - `start_agent_run` order: text check; busy check (`runner.getState().running`, C3 message); `await agent.llm.checkAgentModel(model)` (error: return, nothing reset); `if (!continueChat) runner.reset()`; `runner.send({ text, modelRef: model ?? null })` (its own busy refusal covers a race); `runs.begin(runId, text, 'mcp')`; arm the C3 timer; return `{ runId, model: ref }`.
  - `stop_agent_run`: the four steps of C3, about 15 lines.
Output contract for T3/T4: `createAgent`, `withAgentTools`, `AgentHandles`, `AgentLlm`.

**T3 `src/main/headless.ts`: the agent in headless mode.**
- `HeadlessOptions` gets `agent?: { llm: AgentLlm; chatsDir?: string; run?: typeof runAgent; timeoutMs?: number }` (doc comment: "The artist agent and its MCP tools; absent: drawing tools only, as before").
- `createHeadlessHost` also returns its `registry`. In `startHeadless`, when `opts.agent` is set: the agent's bridge is the headless host plus `mutates: (n) => { const t = registry.get(n); return t ? isMutatingTool(t) : false }` and `fingerprint: async (signal) => { const r = await host.execute('canvas_fingerprint', {}, signal); const f = r.content[0]; return !r.isError && f?.type === 'text' ? f.text : null }` (the same as `ToolBridge`, `toolBridge.ts:129-144`; never throws: wrap in try/catch). `const agent = createAgent({ bridge, llm: opts.agent.llm, chats: opts.agent.chatsDir ? new ChatHistoryStore(opts.agent.chatsDir) : undefined, run: opts.agent.run })`; the server gets `withAgentTools(host, agent, { timeoutMs: opts.agent.timeoutMs })`.
- `Headless` gets `agent?: AgentHandles`; its `host` field is the host the server uses.
- `stopAll` and `handover` (C3): `agent?.runner.stop(); await agent?.runner.whenIdle()` first.

**T4 Wiring: `agentIpc.ts`, `mcpApp.ts`, `index.ts`; the chat id on `start`.**
- `agentIpc.ts:41-46` becomes: `const llm = new LlmService({ seedDir: resolveSeedConfigDir() })`, the window `emit` as today, `const { runner, runs } = createAgent({ bridge, llm, emit, chats: new ChatHistoryStore(join(llm.dataDir, 'chats')) })`; return `{ runner, llm, runs }`. The `ipc.handle` lines stay.
- `mcpApp.ts`: `startMcp(host: McpHost, opts ...)`; import `McpHost` from `./mcp`; drop the `ToolBridge` import if unused.
- `index.ts:206-207` become `const agent = registerAgentIpc(ipcMain, toolBridge)` then `startMcp(withAgentTools(toolBridge, agent), { blocked: engine.blocked, port: engine.port })`.
- `index.ts` `runHeadless` (`:155`): add `agent: { llm: new LlmService({ seedDir: resolveSeedConfigDir() }), chatsDir: join(defaultRoot(), 'chats') }` to the `startHeadless` options (`resolveSeedConfigDir` from `./agentIpc`, `LlmService` from `./llm`).
- `src/shared/agent.ts:100`: `| { type: 'start'; label: string; text: string; /** The conversation the run belongs to (absent in chats saved before PAR-22). */ chatId?: string }`.
- `src/main/agent.ts:217`: `send({ type: 'start', label, text, chatId: convo.id })`.
- `src/renderer/state/chat.ts:184-189`, inside `useChat.setState((s) => { ... })`, first line: `const base = ev.type === 'start' && ev.chatId && ev.chatId !== s.chatId ? { ...s, ...resetChat(), turn: null, chatId: ev.chatId } : s`, then `applyEvent(base, ev)` in place of `applyEvent(s, ev)` (the `done` branch keeps comparing with `s.runId`; a `start` returns `turn: null` as today). `resetChat` is already imported (`:8`). Nothing else in the renderer.

**T5 Tests (test-discipline: these five, nothing more; 3 and 5 are short).** Reuse `MockProvider` + the `mockChat` pattern of `tests/main/agent.test.ts:53-58` and the JSON-action replies of `tests/llm/agent.test.ts:249-258`; a fake `AgentLlm` whose `resolveModel` returns `{ source: { chat: mockChat(mock), capabilities: { tools: false, vision: false } }, vision: false }` (JSON-action mode, no real model, no network). The model's requests are in `mock.requests` (`tests/main/agent.test.ts:85`, `:208-215`).
1. `tests/main/agentMcp.test.ts` "start_agent_run returns a run id at once and get_agent_run follows it to the reply; a second start while it runs is refused; the next start begins a new conversation": a fake bridge like `makeBridge` (`tests/main/agent.test.ts:24-49`), mock replies `{"say":"Drawing","actions":[{"tool":"draw_grid","args":{}}],"done":false}` then `{"say":"Done: a red square","actions":[],"done":true}` with `chunkDelayMs` so the run is still going; assert the second start `isError` mentions the first run id; after `runner.whenIdle()`, `get_agent_run` has `state: 'completed'`, `reply: 'Done: a red square'`, a `tool_call` event for `draw_grid`, and no event with an `image` key. Then (third reply `{"say":"ok","actions":[],"done":true}`) one more `start_agent_run {text: 'again'}` without `continueChat`: after `whenIdle()`, `runner.getState().chatId` differs from the one before it, and the model's request of that run (`mock.requests` last) has exactly one `user` message (`'again'`) and no `assistant` message (a new conversation; the first run's messages are not sent). Also `list_models` maps a fake overview (only available models, `unavailable` count).
2. same file, "no model: an error at once and nothing runs; an unknown run id is an error": fake `checkAgentModel` returns `{ ok: false, error: 'No model is available for the artist: ...' }`; `start_agent_run` `isError`, `runner.getState().running` false; `get_agent_run {runId: 'nope'}` and `stop_agent_run {runId: 'nope'}` are both `isError` with the same text.
3. same file, "an MCP run stops at its time limit or with stop_agent_run, and the log keeps its bounds": `timeoutMs: 30` and a mock that never ends a turn in time (long `chunkDelayMs`); `get_agent_run` ends `aborted` with `timedOut: true`. Then, on a second `withAgentTools` over the same agent with the default time limit, start the same slow run and call `stop_agent_run {runId}`: the result has `stopped: true`, `state: 'aborted'`, `stoppedBy: 'mcp'`, no `timedOut`, and `runner.getState().running` is false; a second `stop_agent_run` on that id is not `isError` and has `stopped: false`, `state: 'aborted'`. Then a direct `AgentRunLog` check: 60 `step` events for one run keep 50 (`droppedEvents` 10, `events` 20 returned), and 21 finished runs keep 20 (the first one is gone).
4. `tests/main/headless.test.ts` "serves the agent tools, and a JSON-action run draws into the document and leaves one undo step": `startHeadless({ port: 0, services: createNodeServices(join(root, 'agent')), agent: { llm: fakeLlm } })` with mock replies that call a real drawing tool on the current document (`draw_grid` with valid args, see `tests/tools/registry.test.ts:118-123`) then end. Over the MCP client: `listTools` includes the four names; `new_document`; `start_agent_run`; poll `get_agent_run` until not `running` (at most 5 s); `completed`; `read_grid` shows the pixels; one `undo` clears them.
5. `tests/tools/registry.test.ts` "a turn ends on the document it began on when another document became current": a `createToolHost` over a `DocumentSet`; `beginTurn`; `new_document` (becomes current); `endTurn`; the first document's `session.turnActive` is false (the T1 regression test).
No test for the window's view sync (`chat.ts` is store code over the Electron IPC bridge with no test today; the reducer it calls is unchanged): it is covered by `yarn typecheck` and stays UNTESTED until the window is used (below). The existing `tests/main/agent.test.ts` and `tests/renderer/chatReducer.test.ts` stay green unchanged (`chatId` is optional; `toMatchObject` and the reducer's `start` fixture, `chatReducer.test.ts:11`, do not need it).

**T6 Docs.**
- `README.md`, after the `PIXEL_STUDIO_MCP_PORT` paragraph (`:46`), a new subsection:
  "### The artist agent over MCP\n\nFour tools start, follow and stop the built-in chat agent (role `artist`), in the window and in headless mode: `start_agent_run {text, model?, continueChat?}` returns a run id at once; `get_agent_run {runId}` gives the state (`running`, `completed`, `max_steps`, `aborted`, `error`), the last 20 events, the reply, usage and cost; `stop_agent_run {runId}` stops a run, waits for it to end (at most 10 seconds) and returns its final state with `stopped: true` (a run that had already ended comes back with `stopped: false`); `list_models` lists the models the agent can use (`tools: false` ones run in JSON-action mode). Each `start_agent_run` begins a new conversation unless `continueChat: true`, which continues the current one as the chat panel does. One run at a time, shared with the chat panel. In the window an MCP run shows in the chat: a new conversation clears the chat view first, and the conversation that was on screen stays saved in the chat history (nothing is lost, the text you were typing stays); what you type next continues the MCP run's conversation. `stop_agent_run` also stops a run started from the chat panel, and the window's Stop button also stops an MCP run. A run started over MCP is stopped after 30 minutes; a stopped run keeps what it drew as one undo step. Runs are kept in memory, the last 20. The agent works on the current document; while it runs, do not draw on that document or switch documents (other calls join the run's undo step). The tools are not in `docs/llm-guide.md`, which is the agent's own prompt."
- `ROADMAP.md`, a bullet above `- **PAR-21**`:
  "- **PAR-22** (2026-11-22, branch `PAR-22_mcp-artist-agent`; creative-hub HUB-41, REQ-0030): the artist agent over MCP in the window and headless: `start_agent_run` (returns a run id at once; a new conversation unless `continueChat`), `get_agent_run` (state, last events, reply, usage), `stop_agent_run` (stops a run, also one started from the chat, and returns its final state) and `list_models`; one run at a time, shared with the chat; MCP runs stop after 30 minutes; the `start` event carries the chat id so the window's chat view follows a new MCP conversation; headless gets the agent, its saved chats and the result check, and a turn ends on the document it began on. Live check UNTESTED (hub K1)."

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| A1 | `tools/list` has `start_agent_run`, `get_agent_run`, `stop_agent_run`, `list_models` in headless | T5 test 4 |
| A2 | start returns a run id at once; status follows it to `completed` with the reply; no image data in events | T5 test 1 |
| A3 | one run at a time: a second start is refused with the running id | T5 test 1 |
| A4 | no model: an error at once, nothing runs; an unknown run id is an error for `get_agent_run` and `stop_agent_run` | T5 test 2 |
| A5 | MCP runs stop at the time limit (`aborted`, `timedOut`); the log keeps 20 runs and 50 events per run | T5 test 3 |
| A6 | `stop_agent_run` stops the run (`stopped: true`, `aborted`, `stoppedBy: 'mcp'`); on an ended run it returns `stopped: false`, not an error | T5 test 3 |
| A7 | `start_agent_run` without `continueChat` starts a new conversation (new `chatId`, the model gets no earlier messages) | T5 test 1 |
| A8 | headless JSON-action run draws on the document as one undo step | T5 test 4 |
| A9 | a turn ends on its starting document | T5 test 5 |
| A10 | the window app still builds and its MCP still lists the drawing tools (71) | `yarn test` (`tests/mcp/server.test.ts:147`, `tests/mcp/stdio.test.ts:34` unchanged), `yarn build` |
| A11 | suite, types, lint green | `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build` exit 0 |
| A12 | JSON-action mode untouched | `git diff master -- src/llm` is empty |

## UNTESTED (stays so until the hub's live check)

- A real artist request over MCP on a local model (`acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` through the proxy, JSON-action mode), and `stop_agent_run` on a real run: hub HUB-41 K1, with the user's go-ahead.
- The window app's wiring (Electron: `registerAgentIpc` + `startMcp` with the wrapped host, an MCP run shown in the open chat, the chat view cleared when an MCP run starts a new conversation while the window shows a chat, `stop_agent_run` on a run typed in the chat). No Electron test is added.
- Headless `LlmService` with the real `resolveSeedConfigDir()` in a packaged build.
