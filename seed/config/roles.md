---
kind: roles
# Names that stand for a provider/model, usable in the role lists below. Change one here and every role that uses it follows.
aliases:
  local: acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs   # through the ACP proxy (HUB-38); JSON-action mode, the proxy refuses tools for local models
  cloud: deepseek/deepseek-flash
  claude: anthropic/claude-sonnet-5-5
roles:
  # The chat agent that edits the artwork through tools. The first available model is used, the rest are fallbacks.
  artist:
    models: [local]
  # Colour schemes from a prompt ("a moody 12-colour forest palette").
  palette:
    models: [local]
---
# Roles

A role is an ordered list of models: the first one that is available is used, and the router falls back to the next one when a request fails (after retries on 429, 5xx and timeouts). A model picked in the chat's model picker goes first.

- `artist`: the chat agent. By default it runs on the local model (`local`) in JSON-action mode, because the proxy refuses tools for local models; a tool-calling model (cloud) can be picked in the chat. Models with `tools: false` in `providers.md` use the JSON-action fallback. The router only falls back to models with the same tool and vision support as the first one, because the mode is chosen for it.
- `palette`: palette generation and colour-scheme questions.

Entries are `provider/model` or an alias from the list above.
