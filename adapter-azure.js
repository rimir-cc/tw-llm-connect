/*\
title: $:/plugins/rimir/llm-connect/adapter-azure
type: application/javascript
module-type: library

Azure OpenAI API adapter

\*/
(function() {

"use strict";

exports.name = "azure";

exports.buildRequest = function(messages, tools, config) {
	var endpoint = (config.endpoint || "").replace(/\/+$/, "");
	var deployment = config.deployment || "";
	var apiVersion = config.apiVersion || "2025-04-01-preview";
	var maxTokens = parseInt(config.maxTokens) || 4096;

	var openaiMessages = convertMessages(messages, config.systemPrompt);

	var body = {
		max_completion_tokens: maxTokens,
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
		url: endpoint + "/openai/deployments/" + deployment + "/chat/completions?api-version=" + apiVersion,
		headers: {
			"api-key": config.apiKey,
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

exports.buildModelListRequest = function(config) {
	var endpoint = (config.endpoint || "").replace(/\/+$/, "");
	var apiVersion = config.apiVersion || "2025-04-01-preview";
	return {
		url: endpoint + "/openai/models?api-version=" + apiVersion,
		headers: { "api-key": config.apiKey }
	};
};

exports.parseModelListResponse = function(responseText) {
	var data = JSON.parse(responseText);
	return (data.data || [])
		.filter(function(m) { return m.capabilities && m.capabilities.chat_completion; })
		.map(function(m) { return { id: m.id, label: m.id }; })
		.sort(function(a, b) { return a.label.localeCompare(b.label); });
};

exports.buildFileBlock = function(fileData) {
	if (fileData.category === "image") {
		return {
			type: "image_url",
			image_url: { url: "data:" + fileData.mediaType + ";base64," + fileData.base64 }
		};
	}
	if (fileData.category === "document") {
		return {
			type: "file",
			file: { filename: fileData.filename, file_data: "data:" + fileData.mediaType + ";base64," + fileData.base64 }
		};
	}
	return { type: "text", text: "[Unsupported file: " + fileData.filename + " (" + fileData.mediaType + ")]" };
};

function convertMessages(messages, systemPrompt) {
	var result = [];
	if (systemPrompt) {
		result.push({ role: "system", content: systemPrompt });
	}
	for (var i = 0; i < messages.length; i++) {
		var msg = messages[i];
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			// Convert Claude-format assistant message to OpenAI format
			var text = "";
			var toolCalls = [];
			for (var j = 0; j < msg.content.length; j++) {
				var block = msg.content[j];
				if (block.type === "text") {
					text += (text ? "\n" : "") + block.text;
				} else if (block.type === "tool_use") {
					toolCalls.push({
						id: block.id,
						type: "function",
						"function": {
							name: block.name,
							arguments: JSON.stringify(block.input)
						}
					});
				}
			}
			var converted = { role: "assistant", content: text || null };
			if (toolCalls.length > 0) {
				converted.tool_calls = toolCalls;
			}
			result.push(converted);
		} else if (msg.role === "user" && Array.isArray(msg.content)) {
			var hasToolResult = false;
			var hasMultimodal = false;
			for (var p = 0; p < msg.content.length; p++) {
				if (msg.content[p].type === "tool_result") hasToolResult = true;
				if (msg.content[p].type === "text" || msg.content[p].type === "image_url" || msg.content[p].type === "file" || msg.content[p].type === "image" || msg.content[p].type === "document") hasMultimodal = true;
			}
			if (hasToolResult) {
				for (var k = 0; k < msg.content.length; k++) {
					var item = msg.content[k];
					if (item.type === "tool_result") {
						result.push({
							role: "tool",
							tool_call_id: item.tool_use_id,
							content: typeof item.content === "string" ? item.content : JSON.stringify(item.content)
						});
					} else if (typeof item === "string") {
						result.push({ role: "user", content: item });
					}
				}
			} else if (hasMultimodal) {
				var contentParts = [];
				for (var m = 0; m < msg.content.length; m++) {
					var block = msg.content[m];
					if (block.type === "text") {
						contentParts.push(block);
					} else if (block.type === "image_url" || block.type === "file") {
						contentParts.push(block);
					} else if (block.type === "image" && block.source) {
						contentParts.push({
							type: "image_url",
							image_url: { url: "data:" + block.source.media_type + ";base64," + block.source.data }
						});
					} else if (block.type === "document" && block.source) {
						contentParts.push({
							type: "file",
							file: { filename: "document.pdf", file_data: "data:" + block.source.media_type + ";base64," + block.source.data }
						});
					}
				}
				result.push({ role: "user", content: contentParts });
			}
		} else {
			result.push(msg);
		}
	}
	return result;
}

})();
