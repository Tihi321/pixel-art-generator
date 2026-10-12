---
kind: roles
# Names that stand for a provider/model, usable in the role lists below. Change one here and every role that uses it follows.
aliases:
  lmstudio: lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp
  strata: strata/qwen3.8-flash-next
  cloud: deepseek/deepseek-flash
  claude: anthropic/claude-sonnet-5-5
roles:
  # The chat agent that edits the artwork through tools. The first available model is used, the rest are fallbacks.
  artist:
    models: [lmstudio]
  # Colour schemes from a prompt ("a moody 12-colour forest palette").
  palette:
    models: [lmstudio]
---
# Roles

A role is an ordered list of models: the first one that is available is used, and the router falls back to the next one when a request fails (after retries on 429, 5xx and timeouts). A model picked in the chat's model picker goes first.

- `artist`: the chat agent. It needs a model that is good at tool calling; models with `tools: false` in `providers.md` use the JSON-action fallback. The router only falls back to models with the same tool and vision support as the first one, because the mode is chosen for it.
- `palette`: palette generation and colour-scheme questions.

Entries are `provider/model` or an alias from the list above.
