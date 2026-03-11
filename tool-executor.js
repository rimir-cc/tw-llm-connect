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
		if (tiddler && tiddler.fields["tool-name"] === name) {
			return tiddler;
		}
	}
	return null;
};

exports.getToolDefinitions = function(filter) {
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
		if (!tiddler) continue;
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

exports.executeTool = function(toolCall) {
	var toolTiddler = exports.findToolByName(toolCall.name);
	if (!toolTiddler) {
		return "Error: Unknown tool: " + toolCall.name;
	}

	var mode = toolTiddler.fields["tool-mode"] || "read";
	var wikitext = toolTiddler.fields.text || "";
	var maxLen = parseInt($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/max-tool-result-length")) || 4000;

	if (!wikitext) {
		return "Error: Tool has no implementation: " + toolCall.name;
	}

	var result;
	try {
		result = executeWikitext(wikitext, toolCall.input, mode);
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

function executeWikitext(wikitext, input, mode) {
	var variables = {};
	for (var key in input) {
		if (input.hasOwnProperty(key)) {
			variables[key] = typeof input[key] === "object" ? JSON.stringify(input[key]) : String(input[key]);
		}
	}

	var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", wikitext);
	var widgetNode = $tw.wiki.makeWidget(parser, {
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
