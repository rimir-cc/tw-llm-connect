/*\
title: $:/plugins/rimir/llm-connect/adapter-openai
type: application/javascript
module-type: library

OpenAI API adapter

\*/
(function() {

"use strict";

var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");

exports.name = "openai";

exports.buildRequest = function(messages, tools, config) {
	var apiKey = config.apiKey;
	var model = config.model || "gpt-4o";
	var maxTokens = parseInt(config.maxTokens) || 4096;

	var openaiMessages = base.convertMessages(messages, config.systemPrompt);

	var body = {
		model: model,
		max_completion_tokens: maxTokens,
		messages: openaiMessages
	};

	var toolsArray = base.buildTools(tools);
	if (toolsArray) {
		body.tools = toolsArray;
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

exports.parseResponse = base.parseResponse;
exports.buildToolResult = base.buildToolResult;
exports.buildAssistantMessage = base.buildAssistantMessage;
exports.buildFileBlock = base.buildFileBlock;

exports.buildModelListRequest = function(config) {
	return {
		url: "https://api.openai.com/v1/models",
		headers: { "Authorization": "Bearer " + config.apiKey }
	};
};

exports.parseModelListResponse = function(responseText) {
	var data = JSON.parse(responseText);
	return (data.data || [])
		.filter(function(m) {
			return /^(gpt-|o[134]-|chatgpt-)/.test(m.id) && !/(-instruct|-realtime|-audio|-transcri)/.test(m.id);
		})
		.map(function(m) { return { id: m.id, label: m.id }; })
		.sort(function(a, b) { return a.label.localeCompare(b.label); });
};

})();
