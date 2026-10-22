/*\
title: $:/plugins/rimir/llm-connect/test/test-adapter-openai-compatible.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect adapter-openai-compatible: endpoint normalization, optional auth,
max_tokens, thinking-block stripping, unfiltered model list.

\*/
"use strict";

describe("llm-connect: adapter-openai-compatible", function() {

	var adapter = require("$:/plugins/rimir/llm-connect/adapter-openai-compatible");
	var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");

	function completion(content, toolCalls) {
		var message = { role: "assistant", content: content };
		if (toolCalls) message.tool_calls = toolCalls;
		return JSON.stringify({ choices: [{ message: message }] });
	}

	describe("buildRequest", function() {
		it("should append /v1/chat/completions to a bare endpoint", function() {
			var req = adapter.buildRequest([{ role: "user", content: "hi" }], [], { endpoint: "http://gpu:34434" });
			expect(req.url).toBe("http://gpu:34434/v1/chat/completions");
		});

		it("should not duplicate /v1 and should strip trailing slashes", function() {
			expect(adapter.buildRequest([], [], { endpoint: "http://gpu:34434/v1/" }).url).toBe("http://gpu:34434/v1/chat/completions");
			expect(adapter.buildRequest([], [], { endpoint: "http://gpu:34434/" }).url).toBe("http://gpu:34434/v1/chat/completions");
		});

		it("should send a bearer token only when an API key is set", function() {
			var withKey = adapter.buildRequest([], [], { endpoint: "http://gpu", apiKey: "secret" });
			expect(withKey.headers["Authorization"]).toBe("Bearer secret");
			var withoutKey = adapter.buildRequest([], [], { endpoint: "http://gpu" });
			expect(withoutKey.headers["Authorization"]).toBeUndefined();
			expect(withoutKey.headers["Content-Type"]).toBe("application/json");
		});

		it("should use max_tokens and pass the model through", function() {
			var req = adapter.buildRequest([{ role: "user", content: "hi" }], [], { endpoint: "http://gpu", model: "qwen", maxTokens: "8192" });
			var body = JSON.parse(req.body);
			expect(body.model).toBe("qwen");
			expect(body.max_tokens).toBe(8192);
			expect(body.max_completion_tokens).toBeUndefined();
		});

		it("should include system prompt and tools in OpenAI format", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[{ name: "search", description: "Search", schema: { type: "object" } }],
				{ endpoint: "http://gpu", systemPrompt: "Be concise" }
			);
			var body = JSON.parse(req.body);
			expect(body.messages[0]).toEqual({ role: "system", content: "Be concise" });
			expect(body.tools[0]["function"].name).toBe("search");
		});
	});

	describe("parseResponse", function() {
		it("should strip a complete <think> block", function() {
			var parsed = adapter.parseResponse(completion("<think>\nreasoning\n</think>\n\nThe answer."));
			expect(parsed.content).toBe("The answer.");
		});

		it("should strip reasoning when only the closing tag is present", function() {
			var parsed = adapter.parseResponse(completion("reasoning here\n</think>\nThe answer."));
			expect(parsed.content).toBe("The answer.");
		});

		it("should leave plain content untouched", function() {
			expect(adapter.parseResponse(completion("Just text.")).content).toBe("Just text.");
		});

		it("should still parse tool calls", function() {
			var parsed = adapter.parseResponse(completion("<think>x</think>", [
				{ id: "call_1", type: "function", "function": { name: "search_tiddlers", arguments: "{\"filter\":\"[tag[x]]\"}" } }
			]));
			expect(parsed.type).toBe("tool_use");
			expect(parsed.content).toBe("");
			expect(parsed.toolCalls[0].name).toBe("search_tiddlers");
			expect(parsed.toolCalls[0].input.filter).toBe("[tag[x]]");
		});
	});

	describe("buildModelListRequest", function() {
		it("should target /v1/models with optional auth", function() {
			var req = adapter.buildModelListRequest({ endpoint: "http://gpu:34434", apiKey: "secret" });
			expect(req.url).toBe("http://gpu:34434/v1/models");
			expect(req.headers["Authorization"]).toBe("Bearer secret");
			expect(adapter.buildModelListRequest({ endpoint: "http://gpu" }).headers["Authorization"]).toBeUndefined();
		});
	});

	describe("parseModelListResponse", function() {
		it("should return all models unfiltered, sorted", function() {
			var models = adapter.parseModelListResponse(JSON.stringify({
				data: [{ id: "unsloth/Qwen3.8-27B-GGUF:Q4_K_M" }, { id: "llama-3" }]
			}));
			expect(models.map(function(m) { return m.id; })).toEqual(["llama-3", "unsloth/Qwen3.8-27B-GGUF:Q4_K_M"]);
			expect(models[0].label).toBe("llama-3");
		});

		it("should handle empty/missing data", function() {
			expect(adapter.parseModelListResponse("{}").length).toBe(0);
		});
	});

	describe("delegates to base", function() {
		it("should expose shared helpers from base", function() {
			expect(adapter.buildToolResult).toBe(base.buildToolResult);
			expect(adapter.buildAssistantMessage).toBe(base.buildAssistantMessage);
			expect(adapter.buildFileBlock).toBe(base.buildFileBlock);
		});
	});
});
