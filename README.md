# llm connect

In-browser LLM integration with tool use for TiddlyWiki.

Connect TiddlyWiki to Claude, OpenAI, Azure, and other LLM APIs — the wiki acts as the orchestrator: sends prompts, receives tool calls, executes them against `$tw.wiki`, and returns results. No server required.

## Key features

- **Two modes** — interactive chat (multi-turn, tool use) and one-shot actions (context template → LLM → output target)
- **Pair editing** — toolbar button opens an embedded chat panel on any tiddler for collaborative editing with the LLM
- **Named connections** — any number of connections, each with a type (Claude, OpenAI, Azure OpenAI, or a self-hosted OpenAI-compatible server such as llama.cpp, vLLM, Ollama, LM Studio), its own endpoint, model and API key; one is the default. Extensible for other providers
- **Dynamic model selection** — fetch available models from provider APIs; per-chat connection and model selector, locked once the conversation has started
- **Tool system** — built-in tools for searching, reading, navigating, and modifying tiddlers; user-defined tools via wikitext
- **Model tier routing** — assign cost tiers (cheap/default/expensive) to tools; cheap and expensive models are set per connection and only switch the model within the chat's own connection
- **Per-chat tool selection** — wrench icon opens a dropdown to toggle individual tools per chat; tool groups as quick presets
- **Multimodal context** — attach PDFs, images, and text tiddlers to conversations via a context filter; binary files are fetched, base64-encoded, and sent inline to the LLM
- **Context templates** — wikitext templates that render input for the LLM from one or more source tiddlers
- **Output targets** — write LLM responses to fields, new tiddlers, or just display in chat
- **Debug panel** — toggle a live preview of the request payload or inspect the last sent request; base64 data abbreviated for readability
- **Resizable chat** — drag the chat panel edges or the chat history resize handle to adjust layout
- **Tiddler protection** — allow/deny modes with restricted wiki proxy. Default: allow mode (whitelist) — LLM has no access until you define an allow filter. Deny mode (blacklist) hides matched tiddlers. Per-chat mode and filter overrides via shield icon; widget-level `allowFilter`/`denyFilter` attributes for recipe panels
- **Audit logging** — write operations (set-field, create, delete) execute immediately with an audit log

## Prerequisites

- A connection to at least one supported provider: an API key (Claude, OpenAI, Azure OpenAI), or the endpoint of a self-hosted OpenAI-compatible server
- A modern browser (async/await support)
- rimir/theme 0.1.10+ (settings page layout)

## Quick start

1. Install the plugin and add a connection in Settings > Connections
2. Open the chat from the page toolbar button
3. Ask a question — the LLM can search and read your wiki via tools
4. Click the pair-edit button in any tiddler's toolbar to start a collaborative editing session

For one-shot actions, add a button to any tiddler:

```
<$button>
  Summarize
  <$llm-action
    tiddler=<<currentTiddler>>
    prompt="Summarize the most important points in 3 bullets."
    connection="Claude"
  />
</$button>
```

The optional `connection` attribute names a connection (id or name); without it the default connection is used. The older `provider` attribute takes a provider type and maps to a connection of that type: the default connection if it has that type, else the first of that type by name.

## Settings

Six tabs: **Connections** (add, edit and delete connections, fetch models; pick the default), **Routing** (tier routing switch), **Safety** (protection modes and filters), **Files** (attachments and document extraction), **Prompt** (system prompt, context template), **Tools** (tool list and groups).

## Security

API keys are stored per connection in `$:/config/rimir/llm-connect/keys/<id>`. llm-connect hides them itself, without any tag: the protection filter excludes them in every mode as its very last run (no user filter or llm-help grant can re-allow them), no tool may name a title under the key prefix (read or write), and key tiddlers are never sent as context (not as `llm-context` / chat context attachments, not as pair-edit source).

## Upgrading from 0.1.56

0.1.57 replaces the one-config-per-provider model with named connections. Existing provider config tiddlers are no longer read, so convert them once (create connections in Settings > Connections, or write the tiddlers directly):

| Before (0.1.56) | Now (0.1.57) |
|---|---|
| `$:/config/rimir/llm-connect/provider` (active provider name) | `$:/config/rimir/llm-connect/default-connection` (text = connection id) |
| `$:/config/rimir/llm-connect/providers/<type>/<field>` | field `<field>` on `$:/config/rimir/llm-connect/connections/<id>` with `connection-type: <type>` |
| `$:/config/rimir/llm-connect/providers/<type>/api-key` | `$:/config/rimir/llm-connect/keys/<id>` (no tag needed: llm-connect hides keys itself) |
| `$:/config/rimir/llm-connect/tiers/<tier>/provider` + `.../tiers/<tier>/model` | field `<tier>-model` (`cheap-model` / `expensive-model`) on the connection of that provider |
| `$:/config/rimir/llm-connect/tier-routing-enabled` | unchanged |

Saved chats need no change: a chat that only stores a provider type resolves to the default connection if it has that type, else the first of that type by name. The `provider` attribute of `<$llm-action>` still works and maps by type the same way.

## Install

Available from the [plugin library](https://rimir-cc.github.io/tw-plugin-library/).

## License

MIT
