/*\
title: $:/plugins/rimir/llm-connect/test/test-adapter-openai-base.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect adapter-openai-base: parseResponse, buildToolResult, buildAssistantMessage, buildFileBlock, buildTools, convertMessages.

\*/
"use strict";

describe("llm-connect: adapter-openai-base", function() {

	var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");

	describe("parseResponse", function() {
		it("should parse a text response", function() {
			var json = JSON.stringify({
				choices: [{ message: { content: "Hello world", tool_calls: null } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 }
			});
			var result = base.parseResponse(json);
			expect(result.type).toBe("text");
			expect(result.content).toBe("Hello world");
			expect(result.toolCalls.length).toBe(0);
			expect(result.usage.prompt_tokens).toBe(10);
		});

		it("should parse a tool_use response", function() {
			var json = JSON.stringify({
				choices: [{
					message: {
						content: "",
						tool_calls: [{
							id: "call_1",
							"function": { name: "search", arguments: '{"query":"test"}' }
						}]
					}
				}]
			});
			var result = base.parseResponse(json);
			expect(result.type).toBe("tool_use");
			expect(result.toolCalls.length).toBe(1);
			expect(result.toolCalls[0].id).toBe("call_1");
			expect(result.toolCalls[0].name).toBe("search");
			expect(result.toolCalls[0].input.query).toBe("test");
		});

		it("should parse multiple tool calls", function() {
			var json = JSON.stringify({
				choices: [{
					message: {
						content: "thinking",
						tool_calls: [
							{ id: "c1", "function": { name: "a", arguments: '{}' } },
							{ id: "c2", "function": { name: "b", arguments: '{"x":1}' } }
						]
					}
				}]
			});
			var result = base.parseResponse(json);
			expect(result.type).toBe("tool_use");
			expect(result.toolCalls.length).toBe(2);
			expect(result.content).toBe("thinking");
		});

		it("should throw on missing choices", function() {
			expect(function() { base.parseResponse("{}"); }).toThrow();
		});

		it("should throw on empty choices array", function() {
			expect(function() { base.parseResponse('{"choices":[]}'); }).toThrow();
		});

		it("should handle null content as empty string", function() {
			var json = JSON.stringify({
				choices: [{ message: { content: null } }]
			});
			var result = base.parseResponse(json);
			expect(result.content).toBe("");
		});

		it("should handle missing usage gracefully", function() {
			var json = JSON.stringify({
				choices: [{ message: { content: "ok" } }]
			});
			var result = base.parseResponse(json);
			expect(result.usage).toBeNull();
		});
	});

	describe("buildToolResult", function() {
		it("should build tool result with string content", function() {
			var result = base.buildToolResult("call_1", "result text");
			expect(result.role).toBe("tool");
			expect(result.tool_call_id).toBe("call_1");
			expect(result.content).toBe("result text");
		});

		it("should stringify object content", function() {
			var result = base.buildToolResult("call_2", { key: "value" });
			expect(result.content).toBe('{"key":"value"}');
		});
	});

	describe("buildAssistantMessage", function() {
		it("should build text-only assistant message", function() {
			var msg = base.buildAssistantMessage({ content: "hello", toolCalls: [] });
			expect(msg.role).toBe("assistant");
			expect(msg.content).toBe("hello");
			expect(msg.tool_calls).toBeUndefined();
		});

		it("should build assistant message with tool calls", function() {
			var msg = base.buildAssistantMessage({
				content: "thinking",
				toolCalls: [{ id: "c1", name: "search", input: { q: "test" } }]
			});
			expect(msg.role).toBe("assistant");
			expect(msg.content).toBe("thinking");
			expect(msg.tool_calls.length).toBe(1);
			expect(msg.tool_calls[0].id).toBe("c1");
			expect(msg.tool_calls[0].type).toBe("function");
			expect(msg.tool_calls[0]["function"].name).toBe("search");
			expect(msg.tool_calls[0]["function"].arguments).toBe('{"q":"test"}');
		});

		it("should set content to null when empty", function() {
			var msg = base.buildAssistantMessage({ content: "", toolCalls: [] });
			expect(msg.content).toBeNull();
		});
	});

	describe("buildFileBlock", function() {
		it("should build image block", function() {
			var block = base.buildFileBlock({
				category: "image",
				mediaType: "image/png",
				base64: "abc123",
				filename: "test.png"
			});
			expect(block.type).toBe("image_url");
			expect(block.image_url.url).toBe("data:image/png;base64,abc123");
		});

		it("should build document block", function() {
			var block = base.buildFileBlock({
				category: "document",
				mediaType: "application/pdf",
				base64: "pdf123",
				filename: "doc.pdf"
			});
			expect(block.type).toBe("file");
			expect(block.file.filename).toBe("doc.pdf");
			expect(block.file.file_data).toBe("data:application/pdf;base64,pdf123");
		});

		it("should build unsupported fallback", function() {
			var block = base.buildFileBlock({
				category: "unsupported",
				mediaType: "application/zip",
				filename: "archive.zip"
			});
			expect(block.type).toBe("text");
			expect(block.text).toContain("Unsupported file");
			expect(block.text).toContain("archive.zip");
		});
	});

	describe("buildTools", function() {
		it("should return undefined for empty tools", function() {
			expect(base.buildTools([])).toBeUndefined();
			expect(base.buildTools(null)).toBeUndefined();
		});

		it("should convert internal tool format to OpenAI format", function() {
			var tools = base.buildTools([
				{ name: "search", description: "Search things", schema: { type: "object", properties: { q: { type: "string" } } } }
			]);
			expect(tools.length).toBe(1);
			expect(tools[0].type).toBe("function");
			expect(tools[0]["function"].name).toBe("search");
			expect(tools[0]["function"].description).toBe("Search things");
			expect(tools[0]["function"].parameters.type).toBe("object");
		});
	});

	describe("convertMessages", function() {
		it("should prepend system prompt", function() {
			var result = base.convertMessages([], "You are helpful");
			expect(result.length).toBe(1);
			expect(result[0].role).toBe("system");
			expect(result[0].content).toBe("You are helpful");
		});

		it("should pass through simple user/assistant messages", function() {
			var msgs = [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" }
			];
			var result = base.convertMessages(msgs);
			expect(result.length).toBe(2);
			expect(result[0].role).toBe("user");
			expect(result[1].role).toBe("assistant");
		});

		it("should convert Claude-format assistant messages with tool_use", function() {
			var msgs = [{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me search" },
					{ type: "tool_use", id: "tu1", name: "search", input: { q: "test" } }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result.length).toBe(1);
			expect(result[0].role).toBe("assistant");
			expect(result[0].content).toBe("Let me search");
			expect(result[0].tool_calls.length).toBe(1);
			expect(result[0].tool_calls[0].id).toBe("tu1");
			expect(result[0].tool_calls[0]["function"].name).toBe("search");
		});

		it("should convert Claude-format tool_result user messages", function() {
			var msgs = [{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "tu1", content: "found it" }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result.length).toBe(1);
			expect(result[0].role).toBe("tool");
			expect(result[0].tool_call_id).toBe("tu1");
			expect(result[0].content).toBe("found it");
		});

		it("should convert Claude-format image blocks to OpenAI format", function() {
			var msgs = [{
				role: "user",
				content: [
					{ type: "text", text: "What is this?" },
					{ type: "image", source: { media_type: "image/png", data: "base64data" } }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result.length).toBe(1);
			expect(result[0].content.length).toBe(2);
			expect(result[0].content[0].type).toBe("text");
			expect(result[0].content[1].type).toBe("image_url");
			expect(result[0].content[1].image_url.url).toBe("data:image/png;base64,base64data");
		});

		it("should convert Claude-format document blocks to OpenAI format", function() {
			var msgs = [{
				role: "user",
				content: [
					{ type: "document", source: { media_type: "application/pdf", data: "pdfdata" } }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result[0].content[0].type).toBe("file");
			expect(result[0].content[0].file.file_data).toBe("data:application/pdf;base64,pdfdata");
		});

		it("should pass through OpenAI-native multimodal blocks", function() {
			var msgs = [{
				role: "user",
				content: [
					{ type: "text", text: "describe" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result[0].content[0].type).toBe("text");
			expect(result[0].content[1].type).toBe("image_url");
		});

		it("should handle multiple tool_result items", function() {
			var msgs = [{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: "r1" },
					{ type: "tool_result", tool_use_id: "t2", content: "r2" }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result.length).toBe(2);
			expect(result[0].role).toBe("tool");
			expect(result[0].tool_call_id).toBe("t1");
			expect(result[1].role).toBe("tool");
			expect(result[1].tool_call_id).toBe("t2");
		});

		it("should stringify non-string tool_result content", function() {
			var msgs = [{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: { data: 42 } }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result[0].content).toBe('{"data":42}');
		});

		it("should concatenate multiple text blocks in assistant array", function() {
			var msgs = [{
				role: "assistant",
				content: [
					{ type: "text", text: "first" },
					{ type: "text", text: "second" }
				]
			}];
			var result = base.convertMessages(msgs);
			expect(result[0].content).toBe("first\nsecond");
		});
	});
});
