# llm connect

In-browser LLM integration with tool use for TiddlyWiki.

Connect TiddlyWiki to Claude, OpenAI, Azure, and other LLM APIs — the wiki acts as the orchestrator: sends prompts, receives tool calls, executes them against `$tw.wiki`, and returns results. No server required.

## Key features

- **Two modes** — interactive chat (multi-turn, tool use) and one-shot actions (context template → LLM → output target)
- **Pair editing** — toolbar button opens an embedded chat panel on any tiddler for collaborative editing with the LLM
- **Provider adapters** — Claude, OpenAI, and Azure OpenAI out of the box, extensible for other providers
- **Dynamic model selection** — fetch available models from provider APIs; per-chat model selector with provider locking
- **Tool system** — built-in tools for searching, reading, navigating, and modifying tiddlers; user-defined tools via wikitext
- **Per-chat tool selection** — wrench icon opens a dropdown to toggle individual tools per chat; tool groups as quick presets
- **Multimodal context** — attach PDFs, images, and text tiddlers to conversations via a context filter; binary files are fetched, base64-encoded, and sent inline to the LLM
- **Context templates** — wikitext templates that render input for the LLM from one or more source tiddlers
- **Output targets** — write LLM responses to fields, new tiddlers, or just display in chat
- **Debug panel** — toggle a live preview of the request payload or inspect the last sent request; base64 data abbreviated for readability
- **Resizable chat** — drag the chat panel edges or the chat history resize handle to adjust layout
- **Tiddler protection** — allow/deny modes with restricted wiki proxy. Default: allow mode (whitelist) — LLM has no access until you define an allow filter. Deny mode (blacklist) hides matched tiddlers. Per-chat mode and filter overrides via shield icon; widget-level `allowFilter`/`denyFilter` attributes for recipe panels
- **Audit logging** — write operations (set-field, create, delete) execute immediately with an audit log

## Prerequisites

- An API key for at least one supported provider (Claude, OpenAI, or Azure OpenAI)
- A modern browser (async/await support)

## Quick start

1. Install the plugin and configure your API key in Settings
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
  />
</$button>
```

## Install

Available from the [plugin library](https://rimir-cc.github.io/tw-plugin-library/).

## License

MIT
