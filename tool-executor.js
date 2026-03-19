/*\
title: $:/plugins/rimir/llm-connect/tool-executor
type: application/javascript
module-type: library

Tool dispatch and execution — tools defined as wikitext in tiddler text fields

\*/
(function() {

"use strict";

var TAG_TOOL = "$:/tags/rimir/llm-connect/tool";

exports.findToolByName = function(name) {
	var tools = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + TAG_TOOL + "]]");
	for (var i = 0; i < tools.length; i++) {
		var tiddler = $tw.wiki.getTiddler(tools[i]);
		if (tiddler && tiddler.fields["tool-name"] === name && tiddler.fields["tool-enabled"] !== "no") {
			return tiddler;
		}
	}
	return null;
};

/*
Resolve a tool group name to tool tiddler titles.
Returns array of titles, or null if group not found.
*/
exports.resolveToolGroup = function(groupName) {
	if (!groupName) return null;
	var groups = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[$:/tags/rimir/llm-connect/tool-group]]");
	for (var i = 0; i < groups.length; i++) {
		var tiddler = $tw.wiki.getTiddler(groups[i]);
		if (tiddler && tiddler.fields["group-name"] === groupName) {
			return $tw.utils.parseStringArray(tiddler.fields["group-tools"] || "");
		}
	}
	return null;
};

exports.getToolDefinitions = function(filter, activeTitles) {
	var titles;
	if (filter) {
		if (filter.indexOf("all[") === -1) {
			filter = "[all[shadows+tiddlers]" + filter.substring(1);
		}
		titles = $tw.wiki.filterTiddlers(filter);
	} else {
		titles = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + TAG_TOOL + "]]");
	}
	var tools = [];
	for (var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if (!tiddler || tiddler.fields["tool-enabled"] === "no") continue;
		if (activeTitles && activeTitles.indexOf(titles[i]) === -1) continue;
		var schemaText = tiddler.fields["tool-schema"];
		var schema;
		try {
			schema = JSON.parse(schemaText);
		} catch(e) {
			schema = { type: "object", properties: {} };
		}
		tools.push({
			name: tiddler.fields["tool-name"],
			description: tiddler.fields["tool-description"] || "",
			schema: schema
		});
	}
	return tools;
};

