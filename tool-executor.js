/*\
title: $:/plugins/rimir/llm-connect/tool-executor
type: application/javascript
module-type: library

Tool dispatch and execution against $tw.wiki

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
		// Prepend all[shadows+tiddlers] if not already present
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
		return { error: "Unknown tool: " + toolCall.name };
	}

	var handler = toolTiddler.fields["tool-handler"];
	var maxLen = parseInt($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/max-tool-result-length")) || 4000;
	var result;

	try {
		switch(handler) {
			case "filter":
				result = executeFilter(toolCall.input);
				break;
			case "get-tiddler":
				result = getTiddler(toolCall.input);
				break;
			case "set-field":
				result = setField(toolCall.input);
				break;
			case "create-tiddler":
				result = createTiddler(toolCall.input);
				break;
			case "delete-tiddler":
				result = deleteTiddler(toolCall.input);
				break;
			case "navigate":
				result = navigateToTiddler(toolCall.input);
				break;
			case "wikitext-render":
				result = renderWikitextTool(toolCall.input);
				break;
			case "wikitext":
				result = renderCustomWikitext(toolTiddler, toolCall.input);
				break;
			default:
				result = { error: "Unknown handler: " + handler };
		}
	} catch(e) {
		result = { error: e.message || String(e) };
	}

	var resultStr = typeof result === "string" ? result : JSON.stringify(result);
	if (resultStr.length > maxLen) {
		resultStr = resultStr.substring(0, maxLen) + "\n... [truncated at " + maxLen + " chars]";
	}
	return resultStr;
};

function executeFilter(input) {
	var filter = input.filter;
	if (!filter) return { error: "Missing 'filter' parameter" };

	var titles = $tw.wiki.filterTiddlers(filter);
	var results = [];
	for (var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if (tiddler) {
			var entry = { title: titles[i] };
			var fields = tiddler.fields;
			for (var key in fields) {
				if (key !== "text" && key !== "title") {
					entry[key] = String(fields[key]);
				}
			}
			results.push(entry);
		} else {
			results.push({ title: titles[i] });
		}
	}
	return results;
}

function getTiddler(input) {
	var title = input.title;
	if (!title) return { error: "Missing 'title' parameter" };

	var tiddler = $tw.wiki.getTiddler(title);
	if (!tiddler) return { error: "Tiddler not found: " + title };

	var result = {};
	var fields = tiddler.fields;
	for (var key in fields) {
		result[key] = String(fields[key]);
	}
	return result;
}

function logWrite(operation, details) {
	// Append to write log for audit trail
	var logTitle = "$:/temp/rimir/llm-connect/write-log";
	var existing = $tw.wiki.getTiddlerText(logTitle) || "";
	var entry = new Date().toISOString() + " | " + operation + " | " + details + "\n";
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: logTitle,
		text: existing + entry
	}));
}

function setField(input) {
	var title = input.title;
	var field = input.field;
	var value = input.value;
	if (!title || !field) return { error: "Missing 'title' or 'field' parameter" };

	var tiddler = $tw.wiki.getTiddler(title) || new $tw.Tiddler({ title: title });
	var update = {};
	update[field] = value;
	$tw.wiki.addTiddler(new $tw.Tiddler(tiddler, update));
	logWrite("set-field", title + "." + field);
	return "Done — set '" + field + "' on '" + title + "'";
}

function createTiddler(input) {
	var title = input.title;
	var text = input.text || "";
	var fields = input.fields || {};
	if (!title) return { error: "Missing 'title' parameter" };

	var tiddlerFields = $tw.utils.extend({}, fields, { title: title, text: text });
	$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
	logWrite("create-tiddler", title);
	return "Done — created tiddler '" + title + "'";
}

function deleteTiddler(input) {
	var title = input.title;
	if (!title) return { error: "Missing 'title' parameter" };

	if (!$tw.wiki.tiddlerExists(title)) {
		return { error: "Tiddler not found: " + title };
	}

	$tw.wiki.deleteTiddler(title);
	logWrite("delete-tiddler", title);
	return "Done — deleted tiddler '" + title + "'";
}

function navigateToTiddler(input) {
	var title = input.title;
	if (!title) return { error: "Missing 'title' parameter" };

	if (!$tw.wiki.tiddlerExists(title)) {
		return { error: "Tiddler not found: " + title };
	}

	// Add to StoryList
	var storyTitle = "$:/StoryList";
	var storyList = $tw.wiki.getTiddlerList(storyTitle);
	if (storyList.indexOf(title) === -1) {
		storyList.unshift(title);
		$tw.wiki.addTiddler(new $tw.Tiddler(
			$tw.wiki.getTiddler(storyTitle) || {},
			{ title: storyTitle, list: storyList }
		));
	}

	// Scroll to it via a temp tiddler that the story widget watches
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/HistoryList",
		text: "",
		"current-tiddler": title
	}));

	return "Opened tiddler: " + title;
}

function renderWikitextTool(input) {
	var wikitext = input.wikitext;
	if (!wikitext) return { error: "Missing 'wikitext' parameter" };

	var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", wikitext);
	var widgetNode = $tw.wiki.makeWidget(parser, { document: $tw.fakeDocument });
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);
	return container.textContent || "";
}

function renderCustomWikitext(toolTiddler, input) {
	var wikitext = toolTiddler.fields.text || "";
	var variables = {};
	for (var key in input) {
		variables[key] = String(input[key]);
	}

	var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", wikitext);
	var widgetNode = $tw.wiki.makeWidget(parser, {
		document: $tw.fakeDocument,
		variables: variables
	});
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);
	return container.textContent || "";
}

})();
