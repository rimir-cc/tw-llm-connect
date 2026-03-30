/*\
title: $:/plugins/rimir/llm-connect/adapter-openai-base
type: application/javascript
module-type: library

Shared base for OpenAI-compatible adapters (OpenAI, Azure)

\*/
(function() {

"use strict";

/*
Parse an OpenAI-format chat completion response.
Returns { type, content, toolCalls, usage }.
*/
exports.parseResponse = function(responseText) {
	var data = JSON.parse(responseText);
	if (!data.choices || !data.choices[0]) {
		throw new Error("Invalid API response: missing choices array");
	}
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

/*
Build a tool result message in OpenAI format.
*/
exports.buildToolResult = function(toolCallId, resultContent) {
	return {
		role: "tool",
		tool_call_id: toolCallId,
		content: typeof resultContent === "string" ? resultContent : JSON.stringify(resultContent)
	};
};

/*
Build an assistant message from parsed response (OpenAI format).
*/
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

/*
Build an adapter-specific file content block (OpenAI format).
*/
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

/*
Build OpenAI-format tools array from internal tool definitions.
*/
exports.buildTools = function(tools) {
	if (!tools || tools.length === 0) return undefined;
	return tools.map(function(t) {
		return {
			type: "function",
			"function": {
				name: t.name,
				description: t.description,
				parameters: t.schema
			}
		};
	});
};

/*
Convert internal message format to OpenAI-compatible format.
Handles Claude-format assistant messages, tool_result arrays, and multimodal content.
*/
exports.convertMessages = function(messages, systemPrompt) {
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
			// Check if this is a tool_result array or a multimodal content array
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
				// Convert Claude-format image/document blocks to OpenAI format
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
};

})();
