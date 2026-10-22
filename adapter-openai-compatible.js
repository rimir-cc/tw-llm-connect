/*\
title: $:/plugins/rimir/llm-connect/adapter-openai-compatible
type: application/javascript
module-type: library

OpenAI-compatible API adapter for self-hosted servers (llama.cpp, vLLM, Ollama, LM Studio, ...)

\*/
(function() {

"use strict";

var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");

exports.name = "openai-compatible";

/*
Normalize the configured endpoint to an API base ending in /v1.
Accepts "http://host:port", "http://host:port/" and "http://host:port/v1".
*/
function apiBase(config) {
	var endpoint = (config.endpoint || "").replace(/\/+$/, "");
	return /\/v1$/.test(endpoint) ? endpoint : endpoint + "/v1";
}

function authHeaders(config) {
	var headers = {};
	if (config.apiKey) {
		headers["Authorization"] = "Bearer " + config.apiKey;
	}
	return headers;
}

/*
Remove reasoning blocks that some models (Qwen3, DeepSeek-R1) emit inline in content.
Handles both "<think>...</think>answer" and a bare "...</think>answer" (opening tag
injected by the chat template, so only the closing tag appears in the output).
*/
function stripThinking(content) {
	if (!content) return content;
	content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
	var close = content.indexOf("</think>");
	if (close !== -1) {
		content = content.substring(close + "</think>".length).replace(/^\s+/, "");
	}
	return content;
}

exports.stripThinking = stripThinking;

exports.buildRequest = function(messages, tools, config) {
	var maxTokens = parseInt(config.maxTokens) || 4096;

	var body = {
		model: config.model || "",
		max_tokens: maxTokens,
		messages: base.convertMessages(messages, config.systemPrompt)
	};

	var toolsArray = base.buildTools(tools);
	if (toolsArray) {
		body.tools = toolsArray;
	}

	var headers = authHeaders(config);
	headers["Content-Type"] = "application/json";

	return {
		url: apiBase(config) + "/chat/completions",
		headers: headers,
		body: JSON.stringify(body)
	};
};

exports.parseResponse = function(responseText) {
	var parsed = base.parseResponse(responseText);
	parsed.content = stripThinking(parsed.content);
	return parsed;
};

exports.buildToolResult = base.buildToolResult;
exports.buildAssistantMessage = base.buildAssistantMessage;
exports.buildFileBlock = base.buildFileBlock;

exports.buildModelListRequest = function(config) {
	return {
		url: apiBase(config) + "/models",
		headers: authHeaders(config)
	};
};

exports.parseModelListResponse = function(responseText) {
	var data = JSON.parse(responseText);
	return (data.data || [])
		.map(function(m) { return { id: m.id, label: m.id }; })
		.sort(function(a, b) { return a.label.localeCompare(b.label); });
};

})();
