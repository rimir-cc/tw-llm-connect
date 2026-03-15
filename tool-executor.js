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

exports.executeTool = function(toolCall, protectionFilter) {
	var toolTiddler = exports.findToolByName(toolCall.name);
	if (!toolTiddler) {
		return "Error: Unknown tool: " + toolCall.name;
	}

	// Check title-based protection
	if (protectionFilter && toolCall.input && toolCall.input.title) {
		var protectedTitles = $tw.wiki.filterTiddlers(protectionFilter);
		if (protectedTitles.indexOf(toolCall.input.title) !== -1) {
			return "Error: Access denied \u2014 tiddler '" + toolCall.input.title + "' is protected by filter rules";
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
		result = executeWikitext(wikitext, toolCall.input, mode, protectionFilter);
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

function createRestrictedWiki(protectionFilter) {
	if (!protectionFilter) return $tw.wiki;
	var protectedArray = $tw.wiki.filterTiddlers(protectionFilter);
	if (protectedArray.length === 0) return $tw.wiki;

	var protectedSet = Object.create(null);
	for (var i = 0; i < protectedArray.length; i++) {
		protectedSet[protectedArray[i]] = true;
	}

	var wiki = Object.create($tw.wiki);

	wiki.getTiddler = function(title) {
		if (protectedSet[title]) return undefined;
		return $tw.wiki.getTiddler(title);
	};

	wiki.getTiddlerText = function(title, defaultText) {
		if (protectedSet[title]) return defaultText !== undefined ? defaultText : undefined;
		return $tw.wiki.getTiddlerText(title, defaultText);
	};

	wiki.tiddlerExists = function(title) {
		if (protectedSet[title]) return false;
		return $tw.wiki.tiddlerExists(title);
	};

	wiki.isShadowTiddler = function(title) {
		if (protectedSet[title]) return false;
		return $tw.wiki.isShadowTiddler(title);
	};

	wiki.filterTiddlers = function(filter, widget, source) {
		var results = $tw.wiki.filterTiddlers(filter, widget, source);
		return results.filter(function(title) {
			return !protectedSet[title];
		});
	};

	wiki.each = function(callback) {
		$tw.wiki.each(function(tiddler, title) {
			if (!protectedSet[title]) {
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
			if (!protectedSet[title]) {
				callback(tiddler, title);
			}
		});
	};

	wiki.addTiddler = function(tiddler) {
		var title = typeof tiddler === "string" ? tiddler : (tiddler.fields ? tiddler.fields.title : tiddler.title);
		if (protectedSet[title]) return;
		return $tw.wiki.addTiddler(tiddler);
	};

	wiki.deleteTiddler = function(title) {
		if (protectedSet[title]) return;
		return $tw.wiki.deleteTiddler(title);
	};

	return wiki;
}

function executeWikitext(wikitext, input, mode, protectionFilter) {
	var variables = {};
	for (var key in input) {
		if (input.hasOwnProperty(key)) {
			variables[key] = typeof input[key] === "object" ? JSON.stringify(input[key]) : String(input[key]);
		}
	}
	variables.protectionFilter = protectionFilter || "";

	// Inject built-in context variables available to all tools
	var provider = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/provider") || "unknown";
	variables.__timestamp = $tw.utils.stringifyDate(new Date());
	variables.__provider = provider;
	variables.__model = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/providers/" + provider + "/model") || provider;

	var wiki = createRestrictedWiki(protectionFilter);
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
