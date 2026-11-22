---
status: done
request: creative-hub/REQ-0030
repos: [pixel-art-generator]
branch: PAR-21_vision-rows
updated: 2026-11-22
---

# PAR-21 Pixel's vision rows: no local vision model, the dead `lmstudio` alias goes

Hub ticket: creative-hub HUB-41 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-41-pixel-agent-and-small-ideas\plan.md`), request REQ-0030. The user said "yes vision rows lm studio recomendation". The recommendation was to move Pixel's vision rows from `lmstudio` to `acp/llama/inkling-2-mini`, as VN, Edu and Cartoon did in HUB-39, if Inkling can serve the role. It cannot (below), so this ticket makes the smallest honest change: the seed stops naming LM Studio for a vision job, says that Pixel Studio has no local vision model and why, and drops the stale embedding sentence.

Build this ticket first, then PAR-22 (`PAR-22_mcp-artist-agent`, cut from master after this merge). Both add a `ROADMAP.md` row; this one is seed prose only and merges fast.

## What "vision" does in Pixel Studio (master 7874eca, read 2026-11-22)

- There is no vision role. `seed/config/roles.md` has two roles, `artist` and `palette`, both `[local]` (`:10-15`). The alias `lmstudio: lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp   # tools and vision, for the model picker (a chat with an image)` (`:6`) is named by no role. Aliases are used only by `registry.resolve` (`src/llm/registry.ts:592`); the chat's model picker lists `provider/model` refs from `models.md`, never aliases. The chat has no image attachment. So the alias is dead.
- `vision: true` on a model only changes the artist's run: after each drawing tool the result gets a `render_preview` image (`withAutoPreview`, `src/main/agent.ts:40-61`), and the first message carries up to 4 style reference images (`:249-253`). In JSON-action mode these images go to the model as user-message parts (`src/llm/agent.ts:367-375`). No image is ever dropped from the history.
- The agent sends no `max_tokens` (`src/main/agent.ts:245-258` passes none; `src/llm/openaiCompat.ts:135` sends it only when set).

## Can Inkling serve it? No.

- Inkling (`acp/llama/inkling-2-mini`, `seed/config/providers.md:158-162`) is `tools: false`, so the artist would run in JSON-action mode. That mode puts the whole guide and every tool with its JSON schema in the system prompt (`jsonModeInstructions`, `src/llm/agent.ts:103-116`). Measured on master with `node_modules/.bin/tsx` (reading the registry, no model): the tool list is 99,076 characters for 71 tools; the guide (`docs/llm-guide.md`) is 20,041 characters. About 119,000 characters before the document summary and the request: at 3 to 4 characters per token, 30,000 to 40,000 tokens.
- Inkling's context is 32768 (`providers.md:160`; the proxy's llama profile, n_ctx 32768). The prompt alone fills it or overflows it before the first preview image and the reply.
- On top of that: thinking cannot be switched off (only shortened with `chat_template_kwargs`), it runs at about 8 to 10 tokens per second, and HUB-39 needed 2000 tokens of answer room for one JSON verdict. One artist step (thinking plus a `draw_grid` action) would take minutes, and a 25-step run would carry a growing pile of preview images.
- The token count is an estimate from characters. The hub's live check HUB-41 K1 (an artist run over MCP on Strata, after PAR-22) reads the real input tokens of the first step; if they are well under 30,000, this verdict is reopened in a new ticket.

## Scope

- `seed/config/roles.md`: remove the dead `lmstudio` alias.
- `seed/config/providers.md`: the `acp` paragraph says Pixel Studio has no local vision model and why; a comment on the Inkling rows says the same; the Strata paragraph drops "keep only the nomic embedding model in LM Studio" (LM Studio is not installed; Pixel Studio has no embeddings).
- `ROADMAP.md` row.

## Out of scope

- The `lmstudio` provider and its rows (`providers.md:10-37`): they stay, enabled, for anyone who runs LM Studio (the seed tests rely on them: `tests/llm/registry.test.ts:48-49,59,78,82`, `tests/main/agentLlm.test.ts:41`).
- `extra_body` on Pixel's Inkling rows (nothing in Pixel uses them).
- Any code, any migration. The live folder `C:\Users\Infplane\PixelStudio\config` is changed by the hub (HUB-41 L1), not by this ticket.
- The "about 8000 tokens" sentence of `providers.md:295` (probably stale; measured by HUB-41 K1 first).

## Files to touch (lines verified on master 7874eca)

**`seed/config/roles.md:6`**: delete the whole line
`  lmstudio: lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp   # tools and vision, for the model picker (a chat with an image)`

**`seed/config/providers.md:158`**: insert one comment line above `      - id: llama/inkling-2-mini` (same indent as the row's `-`):
`      # Inkling sees images, but its 32768 context is smaller than the artist's JSON-action prompt (the guide and every tool schema, about 119,000 characters): not usable for the artist (HUB-41).`

**`seed/config/providers.md:274`**, the last sentence of the `acp` paragraph. Old:
"LM Studio stays for the vision rows only (a chat with an attached image, picked in the model picker); the `strata` provider is off (its code stays), Strata runs under the proxy."
New:
"Pixel Studio has no local vision model: the `llama/inkling-*` rows see images, but their 32768 context is smaller than the artist's JSON-action prompt (the guide and every tool schema). LM Studio is optional: its provider stays for a model you run there, and no role or alias names it. The `strata` provider is off (its code stays), Strata runs under the proxy."

**`seed/config/providers.md:291`**, the last sentence of the Strata paragraph. Old:
"Strata takes most of the GPU memory with any of them: keep only the nomic embedding model in LM Studio and no ComfyUI while it runs."
New:
"Strata takes most of the GPU memory with any of them: no ComfyUI while it runs."

**`ROADMAP.md`**, a bullet above `- **PAR-20**` in "Where it stands":
"- **PAR-21** (2026-11-22, branch `PAR-21_vision-rows`; creative-hub HUB-41, REQ-0030): no local vision model. Inkling (`acp/llama/inkling-2-mini`) sees images but its 32768 context is smaller than the artist's JSON-action prompt (about 119,000 characters of guide and tool schemas), so the seed drops the unused `lmstudio` alias, says so in `providers.md`, and no longer says to keep the nomic model in LM Studio. Prose and seed only."

## Tasks for workers

One task (seed and ROADMAP edits above, verbatim). Find each place by its text; the line numbers are from master 7874eca.

Commands (Bash; Node under fnm): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"`, then in `C:\projects\Personal\pixel-art-generator`: `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build`. No new test: the seed test `tests/llm/registry.test.ts:46` ("providers.md and roles.md load; roles resolve to existing models") proves the seed still loads and both roles resolve.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| B1 | no `lmstudio` alias in the seed roles | `grep -n "lmstudio" seed/config/roles.md` prints nothing |
| B2 | the seed says why there is no local vision model; no LM Studio embedding advice | `grep -n "nomic embedding model in LM Studio\|vision rows only" seed/config/providers.md` prints nothing; `grep -c "no local vision model" seed/config/providers.md` is 1 |
| B3 | seed still loads, roles resolve | `yarn test` (includes `tests/llm/registry.test.ts:46`) |
| B4 | nothing else changed | `git diff master --stat` lists `seed/config/roles.md`, `seed/config/providers.md`, `ROADMAP.md` only; `yarn typecheck`, `yarn lint`, `yarn build` exit 0 |

## UNTESTED

- The real token count of the JSON-action prompt (HUB-41 K1 reads it from the first step's input tokens).
- The live folder edit (HUB-41 L1) and the app loading it (HUB-41 K1 `list_models` shows no error).