exports.executeTool = function(toolCall, protection) {
	var toolTiddler = exports.findToolByName(toolCall.name);
	if (!toolTiddler) {
		return "Error: Unknown tool: " + toolCall.name;
	}

	// Normalize protection: accept string (legacy) or { filter, mode } object
	if (typeof protection === "string") {
		protection = { filter: protection, mode: "allow" };
	}
	protection = protection || { filter: "", mode: "deny" };

	// Check title-based protection
	if (toolCall.input && toolCall.input.title) {
		var title = toolCall.input.title;
		if (protection.mode === "allow") {
			// Allow mode: only filter matches are accessible (empty filter = nothing accessible)
			var allowedTitles = protection.filter ? $tw.wiki.filterTiddlers(protection.filter) : [];
			if (allowedTitles.indexOf(title) === -1) {
				return "Error: Access denied \u2014 tiddler '" + title + "' is not in the allow list";
			}
		} else if (protection.filter) {
			// Deny mode: filter matches are protected
			var protectedTitles = $tw.wiki.filterTiddlers(protection.filter);
			if (protectedTitles.indexOf(title) !== -1) {
				return "Error: Access denied \u2014 tiddler '" + title + "' is protected by filter rules";
			}
		}
	}

	var mode = toolTiddler.fields["tool-mode"] || "read";
	var wikitext = toolTiddler.fields.text || "";
	var maxLen = parseInt($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/max-tool-result-length")) || 4000;

	if (!wikitext) {
		return "Error: Tool has no implementation: " + toolCall.name;
	}

	var result;
	try {
		result = executeWikitext(wikitext, toolCall.input, mode, protection);
	} catch(e) {
		result = "Error: " + (e.message || String(e));
	}

	if (mode === "action") {
		logWrite(toolCall.name, JSON.stringify(toolCall.input));
	}

	if (result.length > maxLen) {
		result = result.substring(0, maxLen) + "\n... [truncated at " + maxLen + " chars]";
	}
	return result;
};

function createRestrictedWiki(protection) {
	// Normalize: accept string (legacy) or { filter, mode } object
	if (typeof protection === "string") {
		protection = { filter: protection, mode: "allow" };
	}
	if (!protection) return $tw.wiki;
	// Deny mode with no filter = unrestricted; allow mode with no filter = block everything
	if (!protection.filter && protection.mode !== "allow") return $tw.wiki;

	var filterResults = protection.filter ? $tw.wiki.filterTiddlers(protection.filter) : [];
	if (filterResults.length === 0 && protection.mode === "deny") return $tw.wiki;

	var isBlocked;
	if (protection.mode === "allow") {
		// Allow mode: only filter matches are accessible, everything else is blocked
		var allowedSet = Object.create(null);
		for (var i = 0; i < filterResults.length; i++) {
			allowedSet[filterResults[i]] = true;
		}
		isBlocked = function(title) { return !allowedSet[title]; };
	} else {
		// Deny mode: filter matches are blocked
		var protectedSet = Object.create(null);
		for (var i = 0; i < filterResults.length; i++) {
			protectedSet[filterResults[i]] = true;
		}
		isBlocked = function(title) { return !!protectedSet[title]; };
	}

	var wiki = Object.create($tw.wiki);

	wiki.getTiddler = function(title) {
		if (isBlocked(title)) return undefined;
		return $tw.wiki.getTiddler(title);
	};

	wiki.getTiddlerText = function(title, defaultText) {
		if (isBlocked(title)) return defaultText !== undefined ? defaultText : undefined;
		return $tw.wiki.getTiddlerText(title, defaultText);
	};

	wiki.tiddlerExists = function(title) {
		if (isBlocked(title)) return false;
		return $tw.wiki.tiddlerExists(title);
	};

	wiki.isShadowTiddler = function(title) {
		if (isBlocked(title)) return false;
		return $tw.wiki.isShadowTiddler(title);
	};

	wiki.each = function(callback) {
		$tw.wiki.each(function(tiddler, title) {
			if (!isBlocked(title)) {
				callback(tiddler, title);
			}
		});
	};

	wiki.forEachTiddler = function(options, callback) {
		if (typeof options === "function") {
			callback = options;
			options = undefined;
		}
		$tw.wiki.forEachTiddler(options, function(tiddler, title) {
			if (!isBlocked(title)) {
				callback(tiddler, title);
			}
		});
	};

	wiki.addTiddler = function(tiddler) {
		var title = typeof tiddler === "string" ? tiddler : (tiddler.fields ? tiddler.fields.title : tiddler.title);
		if (isBlocked(title)) return;
		return $tw.wiki.addTiddler(tiddler);
	};

	wiki.deleteTiddler = function(title) {
		if (isBlocked(title)) return;
		return $tw.wiki.deleteTiddler(title);
	};

	return wiki;
}

function executeWikitext(wikitext, input, mode, protection) {
	var variables = {};
	for (var key in input) {
		if (input.hasOwnProperty(key)) {
			variables[key] = typeof input[key] === "object" ? JSON.stringify(input[key]) : String(input[key]);
		}
	}
	variables.protectionFilter = (protection && protection.filter) || "";

	// Inject built-in context variables available to all tools
	var provider = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/provider") || "unknown";
	variables.__timestamp = $tw.utils.stringifyDate(new Date());
	variables.__provider = provider;
	variables.__model = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/providers/" + provider + "/model") || provider;

	var wiki = createRestrictedWiki(protection);
	var parser = wiki.parseText("text/vnd.tiddlywiki", wikitext);
	var widgetNode = wiki.makeWidget(parser, {
		document: $tw.fakeDocument,
		variables: variables
	});
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);

	if (mode === "action") {
		widgetNode.invokeActions(widgetNode, {});
	}

	return container.textContent || "";
}

function logWrite(operation, details) {
	var logTitle = "$:/temp/rimir/llm-connect/write-log";
	var existing = $tw.wiki.getTiddlerText(logTitle) || "";
	var entry = new Date().toISOString() + " | " + operation + " | " + details + "\n";
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: logTitle,
		text: existing + entry
	}));
}

})();
