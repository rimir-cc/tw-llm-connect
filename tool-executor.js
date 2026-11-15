/*\
title: $:/plugins/rimir/llm-connect/tool-executor
type: application/javascript
module-type: library

Tool dispatch and execution — tools defined as wikitext in tiddler text fields

\*/
(function() {

"use strict";

var TAG_TOOL = "$:/tags/rimir/llm-connect/tool";
var ASK_PREFIX = "$:/temp/rimir/llm-connect/ask/";
var runCounter = 0;

exports.ASK_PREFIX = ASK_PREFIX;

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
		if (filter.length > 1 && filter.indexOf("all[") === -1) {
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
			schema: schema,
			tier: tiddler.fields["tool-model-tier"] || "default"
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

	// Connection keys: no tool may name a title under the key prefix, in any mode
	var keyTitle = namesKeyTitle(toolCall.input);
	if (keyTitle) {
		return "Error: Access denied \u2014 tiddler '" + keyTitle + "' is protected by filter rules";
	}

	// Check title-based protection
	// For create_tiddler with basetitle: skip pre-check (resolved title unknown, wikitext handles it)
	// For create_tiddler with title on new tiddler: skip (tiddler doesn't exist yet)
	var hasTitleInput = toolCall.input && toolCall.input.title;
	var isCreateWithBasetitle = toolCall.name === "create_tiddler" && toolCall.input && toolCall.input.basetitle;
	if (hasTitleInput && !isCreateWithBasetitle) {
		var title = toolCall.input.title;
		var isCreate = toolCall.name === "create_tiddler";
		if (protection.mode === "allow") {
			var allowedTitles = protection.filter ? $tw.wiki.filterTiddlers(protection.filter) : [];
			if (allowedTitles.indexOf(title) === -1) {
				if (!isCreate || $tw.wiki.tiddlerExists(title)) {
					return "Error: Access denied \u2014 tiddler '" + title + "' is not in the allow list";
				}
			}
		} else if (protection.filter) {
			var protectedTitles = $tw.wiki.filterTiddlers(protection.filter);
			if (protectedTitles.indexOf(title) !== -1) {
				return "Error: Access denied \u2014 tiddler '" + title + "' is protected by filter rules";
			}
		}
	}

	var mode = toolTiddler.fields["tool-mode"] || "read";
	var wikitext = toolTiddler.fields.text || "";
	if (!wikitext) {
		return "Error: Tool has no implementation: " + toolCall.name;
	}

	// For create_tiddler: temporarily expand protection so the proxy allows writing NEW titles only
	var effectiveProtection = protection;
	if (toolCall.name === "create_tiddler" && toolCall.input) {
		var createTitle = toolCall.input.title || toolCall.input.basetitle;
		if (createTitle && effectiveProtection.mode === "allow") {
			effectiveProtection = { filter: protection.filter, mode: protection.mode };
			// Only add titles that don't already exist (prevents overwriting protected tiddlers)
			var candidates = [createTitle];
			if (toolCall.input.basetitle) {
				for (var si = 1; si <= 20; si++) {
					candidates.push(createTitle + " " + si);
				}
			}
			// Note: [[title]] notation breaks if title contains "]]" — extremely rare in TiddlyWiki
			var additions = [];
			for (var ci = 0; ci < candidates.length; ci++) {
				if (!$tw.wiki.tiddlerExists(candidates[ci])) {
					additions.push("[[" + candidates[ci] + "]]");
				}
			}
			if (additions.length > 0) {
				effectiveProtection.filter = (effectiveProtection.filter + " " + additions.join(" ")).trim();
			}
		}
		// Deny mode: no change needed — new titles aren't in the deny list
	}

	// Awaiting tools: per-call question tiddler the tool may write even in allow mode
	var isAwait = toolTiddler.fields["tool-await"] === "yes";
	var awaitTitle = null;
	var extraVars = null;
	if (isAwait) {
		var runId = Date.now().toString(36) + (runCounter++).toString(36);
		awaitTitle = ASK_PREFIX + runId + "/" + toolCall.id;
		extraVars = {
			__awaitTitle: awaitTitle,
			__askSource: protection.askSource || protection.chatTiddler || "LLM"
		};
		if (effectiveProtection.mode === "allow") {
			effectiveProtection = $tw.utils.extend({}, effectiveProtection);
			effectiveProtection.filter = ((effectiveProtection.filter || "") + " [[" + awaitTitle + "]]").trim();
		}
	}

	var result;
	try {
		result = executeWikitext(wikitext, toolCall.input, mode, effectiveProtection, extraVars);
	} catch(e) {
		result = "Error: " + (e.message || String(e));
	}

	if (mode === "action") {
		logWrite(toolCall.name, JSON.stringify(toolCall.input));
	}

	if (isAwait) {
		var askTiddler = $tw.wiki.getTiddler(awaitTitle);
		if (askTiddler && askTiddler.fields["ask.status"] === "pending") {
			return { await: awaitTitle, tool: toolTiddler.fields.title };
		}
	}

	return exports.truncateResult(result);
};

// Cap a tool result at the configured max-tool-result-length (default 4000)
exports.truncateResult = function(result) {
	var maxLen = parseInt($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/max-tool-result-length")) || 4000;
	if (result.length > maxLen) {
		result = result.substring(0, maxLen) + "\n... [truncated at " + maxLen + " chars]";
	}
	return result;
};

/*
Returns the first string parameter that names a title under the connection key prefix, or "".
*/
function namesKeyTitle(input) {
	var prefix = require("$:/plugins/rimir/llm-connect/connections").KEY_PREFIX;
	for (var key in input) {
		if (input.hasOwnProperty(key) && typeof input[key] === "string" && input[key].trim().indexOf(prefix) === 0) {
			return input[key].trim();
		}
	}
	return "";
}

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

	// Own filter cache so compileFilter binds `self = wiki` (the proxy) instead of
	// reusing $tw.wiki's cached filters which have `self = $tw.wiki` baked in
	wiki.filterCache = Object.create(null);
	wiki.filterCacheCount = 0;

	// Guard single-title read methods: return blocked value if title is blocked, else delegate
	function guardRead(method, blockedValue) {
		wiki[method] = function(title) {
			if (isBlocked(title)) return typeof blockedValue === "function" ? blockedValue.apply(null, arguments) : blockedValue;
			return $tw.wiki[method].apply($tw.wiki, arguments);
		};
	}
	guardRead("getTiddler", undefined);
	guardRead("getTiddlerText", function(title, defaultText) { return defaultText !== undefined ? defaultText : undefined; });
	guardRead("tiddlerExists", false);
	guardRead("isShadowTiddler", false);

	// Guard iteration methods: skip blocked titles in callback
	wiki.each = function(callback) {
		$tw.wiki.each(function(tiddler, title) {
			if (!isBlocked(title)) callback(tiddler, title);
		});
	};

	wiki.forEachTiddler = function(options, callback) {
		if (typeof options === "function") {
			callback = options;
			options = undefined;
		}
		$tw.wiki.forEachTiddler(options, function(tiddler, title) {
			if (!isBlocked(title)) callback(tiddler, title);
		});
	};

	// Guard shadow iteration methods: needed for [all[shadows+tiddlers]] filters
	wiki.eachShadow = function(callback) {
		$tw.wiki.eachShadow(function(tiddler, title) {
			if (!isBlocked(title)) callback(tiddler, title);
		});
	};

	wiki.eachTiddlerPlusShadows = function(callback) {
		$tw.wiki.eachTiddlerPlusShadows(function(tiddler, title) {
			if (!isBlocked(title)) callback(tiddler, title);
		});
	};

	wiki.eachShadowPlusTiddlers = function(callback) {
		$tw.wiki.eachShadowPlusTiddlers(function(tiddler, title) {
			if (!isBlocked(title)) callback(tiddler, title);
		});
	};

	// Guard write methods: block overwriting existing protected titles, allow new tiddlers
	wiki.addTiddler = function(tiddler) {
		var title = typeof tiddler === "string" ? tiddler : (tiddler.fields ? tiddler.fields.title : tiddler.title);
		if (isBlocked(title) && $tw.wiki.tiddlerExists(title)) return;
		return $tw.wiki.addTiddler(tiddler);
	};

	wiki.deleteTiddler = function(title) {
		if (isBlocked(title)) return;
		return $tw.wiki.deleteTiddler(title);
	};

	return wiki;
}

function executeWikitext(wikitext, input, mode, protection, extraVars) {
	var variables = {};
	for (var key in input) {
		if (input.hasOwnProperty(key)) {
			variables[key] = typeof input[key] === "object" ? JSON.stringify(input[key]) : String(input[key]);
		}
	}
	variables.protectionFilter = (protection && protection.filter) || "";

	// Inject built-in context variables available to all tools
	var connections = require("$:/plugins/rimir/llm-connect/connections");
	var chatTitle = (protection && protection.chatTiddler) || "";
	var chatTid = chatTitle ? $tw.wiki.getTiddler(chatTitle) : null;
	var connConfig = connections.connectionConfig(connections.resolveChatConnection(chatTid ? chatTid.fields : {}).id);
	variables.__timestamp = $tw.utils.stringifyDate(new Date());
	variables.__provider = connConfig.provider || "unknown";
	variables.__model = (chatTid && chatTid.fields["llm-model"]) || connConfig.model || variables.__provider;
	variables.__helpContext = (protection && protection.helpContext) || "";
	variables.__chatTiddler = (protection && protection.chatTiddler) || "";

	if (extraVars) $tw.utils.extend(variables, extraVars);

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
