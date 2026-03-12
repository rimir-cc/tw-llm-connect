/*\
title: $:/plugins/rimir/llm-connect/widget-helpers
type: application/javascript
module-type: library

Shared helpers for chat-widget and action-widget — deduplicates protection filter,
tool resolution, and provider config patterns.

\*/
(function() {

"use strict";

/*
Combine base protection filter (from settings) with a per-widget filter.
Returns the trimmed combined filter string, or empty string.
*/
exports.resolveProtectionFilter = function(perWidgetFilter) {
	var base = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/protection-filter") || "";
	return (base + " " + (perWidgetFilter || "")).trim();
};

/*
Resolve tool definitions from a tools filter and optional toolGroup name.
If toolGroup is set, restricts to group members. If neither is set, returns empty array.
toolsFilter: filter string for tool tiddlers
toolGroupName: name of a tool group (optional)
chatTiddler: title of chat tiddler (optional, for per-chat active tools)
Returns array of { name, description, schema }.
*/
exports.resolveTools = function(toolsFilter, toolGroupName, chatTiddler) {
	var toolExecutor = require("$:/plugins/rimir/llm-connect/tool-executor");

	if (!toolsFilter && !toolGroupName) return [];

	var activeTitles;
	if (chatTiddler) {
		var chatTid = $tw.wiki.getTiddler(chatTiddler);
		if (chatTid && chatTid.fields["llm-tools-init"] === "yes") {
			activeTitles = $tw.utils.parseStringArray(chatTid.fields["llm-active-tools"] || "");
		}
	}

	if (!activeTitles) {
		if (toolGroupName) {
			activeTitles = toolExecutor.resolveToolGroup(toolGroupName);
			if (!activeTitles) activeTitles = $tw.wiki.filterTiddlers("[all[shadows]tag[$:/tags/rimir/llm-connect/tool]]");
		} else {
			activeTitles = $tw.wiki.filterTiddlers("[all[shadows]tag[$:/tags/rimir/llm-connect/tool]]");
		}
	}

	var filter = toolsFilter || "[tag[$:/tags/rimir/llm-connect/tool]]";
	return toolExecutor.getToolDefinitions(filter, activeTitles);
};

/*
Get provider config with optional overrides for provider, model, and systemPrompt.
Returns the config object from orchestrator.getProviderConfig() with overrides applied.
*/
exports.resolveProviderConfig = function(providerAttr, modelAttr, systemPromptAttr) {
	var orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");
	var config = orchestrator.getProviderConfig(providerAttr || undefined);
	if (modelAttr) {
		config.model = modelAttr;
	}
	if (systemPromptAttr) {
		config.systemPrompt = systemPromptAttr;
	}
	return config;
};

})();
