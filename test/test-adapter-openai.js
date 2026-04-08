/*\
title: $:/plugins/rimir/llm-connect/test/test-adapter-openai.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect adapter-openai: buildRequest, parseModelListResponse.
parseResponse/buildToolResult/buildAssistantMessage/buildFileBlock delegate to adapter-openai-base (tested separately).

\*/
"use strict";

describe("llm-connect: adapter-openai", function() {

	var adapter = require("$:/plugins/rimir/llm-connect/adapter-openai");

	describe("buildRequest", function() {
		it("should build a request with correct URL and auth header", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hello" }],
				[],
				{ apiKey: "sk-test", model: "gpt-4o", maxTokens: "2048" }
			);
			expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
			expect(req.headers["Authorization"]).toBe("Bearer sk-test");
			expect(req.headers["Content-Type"]).toBe("application/json");
			var body = JSON.parse(req.body);
			expect(body.model).toBe("gpt-4o");
			expect(body.max_completion_tokens).toBe(2048);
		});

		it("should use default model when not specified", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "sk-test" }
			);
			var body = JSON.parse(req.body);
			expect(body.model).toBe("gpt-4o");
		});

		it("should include system prompt in messages", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "sk-test", systemPrompt: "Be concise" }
			);
			var body = JSON.parse(req.body);
			expect(body.messages[0].role).toBe("system");
			expect(body.messages[0].content).toBe("Be concise");
			expect(body.messages[1].role).toBe("user");
		});

		it("should include tools in OpenAI format", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[{ name: "search", description: "Search", schema: { type: "object" } }],
				{ apiKey: "sk-test" }
			);
			var body = JSON.parse(req.body);
			expect(body.tools.length).toBe(1);
			expect(body.tools[0].type).toBe("function");
			expect(body.tools[0]["function"].name).toBe("search");
			expect(body.tools[0]["function"].parameters.type).toBe("object");
		});

		it("should omit tools when empty", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "sk-test" }
			);
			var body = JSON.parse(req.body);
			expect(body.tools).toBeUndefined();
		});
	});

	describe("parseModelListResponse", function() {
		it("should filter to chat models only", function() {
			var json = JSON.stringify({
				data: [
					{ id: "gpt-4o" },
					{ id: "gpt-4o-mini" },
					{ id: "dall-e-3" },
					{ id: "whisper-1" },
					{ id: "text-embedding-3-small" },
					{ id: "o1-preview" }
				]
			});
			var models = adapter.parseModelListResponse(json);
			var ids = models.map(function(m) { return m.id; });
			expect(ids).toContain("gpt-4o");
			expect(ids).toContain("gpt-4o-mini");
			expect(ids).toContain("o1-preview");
			expect(ids).not.toContain("dall-e-3");
			expect(ids).not.toContain("whisper-1");
			expect(ids).not.toContain("text-embedding-3-small");
		});

		it("should exclude instruct and realtime variants", function() {
			var json = JSON.stringify({
				data: [
					{ id: "gpt-4o" },
					{ id: "gpt-4o-instruct" },
					{ id: "gpt-4o-realtime" },
					{ id: "gpt-4o-audio" },
					{ id: "gpt-4o-transcription" }
				]
			});
			var models = adapter.parseModelListResponse(json);
			var ids = models.map(function(m) { return m.id; });
			expect(ids).toContain("gpt-4o");
			expect(ids).not.toContain("gpt-4o-instruct");
			expect(ids).not.toContain("gpt-4o-realtime");
			expect(ids).not.toContain("gpt-4o-audio");
			expect(ids).not.toContain("gpt-4o-transcription");
		});

		it("should sort alphabetically", function() {
			var json = JSON.stringify({
				data: [
					{ id: "gpt-4o-mini" },
					{ id: "gpt-4o" },
					{ id: "chatgpt-4o-latest" }
				]
			});
			var models = adapter.parseModelListResponse(json);
			expect(models[0].id).toBe("chatgpt-4o-latest");
			expect(models[1].id).toBe("gpt-4o");
			expect(models[2].id).toBe("gpt-4o-mini");
		});

		it("should use id as label", function() {
			var json = JSON.stringify({ data: [{ id: "gpt-4o" }] });
			var models = adapter.parseModelListResponse(json);
			expect(models[0].label).toBe("gpt-4o");
		});

		it("should handle empty/missing data", function() {
			expect(adapter.parseModelListResponse("{}").length).toBe(0);
			expect(adapter.parseModelListResponse('{"data":[]}').length).toBe(0);
		});
	});

	describe("delegates to base", function() {
		it("should expose parseResponse from base", function() {
			var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");
			expect(adapter.parseResponse).toBe(base.parseResponse);
		});

		it("should expose buildToolResult from base", function() {
			var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");
			expect(adapter.buildToolResult).toBe(base.buildToolResult);
		});

		it("should expose buildAssistantMessage from base", function() {
			var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");
			expect(adapter.buildAssistantMessage).toBe(base.buildAssistantMessage);
		});

		it("should expose buildFileBlock from base", function() {
			var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");
			expect(adapter.buildFileBlock).toBe(base.buildFileBlock);
		});
	});
});
