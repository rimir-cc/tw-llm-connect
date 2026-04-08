/*\
title: $:/plugins/rimir/llm-connect/test/test-adapter-claude.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect adapter-claude: buildRequest, parseResponse, buildToolResult, buildAssistantMessage, buildFileBlock, parseModelListResponse, convertMessages (via buildRequest).

\*/
"use strict";

describe("llm-connect: adapter-claude", function() {

	var adapter = require("$:/plugins/rimir/llm-connect/adapter-claude");

	describe("buildRequest", function() {
		it("should build a basic request with defaults", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hello" }],
				[],
				{ apiKey: "sk-test", model: "claude-sonnet-4-20250514", maxTokens: "1024" }
			);
			expect(req.url).toBe("https://api.anthropic.com/v1/messages");
			expect(req.headers["x-api-key"]).toBe("sk-test");
			expect(req.headers["anthropic-version"]).toBe("2023-06-01");
			var body = JSON.parse(req.body);
			expect(body.model).toBe("claude-sonnet-4-20250514");
			expect(body.max_tokens).toBe(1024);
			expect(body.messages.length).toBe(1);
		});

		it("should include system prompt when provided", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "sk-test", systemPrompt: "Be helpful" }
			);
			var body = JSON.parse(req.body);
			expect(body.system).toBe("Be helpful");
		});

		it("should omit system when not provided", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "sk-test" }
			);
			var body = JSON.parse(req.body);
			expect(body.system).toBeUndefined();
		});

		it("should include tools in Claude format", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[{ name: "search", description: "Search", schema: { type: "object" } }],
				{ apiKey: "sk-test" }
			);
			var body = JSON.parse(req.body);
			expect(body.tools.length).toBe(1);
			expect(body.tools[0].name).toBe("search");
			expect(body.tools[0].input_schema.type).toBe("object");
		});

		it("should use default model when not specified", function() {
			var req = adapter.buildRequest(
				[{ role: "user", content: "hi" }],
				[],
				{ apiKey: "sk-test" }
			);
			var body = JSON.parse(req.body);
			expect(body.model).toBe("claude-sonnet-4-20250514");
		});

		it("should convert OpenAI-format tool messages in conversation", function() {
			var msgs = [
				{ role: "user", content: "do something" },
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "tc1", "function": { name: "search", arguments: '{"q":"test"}' } }]
				},
				{ role: "tool", tool_call_id: "tc1", content: "found it" }
			];
			var req = adapter.buildRequest(msgs, [], { apiKey: "sk-test" });
			var body = JSON.parse(req.body);
			// Should convert to Claude format: assistant with content array, user with tool_result
			var assistant = body.messages[1];
			expect(assistant.role).toBe("assistant");
			expect(Array.isArray(assistant.content)).toBe(true);
			expect(assistant.content[0].type).toBe("tool_use");

			var toolResult = body.messages[2];
			expect(toolResult.role).toBe("user");
			expect(toolResult.content[0].type).toBe("tool_result");
			expect(toolResult.content[0].tool_use_id).toBe("tc1");
		});

		it("should merge consecutive tool results into one user message", function() {
			var msgs = [
				{ role: "user", content: "multi-tool" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ id: "tc1", "function": { name: "a", arguments: '{}' } },
						{ id: "tc2", "function": { name: "b", arguments: '{}' } }
					]
				},
				{ role: "tool", tool_call_id: "tc1", content: "r1" },
				{ role: "tool", tool_call_id: "tc2", content: "r2" }
			];
			var req = adapter.buildRequest(msgs, [], { apiKey: "sk-test" });
			var body = JSON.parse(req.body);
			// Last message should be user with two tool_result blocks
			var last = body.messages[body.messages.length - 1];
			expect(last.role).toBe("user");
			expect(last.content.length).toBe(2);
			expect(last.content[0].type).toBe("tool_result");
			expect(last.content[1].type).toBe("tool_result");
		});
	});

	describe("parseResponse", function() {
		it("should parse text response", function() {
			var json = JSON.stringify({
				stop_reason: "end_turn",
				content: [{ type: "text", text: "Hello there" }],
				usage: { input_tokens: 5, output_tokens: 3 }
			});
			var result = adapter.parseResponse(json);
			expect(result.type).toBe("text");
			expect(result.content).toBe("Hello there");
			expect(result.toolCalls.length).toBe(0);
			expect(result.usage.input_tokens).toBe(5);
		});

		it("should parse tool_use response", function() {
			var json = JSON.stringify({
				stop_reason: "tool_use",
				content: [
					{ type: "text", text: "Let me search" },
					{ type: "tool_use", id: "tu1", name: "search", input: { q: "test" } }
				]
			});
			var result = adapter.parseResponse(json);
			expect(result.type).toBe("tool_use");
			expect(result.content).toBe("Let me search");
			expect(result.toolCalls.length).toBe(1);
			expect(result.toolCalls[0].id).toBe("tu1");
			expect(result.toolCalls[0].name).toBe("search");
			expect(result.toolCalls[0].input.q).toBe("test");
		});

		it("should handle multiple tool calls", function() {
			var json = JSON.stringify({
				stop_reason: "tool_use",
				content: [
					{ type: "tool_use", id: "t1", name: "a", input: {} },
					{ type: "tool_use", id: "t2", name: "b", input: { x: 1 } }
				]
			});
			var result = adapter.parseResponse(json);
			expect(result.toolCalls.length).toBe(2);
		});

		it("should handle response with no stop_reason match", function() {
			var json = JSON.stringify({
				stop_reason: "max_tokens",
				content: [{ type: "text", text: "truncated" }]
			});
			var result = adapter.parseResponse(json);
			expect(result.type).toBe("text");
			expect(result.content).toBe("");
		});
	});

	describe("buildToolResult", function() {
		it("should wrap in user message with tool_result content", function() {
			var result = adapter.buildToolResult("tu1", "result text");
			expect(result.role).toBe("user");
			expect(result.content.length).toBe(1);
			expect(result.content[0].type).toBe("tool_result");
			expect(result.content[0].tool_use_id).toBe("tu1");
			expect(result.content[0].content).toBe("result text");
		});

		it("should stringify non-string content", function() {
			var result = adapter.buildToolResult("tu2", { data: 42 });
			expect(result.content[0].content).toBe('{"data":42}');
		});
	});

	describe("buildAssistantMessage", function() {
		it("should build content array with text", function() {
			var msg = adapter.buildAssistantMessage({ content: "hello", toolCalls: [] });
			expect(msg.role).toBe("assistant");
			expect(msg.content.length).toBe(1);
			expect(msg.content[0].type).toBe("text");
			expect(msg.content[0].text).toBe("hello");
		});

		it("should include tool_use blocks", function() {
			var msg = adapter.buildAssistantMessage({
				content: "thinking",
				toolCalls: [{ id: "t1", name: "search", input: { q: "test" } }]
			});
			expect(msg.content.length).toBe(2);
			expect(msg.content[0].type).toBe("text");
			expect(msg.content[1].type).toBe("tool_use");
			expect(msg.content[1].name).toBe("search");
		});

		it("should omit text block when content is empty", function() {
			var msg = adapter.buildAssistantMessage({
				content: "",
				toolCalls: [{ id: "t1", name: "a", input: {} }]
			});
			expect(msg.content.length).toBe(1);
			expect(msg.content[0].type).toBe("tool_use");
		});
	});

	describe("buildFileBlock", function() {
		it("should build Claude image block", function() {
			var block = adapter.buildFileBlock({
				category: "image",
				mediaType: "image/jpeg",
				base64: "imgdata",
				filename: "photo.jpg"
			});
			expect(block.type).toBe("image");
			expect(block.source.type).toBe("base64");
			expect(block.source.media_type).toBe("image/jpeg");
			expect(block.source.data).toBe("imgdata");
		});

		it("should build Claude document block", function() {
			var block = adapter.buildFileBlock({
				category: "document",
				mediaType: "application/pdf",
				base64: "pdfdata",
				filename: "doc.pdf"
			});
			expect(block.type).toBe("document");
			expect(block.source.type).toBe("base64");
			expect(block.source.media_type).toBe("application/pdf");
		});

		it("should build unsupported fallback text", function() {
			var block = adapter.buildFileBlock({
				category: "unsupported",
				mediaType: "application/zip",
				filename: "file.zip"
			});
			expect(block.type).toBe("text");
			expect(block.text).toContain("Unsupported file");
		});
	});

	describe("buildModelListRequest", function() {
		it("should build request with correct URL and headers", function() {
			var req = adapter.buildModelListRequest({ apiKey: "sk-test" });
			expect(req.url).toBe("https://api.anthropic.com/v1/models?limit=100");
			expect(req.headers["x-api-key"]).toBe("sk-test");
			expect(req.headers["anthropic-version"]).toBe("2023-06-01");
		});
	});

	describe("parseModelListResponse", function() {
		it("should parse and sort models by display_name", function() {
			var json = JSON.stringify({
				data: [
					{ id: "claude-3-opus", display_name: "Opus" },
					{ id: "claude-3-haiku", display_name: "Haiku" }
				]
			});
			var models = adapter.parseModelListResponse(json);
			expect(models.length).toBe(2);
			expect(models[0].id).toBe("claude-3-haiku");
			expect(models[0].label).toBe("Haiku");
			expect(models[1].label).toBe("Opus");
		});

		it("should use id as label fallback", function() {
			var json = JSON.stringify({
				data: [{ id: "claude-custom" }]
			});
			var models = adapter.parseModelListResponse(json);
			expect(models[0].label).toBe("claude-custom");
		});

		it("should handle empty data", function() {
			var json = JSON.stringify({ data: [] });
			expect(adapter.parseModelListResponse(json).length).toBe(0);
		});

		it("should handle missing data field", function() {
			var json = JSON.stringify({});
			expect(adapter.parseModelListResponse(json).length).toBe(0);
		});
	});
});
