/*\
title: $:/plugins/rimir/llm-connect/adapter-openai
type: application/javascript
module-type: library

OpenAI API adapter

\*/
(function() {

"use strict";

exports.name = "openai";

exports.buildRequest = function(messages, tools, config) {
	var apiKey = config.apiKey;
	var model = config.model || "gpt-4o";
	var maxTokens = parseInt(config.maxTokens) || 4096;

	var openaiMessages = convertMessages(messages, config.systemPrompt);

	var body = {
		model: model,
		max_tokens: maxTokens,
		messages: openaiMessages
	};

	if (tools && tools.length > 0) {
		body.tools = tools.map(function(t) {
			return {
				type: "function",
				"function": {
					name: t.name,
					description: t.description,
					parameters: t.schema
				}
			};
		});
	}

	return {
		url: "https://api.openai.com/v1/chat/completions",
		headers: {
			"Authorization": "Bearer " + apiKey,
			"Content-Type": "application/json"
		},
		body: JSON.stringify(body)
	};
};

exports.parseResponse = function(responseText) {
	var data = JSON.parse(responseText);
	var choice = data.choices[0];
	var message = choice.message;
	var result = {
		type: "text",
		content: message.content || "",
		toolCalls: [],
		usage: data.usage || null
	};

	if (message.tool_calls && message.tool_calls.length > 0) {
		result.type = "tool_use";
		result.toolCalls = message.tool_calls.map(function(tc) {
			return {
				id: tc.id,
				name: tc["function"].name,
				input: JSON.parse(tc["function"].arguments)
			};
		});
	}

	return result;
};

exports.buildToolResult = function(toolCallId, resultContent) {
	return {
		role: "tool",
		tool_call_id: toolCallId,
		content: typeof resultContent === "string" ? resultContent : JSON.stringify(resultContent)
	};
};

exports.buildAssistantMessage = function(parsed) {
	var msg = {
		role: "assistant",
		content: parsed.content || null
	};
	if (parsed.toolCalls.length > 0) {
		msg.tool_calls = parsed.toolCalls.map(function(tc) {
			return {
				id: tc.id,
				type: "function",
				"function": {
					name: tc.name,
					arguments: JSON.stringify(tc.input)
				}
			};
		});
	}
	return msg;
};

function convertMessages(messages, systemPrompt) {
	var result = [];
	if (systemPrompt) {
		result.push({ role: "system", content: systemPrompt });
	}
	for (var i = 0; i < messages.length; i++) {
		var msg = messages[i];
		result.push(msg);
	}
	return result;
}

})();
