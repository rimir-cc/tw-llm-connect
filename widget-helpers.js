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
Resolve protection from separate deny/allow filters and a mode.
Returns { filter, mode } where filter is the effective combined filter for the active mode.
options: { denyFilter, allowFilter, mode } — all optional, fall back to base config.
*/
exports.resolveProtectionFilter = function(options) {
	options = options || {};
	var mode = options.mode || ($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/protection-mode") || "allow").trim();
	mode = mode === "deny" ? "deny" : "allow";
	var baseConfigTiddler = mode === "allow"
		? "$:/config/rimir/llm-connect/allow-filter"
		: "$:/config/rimir/llm-connect/protection-filter";
	var base = $tw.wiki.getTiddlerText(baseConfigTiddler) || "";
	var extra = (mode === "allow" ? options.allowFilter : options.denyFilter) || "";
	// Base protection filter — always blocks these tiddlers regardless of mode
	// Uses {tiddler-reference} to avoid nested-bracket parsing issues
	var baseProtection = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/base-protection-filter") || "";
	var baseProtectionSuffix = "";
	if (baseProtection) {
		baseProtectionSuffix = mode === "allow"
			? " -[subfilter{$:/config/rimir/llm-connect/base-protection-filter}]"
			: " [subfilter{$:/config/rimir/llm-connect/base-protection-filter}]";
	}
	// Append excluded plugin filters from checkbox config
	var excludedText = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/excluded-plugins") || "";
	var excluded = $tw.utils.parseStringArray(excludedText);
	var pluginFilter = "";
	for (var i = 0; i < excluded.length; i++) {
		if (mode === "deny") {
			pluginFilter += " [all[shadows+tiddlers]prefix[" + excluded[i] + "]]";
		} else {
			pluginFilter += " -[all[shadows+tiddlers]prefix[" + excluded[i] + "]]";
		}
	}
	// Hard protection — absolute final gate, applied after all user input.
	// Uses {tiddler-reference} to avoid nested-bracket parsing issues
	var hardProtection = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/hard-protection-filter") || "";
	var hardSuffix = "";
	if (hardProtection) {
		hardSuffix = mode === "allow"
			? " -[subfilter{$:/config/rimir/llm-connect/hard-protection-filter}]"
			: " [subfilter{$:/config/rimir/llm-connect/hard-protection-filter}]";
	}
	// Always grant access to llm-help pages so tools can read documentation
	var helpSuffix = "";
	if ($tw.wiki.isShadowTiddler("$:/plugins/rimir/llm-help/functions")) {
		helpSuffix = mode === "allow"
			? " [all[shadows+tiddlers]tag[$:/tags/rimir/llm-help/page]] [[$:/plugins/rimir/llm-help/functions]] [prefix[$:/temp/rimir/llm-help/]]"
			: " -[all[shadows+tiddlers]tag[$:/tags/rimir/llm-help/page]] -[[$:/plugins/rimir/llm-help/functions]] -[prefix[$:/temp/rimir/llm-help/]]";
	}
	return {
		filter: (base + " " + extra + baseProtectionSuffix + pluginFilter + hardSuffix + helpSuffix).trim(),
		mode: mode
	};
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
