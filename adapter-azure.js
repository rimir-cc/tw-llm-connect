/*\
title: $:/plugins/rimir/llm-connect/adapter-azure
type: application/javascript
module-type: library

Azure OpenAI API adapter

\*/
(function() {

"use strict";

var base = require("$:/plugins/rimir/llm-connect/adapter-openai-base");

exports.name = "azure";

exports.buildRequest = function(messages, tools, config) {
	var endpoint = (config.endpoint || "").replace(/\/+$/, "");
	var deployment = config.deployment || "";
	var apiVersion = config.apiVersion || "2025-04-01-preview";
	var maxTokens = parseInt(config.maxTokens) || 4096;

	var openaiMessages = base.convertMessages(messages, config.systemPrompt);

	var body = {
		max_completion_tokens: maxTokens,
		messages: openaiMessages
	};

	var toolsArray = base.buildTools(tools);
	if (toolsArray) {
		body.tools = toolsArray;
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

exports.parseResponse = base.parseResponse;
exports.buildToolResult = base.buildToolResult;
exports.buildAssistantMessage = base.buildAssistantMessage;
exports.buildFileBlock = base.buildFileBlock;

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

})();
