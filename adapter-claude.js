/*\
title: $:/plugins/rimir/llm-connect/adapter-claude
type: application/javascript
module-type: library

Claude (Anthropic) API adapter

\*/
(function() {

"use strict";

exports.name = "claude";

exports.buildRequest = function(messages, tools, config) {
	var apiKey = config.apiKey;
	var model = config.model || "claude-sonnet-4-20250514";
	var maxTokens = parseInt(config.maxTokens) || 4096;

	var body = {
		model: model,
		max_tokens: maxTokens,
		messages: convertMessages(messages)
	};

	if (config.systemPrompt) {
		body.system = config.systemPrompt;
	}

	if (tools && tools.length > 0) {
		body.tools = tools.map(function(t) {
			return {
				name: t.name,
				description: t.description,
				input_schema: t.schema
			};
		});
	}

	return {
		url: "https://api.anthropic.com/v1/messages",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
			"anthropic-dangerous-direct-browser-access": "true"
		},
		body: JSON.stringify(body)
	};
};

exports.parseResponse = function(responseText) {
	var data = JSON.parse(responseText);
	var result = {
		type: "text",
		content: "",
		toolCalls: [],
		usage: data.usage || null
	};

	if (data.stop_reason === "tool_use" || data.stop_reason === "end_turn") {
		var textParts = [];
		var toolCalls = [];

		for (var i = 0; i < data.content.length; i++) {
			var block = data.content[i];
			if (block.type === "text") {
				textParts.push(block.text);
			} else if (block.type === "tool_use") {
				toolCalls.push({
					id: block.id,
					name: block.name,
					input: block.input
				});
			}
		}

		if (toolCalls.length > 0) {
			result.type = "tool_use";
			result.toolCalls = toolCalls;
			result.content = textParts.join("\n");
		} else {
			result.type = "text";
			result.content = textParts.join("\n");
		}
	}

	return result;
};

exports.buildToolResult = function(toolCallId, resultContent) {
	return {
		role: "user",
		content: [{
			type: "tool_result",
			tool_use_id: toolCallId,
			content: typeof resultContent === "string" ? resultContent : JSON.stringify(resultContent)
		}]
	};
};

exports.buildAssistantMessage = function(parsed) {
	var content = [];
	if (parsed.content) {
		content.push({ type: "text", text: parsed.content });
	}
	for (var i = 0; i < parsed.toolCalls.length; i++) {
		var tc = parsed.toolCalls[i];
		content.push({
			type: "tool_use",
			id: tc.id,
			name: tc.name,
			input: tc.input
		});
	}
	return { role: "assistant", content: content };
};

function convertMessages(messages) {
	var result = [];
	for (var i = 0; i < messages.length; i++) {
		var msg = messages[i];
		if (msg.role === "user") {
			result.push({ role: "user", content: msg.content });
		} else if (msg.role === "assistant") {
			result.push({ role: "assistant", content: msg.content });
		}
	}
	return result;
}

})();
