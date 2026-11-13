/*\
title: $:/plugins/rimir/llm-connect/connections
type: application/javascript
module-type: library

Connections store: named, typed provider connections with per-connection keys.

\*/
(function() {

"use strict";

var connectionTypes = require("$:/plugins/rimir/llm-connect/connection-types");

var PREFIX = "$:/config/rimir/llm-connect/connections/";
var KEY_PREFIX = "$:/config/rimir/llm-connect/keys/";
exports.KEY_PREFIX = KEY_PREFIX;
var DEFAULT_TITLE = "$:/config/rimir/llm-connect/default-connection";
var TAG = "$:/tags/rimir/llm-connect/connection";

function readConnection(title) {
	var t = $tw.wiki.getTiddler(title);
	if(!t) return null;
	var f = t.fields;
	// The id is the title suffix only, so getConnection(id) and listConnections() always agree
	var id = title.substr(PREFIX.length);
	return {
		id: id,
		name: f["connection-name"] || id,
		description: f["connection-description"] || "",
		type: f["connection-type"] || "",
		fields: {
			endpoint: f.endpoint || "",
			deployment: f.deployment || "",
			apiVersion: f["api-version"] || "",
			model: f.model || "",
			maxTokens: f["max-tokens"] || ""
		},
		cheapModel: f["cheap-model"] || "",
		expensiveModel: f["expensive-model"] || ""
	};
}

function getKey(id) {
	return $tw.wiki.getTiddlerText(KEY_PREFIX + id) || "";
}

exports.listConnections = function() {
	var titles = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + TAG + "]]");
	var out = [];
	for(var i = 0; i < titles.length; i++) {
		if(titles[i].indexOf(PREFIX) !== 0) continue;
		var c = readConnection(titles[i]);
		if(c) out.push(c);
	}
	out.sort(function(a, b) {
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});
	return out;
};

exports.getConnection = function(id) {
	if(!id) return null;
	var title = PREFIX + id;
	var t = $tw.wiki.getTiddler(title);
	if(!t || !t.hasTag(TAG)) return null;
	return readConnection(title);
};

exports.getDefaultConnectionId = function() {
	var stored = ($tw.wiki.getTiddlerText(DEFAULT_TITLE) || "").trim();
	if(stored && exports.getConnection(stored)) return stored;
	var all = exports.listConnections();
	return all.length ? all[0].id : "";
};

/*
Connection by id, else by name; never by type. Empty → default connection.
*/
function resolveNamedConnectionId(ref) {
	if(!ref) return exports.getDefaultConnectionId();
	if(exports.getConnection(ref)) return ref;
	var all = exports.listConnections();
	for(var i = 0; i < all.length; i++) {
		if(all[i].name === ref) return all[i].id;
	}
	return "";
}

/*
ref forms:
  ""                 → the default connection
  {connection: "x"}  → connection id or name, never a type
  {type: "x"}        → type only (see resolveTypeConnectionId)
  "x" (legacy)       → a registered type name resolves by type, anything else by id or name
Returns the connection id, or "" when nothing matches.
*/
exports.resolveConnectionId = function(ref) {
	if(ref && typeof ref === "object") {
		return ref.type ? exports.resolveTypeConnectionId(ref.type) : resolveNamedConnectionId(ref.connection);
	}
	if(ref && connectionTypes.getType(ref)) return exports.resolveTypeConnectionId(ref);
	return resolveNamedConnectionId(ref);
};

/*
Error text for a non-empty ref that resolves to nothing, else "".
*/
exports.unresolvedMessage = function(ref) {
	var isObject = ref && typeof ref === "object";
	var text = isObject ? (ref.type || ref.connection) : ref;
	if(!text || exports.resolveConnectionId(ref)) return "";
	var isType = isObject ? !!ref.type : !!connectionTypes.getType(text);
	return isType ? 'No connection of type "' + text + '"' : 'Unknown connection "' + text + '"';
};

/*
Type-only resolution: the default connection if it has that type, else the first of that type
by name, else "". Never matches ids or names (a connection named "claude" is not type claude).
*/
exports.resolveTypeConnectionId = function(type) {
	if(!type) return "";
	var def = exports.getConnection(exports.getDefaultConnectionId());
	if(def && def.type === type) return def.id;
	var all = exports.listConnections();
	for(var i = 0; i < all.length; i++) {
		if(all[i].type === type) return all[i].id;
	}
	return "";
};

exports.isConfigured = function(id) {
	var c = exports.getConnection(id);
	if(!c) return false;
	var type = connectionTypes.getType(c.type);
	if(!type) return false;
	if(!type.required) return true;
	if(type.required === "api-key") return !!getKey(id);
	var t = $tw.wiki.getTiddler(PREFIX + id);
	return !!(t && t.fields[type.required]);
};

exports.connectionConfig = function(id) {
	var c = exports.getConnection(id);
	var systemPrompt = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/system-prompt") || "";
	if(!c) {
		return {provider: "", connection: "", connectionName: "", apiKey: "", model: "",
			maxTokens: "", systemPrompt: systemPrompt, endpoint: "", deployment: "", apiVersion: "",
			tiers: {cheap: "", expensive: ""}};
	}
	return {
		provider: c.type,
		connection: c.id,
		connectionName: c.name,
		apiKey: getKey(c.id),
		model: c.fields.model,
		maxTokens: c.fields.maxTokens || "4096",
		systemPrompt: systemPrompt,
		endpoint: c.fields.endpoint,
		deployment: c.fields.deployment,
		apiVersion: c.fields.apiVersion,
		tiers: {cheap: c.cheapModel, expensive: c.expensiveModel}
	};
};

exports.resolveChatConnection = function(fields) {
	fields = fields || {};
	var stored = fields["llm-connection"];
	if(stored && exports.getConnection(stored)) return {id: stored, notice: ""};
	var type = fields["llm-connection-type"] || fields["llm-provider"] || "";
	var id = type ? exports.resolveTypeConnectionId(type) : exports.getDefaultConnectionId();
	if(!id) {
		return {id: "", notice: type ? "No connection of type " + type + " exists. Pick a connection." : "No connection exists. Pick a connection."};
	}
	var notice = "";
	if(stored) {
		var was = fields["llm-connection-name"] || type || stored;
		notice = 'Connection "' + was + '" no longer exists, using "' + exports.getConnection(id).name + '".';
	}
	return {id: id, notice: notice};
};

})();
