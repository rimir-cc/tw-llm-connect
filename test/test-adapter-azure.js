/*\
title: $:/plugins/rimir/llm-connect/test/test-adapter-azure.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect adapter-azure: buildRequest, buildModelListRequest, parseModelListResponse.

\*/
"use strict";

describe("llm-connect: adapter-azure", function() {

	var adapter = require("$:/plugins/rimir/llm-connect/adapter-azure");

	describe("buildRequest", function() {
		it("should build URL from endpoint, deployment, and apiVersion", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hello" }],
				[],
				{
					apiKey: "az-key",
					endpoint: "https://myinstance.openai.azure.com",
					deployment: "gpt-4o",
					apiVersion: "2025-04-01-preview",
					maxTokens: "2048"
				}
			);
			expect(req.url).toBe("https://myinstance.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-04-01-preview");
			expect(req.headers["api-key"]).toBe("az-key");
			expect(req.headers["Content-Type"]).toBe("application/json");
		});

		it("should strip trailing slashes from endpoint", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "k", endpoint: "https://test.azure.com///", deployment: "d" }
			);
			expect(req.url).toContain("https://test.azure.com/openai/");
		});

		it("should use default apiVersion", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "k", endpoint: "https://test.azure.com", deployment: "d" }
			);
			expect(req.url).toContain("api-version=2025-04-01-preview");
		});

		it("should not include model in body (Azure uses deployment)", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "k", endpoint: "https://test.azure.com", deployment: "gpt-4o" }
			);
			var body = JSON.parse(req.body);
			expect(body.model).toBeUndefined();
		});

		it("should include max_completion_tokens", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "k", endpoint: "https://t.com", deployment: "d", maxTokens: "512" }
			);
			var body = JSON.parse(req.body);
			expect(body.max_completion_tokens).toBe(512);
		});

		it("should include tools when provided", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[{ name: "search", description: "Search", schema: { type: "object" } }],
				{ apiKey: "k", endpoint: "https://t.com", deployment: "d" }
			);
			var body = JSON.parse(req.body);
			expect(body.tools.length).toBe(1);
			expect(body.tools[0].type).toBe("function");
		});

		it("should include system prompt in messages", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "k", endpoint: "https://t.com", deployment: "d", systemPrompt: "Be brief" }
			);
			var body = JSON.parse(req.body);
			expect(body.messages[0].role).toBe("system");
			expect(body.messages[0].content).toBe("Be brief");
		});
	});

	describe("buildModelListRequest", function() {
		it("should build correct URL with endpoint and apiVersion", function() {
			var req = adapter.buildModelListRequest({
				apiKey: "az-key",
				endpoint: "https://myinstance.openai.azure.com",
				apiVersion: "2025-04-01-preview"
			});
			expect(req.url).toBe("https://myinstance.openai.azure.com/openai/models?api-version=2025-04-01-preview");
			expect(req.headers["api-key"]).toBe("az-key");
		});

		it("should strip trailing slashes from endpoint", function() {
			var req = adapter.buildModelListRequest({
				apiKey: "k",
				endpoint: "https://test.azure.com//"
			});
			expect(req.url).toContain("https://test.azure.com/openai/models");
		});

		it("should use default apiVersion", function() {
			var req = adapter.buildModelListRequest({
				apiKey: "k",
				endpoint: "https://test.azure.com"
			});
			expect(req.url).toContain("api-version=2025-04-01-preview");
		});
	});

	describe("parseModelListResponse", function() {
		it("should filter to models with chat_completion capability", function() {
			var json = JSON.stringify({
				data: [
					{ id: "gpt-4o", capabilities: { chat_completion: true } },
					{ id: "text-embedding", capabilities: { embeddings: true } },
					{ id: "gpt-35-turbo", capabilities: { chat_completion: true } },
					{ id: "dall-e", capabilities: { image_generation: true } }
				]
			});
			var models = adapter.parseModelListResponse(json);
			var ids = models.map(function(m) { return m.id; });
			expect(ids).toContain("gpt-4o");
			expect(ids).toContain("gpt-35-turbo");
			expect(ids).not.toContain("text-embedding");
			expect(ids).not.toContain("dall-e");
		});

		it("should exclude models without capabilities field", function() {
			var json = JSON.stringify({
				data: [
					{ id: "gpt-4o", capabilities: { chat_completion: true } },
					{ id: "no-caps" }
				]
			});
			var models = adapter.parseModelListResponse(json);
			expect(models.length).toBe(1);
		});

		it("should sort alphabetically by id", function() {
			var json = JSON.stringify({
				data: [
					{ id: "gpt-4o", capabilities: { chat_completion: true } },
					{ id: "gpt-35-turbo", capabilities: { chat_completion: true } }
				]
			});
			var models = adapter.parseModelListResponse(json);
			expect(models[0].id).toBe("gpt-35-turbo");
			expect(models[1].id).toBe("gpt-4o");
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
	});
});
