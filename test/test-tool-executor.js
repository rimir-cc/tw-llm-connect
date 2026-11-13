/*\
title: $:/plugins/rimir/llm-connect/test/test-tool-executor.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect tool-executor: findToolByName, getToolDefinitions, resolveToolGroup.

\*/
"use strict";

describe("llm-connect: tool-executor", function() {

	var toolExecutor = require("$:/plugins/rimir/llm-connect/tool-executor");
	var TAG_TOOL = "$:/tags/rimir/llm-connect/tool";
	var TAG_GROUP = "$:/tags/rimir/llm-connect/tool-group";

	// Save and restore wiki state around each test
	var addedTitles;
	beforeEach(function() {
		addedTitles = [];
	});
	afterEach(function() {
		for (var i = 0; i < addedTitles.length; i++) {
			$tw.wiki.deleteTiddler(addedTitles[i]);
		}
	});

	function addTool(title, fields) {
		var tiddlerFields = $tw.utils.extend({
			title: title,
			tags: TAG_TOOL,
			type: "text/vnd.tiddlywiki"
		}, fields);
		$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
		addedTitles.push(title);
	}

	function addGroup(title, fields) {
		var tiddlerFields = $tw.utils.extend({
			title: title,
			tags: TAG_GROUP
		}, fields);
		$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
		addedTitles.push(title);
	}

	describe("findToolByName", function() {
		it("should find a tool by its tool-name field", function() {
			addTool("$:/test/tool-alpha", {
				"tool-name": "alpha",
				"tool-description": "Alpha tool"
			});
			var found = toolExecutor.findToolByName("alpha");
			expect(found).not.toBeNull();
			expect(found.fields["tool-name"]).toBe("alpha");
		});

		it("should return null for unknown tool name", function() {
			var found = toolExecutor.findToolByName("nonexistent-tool-xyz");
			expect(found).toBeNull();
		});

		it("should skip disabled tools", function() {
			addTool("$:/test/tool-disabled", {
				"tool-name": "disabled-tool",
				"tool-enabled": "no"
			});
			var found = toolExecutor.findToolByName("disabled-tool");
			expect(found).toBeNull();
		});

		it("should find enabled tools when tool-enabled is not set", function() {
			addTool("$:/test/tool-default-enabled", {
				"tool-name": "default-enabled"
			});
			var found = toolExecutor.findToolByName("default-enabled");
			expect(found).not.toBeNull();
		});
	});

	describe("getToolDefinitions", function() {
		it("should return tool definitions with name, description, schema", function() {
			addTool("$:/test/tool-defs-a", {
				"tool-name": "defs-a",
				"tool-description": "Tool A for testing",
				"tool-schema": '{"type":"object","properties":{"x":{"type":"string"}}}'
			});
			var defs = toolExecutor.getToolDefinitions(
				"[tag[" + TAG_TOOL + "]]",
				["$:/test/tool-defs-a"]
			);
			var match = defs.filter(function(d) { return d.name === "defs-a"; });
			expect(match.length).toBe(1);
			expect(match[0].description).toBe("Tool A for testing");
			expect(match[0].schema.type).toBe("object");
			expect(match[0].schema.properties.x.type).toBe("string");
		});

		it("should use fallback schema for invalid JSON", function() {
			addTool("$:/test/tool-bad-schema", {
				"tool-name": "bad-schema",
				"tool-schema": "not-json"
			});
			var defs = toolExecutor.getToolDefinitions(
				"[tag[" + TAG_TOOL + "]]",
				["$:/test/tool-bad-schema"]
			);
			var match = defs.filter(function(d) { return d.name === "bad-schema"; });
			expect(match.length).toBe(1);
			expect(match[0].schema.type).toBe("object");
			expect(match[0].schema.properties).toBeDefined();
		});

		it("should exclude disabled tools", function() {
			addTool("$:/test/tool-disabled-def", {
				"tool-name": "disabled-def",
				"tool-enabled": "no"
			});
			var defs = toolExecutor.getToolDefinitions(
				"[tag[" + TAG_TOOL + "]]",
				["$:/test/tool-disabled-def"]
			);
			var match = defs.filter(function(d) { return d.name === "disabled-def"; });
			expect(match.length).toBe(0);
		});

		it("should filter by activeTitles when provided", function() {
			addTool("$:/test/tool-active", {
				"tool-name": "active-one",
				"tool-schema": "{}"
			});
			addTool("$:/test/tool-inactive", {
				"tool-name": "inactive-one",
				"tool-schema": "{}"
			});
			var defs = toolExecutor.getToolDefinitions(
				"[tag[" + TAG_TOOL + "]]",
				["$:/test/tool-active"]
			);
			var activeMatch = defs.filter(function(d) { return d.name === "active-one"; });
			var inactiveMatch = defs.filter(function(d) { return d.name === "inactive-one"; });
			expect(activeMatch.length).toBe(1);
			expect(inactiveMatch.length).toBe(0);
		});

		it("should handle missing tool-schema gracefully", function() {
			addTool("$:/test/tool-no-schema", {
				"tool-name": "no-schema"
			});
			var defs = toolExecutor.getToolDefinitions(
				"[tag[" + TAG_TOOL + "]]",
				["$:/test/tool-no-schema"]
			);
			var match = defs.filter(function(d) { return d.name === "no-schema"; });
			expect(match.length).toBe(1);
			expect(match[0].schema.type).toBe("object");
		});
	});

	describe("resolveToolGroup", function() {
		it("should return tool titles for a known group", function() {
			addGroup("$:/test/group-abc", {
				"group-name": "abc",
				"group-tools": "$:/test/tool-x $:/test/tool-y"
			});
			var titles = toolExecutor.resolveToolGroup("abc");
			expect(titles).toContain("$:/test/tool-x");
			expect(titles).toContain("$:/test/tool-y");
		});

		it("should return null for unknown group", function() {
			var titles = toolExecutor.resolveToolGroup("nonexistent-group-xyz");
			expect(titles).toBeNull();
		});

		it("should return null for empty/falsy group name", function() {
			expect(toolExecutor.resolveToolGroup("")).toBeNull();
			expect(toolExecutor.resolveToolGroup(null)).toBeNull();
			expect(toolExecutor.resolveToolGroup(undefined)).toBeNull();
		});
	});

	describe("executeTool create_tiddler", function() {
		var KEY = "$:/config/rimir/llm-connect/keys/zz-test";
		afterEach(function() {
			$tw.wiki.deleteTiddler(KEY);
			$tw.wiki.deleteTiddler(KEY + " 1");
		});
		it("refuses to create a tiddler under the connection keys prefix", function() {
			var allowAll = { filter: "[all[tiddlers]]", mode: "allow" };
			var result = toolExecutor.executeTool({ name: "create_tiddler", input: { title: KEY, text: "stolen" } }, allowAll);
			expect(result).toContain("Access denied");
			expect($tw.wiki.tiddlerExists(KEY)).toBe(false);
		});
		it("refuses a basetitle under the connection keys prefix", function() {
			var allowAll = { filter: "[all[tiddlers]]", mode: "allow" };
			var result = toolExecutor.executeTool({ name: "create_tiddler", input: { basetitle: KEY, text: "x" } }, allowAll);
			expect(result).toContain("Access denied");
			expect($tw.wiki.tiddlerExists(KEY)).toBe(false);
			expect($tw.wiki.tiddlerExists(KEY + " 1")).toBe(false);
		});
	});

	describe("executeTool key protection", function() {
		var KEY = "$:/config/rimir/llm-connect/keys/zz-test";
		var helpers = require("$:/plugins/rimir/llm-connect/widget-helpers");
		afterEach(function() {
			$tw.wiki.deleteTiddler(KEY);
		});

		it("set_field cannot create a key tiddler in deny mode", function() {
			var deny = helpers.resolveProtectionFilter({ mode: "deny", denyFilter: "" });
			var result = toolExecutor.executeTool({ name: "set_field", input: { title: KEY, field: "text", value: "stolen" } }, deny);
			expect(result).toContain("Access denied");
			expect($tw.wiki.tiddlerExists(KEY)).toBe(false);
		});

		it("set_field cannot overwrite a key tiddler in deny mode", function() {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: KEY, text: "orig" }));
			var deny = helpers.resolveProtectionFilter({ mode: "deny", denyFilter: "" });
			var result = toolExecutor.executeTool({ name: "set_field", input: { title: KEY, field: "text", value: "stolen" } }, deny);
			expect(result).toContain("Access denied");
			expect($tw.wiki.getTiddlerText(KEY)).toBe("orig");
		});

		describe("reads return no key text", function() {
			var protections = {
				"allow [all[tiddlers]]": function() { return helpers.resolveProtectionFilter({ mode: "allow", allowFilter: "[all[tiddlers]]" }); },
				"deny with empty deny filter": function() { return helpers.resolveProtectionFilter({ mode: "deny", denyFilter: "" }); }
			};
			beforeEach(function() {
				$tw.wiki.addTiddler(new $tw.Tiddler({ title: KEY, text: "sk-zz-secret" }));
			});
			Object.keys(protections).forEach(function(label) {
				it("get_tiddler, " + label, function() {
					var result = toolExecutor.executeTool({ name: "get_tiddler", input: { title: KEY } }, protections[label]());
					expect(result).not.toContain("sk-zz-secret");
				});
				it("wikitext_render, " + label, function() {
					var result = toolExecutor.executeTool({ name: "wikitext_render", input: { wikitext: "{{" + KEY + "}}|<$text text={{{ [[" + KEY + "]get[text]] }}}/>" } }, protections[label]());
					expect(result).not.toContain("sk-zz-secret");
				});
			});
		});
	});

	describe("executeTool built-in variables __provider / __model", function() {
		var CONN = "$:/config/rimir/llm-connect/connections/";
		var DEFAULT = "$:/config/rimir/llm-connect/default-connection";
		var protection = function(chat) { return { filter: "", mode: "deny", chatTiddler: chat || "" }; };

		function addConn(id, name, type, model) {
			$tw.wiki.addTiddler(new $tw.Tiddler({
				title: CONN + id, tags: "$:/tags/rimir/llm-connect/connection",
				"connection-id": id, "connection-name": name, "connection-type": type, model: model
			}));
			addedTitles.push(CONN + id);
		}
		function run(chat) {
			return toolExecutor.executeTool({ name: "vars_probe", input: {} }, protection(chat)).trim();
		}

		beforeEach(function() {
			addTool("$:/test/tool-vars-probe", {
				"tool-name": "vars_probe",
				"tool-mode": "read",
				text: "<<__provider>>|<<__model>>"
			});
			addedTitles.push(DEFAULT);
		});

		it("uses the connection stored on the chat tiddler", function() {
			addConn("ctest1", "Test One", "claude", "model-one");
			addConn("ctest2", "Test Two", "azure", "model-two");
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEFAULT, text: "ctest1" }));
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: "$:/test/vars-chat", "llm-connection": "ctest2" }));
			addedTitles.push("$:/test/vars-chat");
			expect(run("$:/test/vars-chat")).toBe("azure|model-two");
		});

		it("reports the chat's own model when it has one", function() {
			addConn("ctest1", "Test One", "claude", "model-one");
			addConn("ctest2", "Test Two", "azure", "model-two");
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEFAULT, text: "ctest1" }));
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: "$:/test/vars-chat", "llm-connection": "ctest2", "llm-model": "chat-model" }));
			addedTitles.push("$:/test/vars-chat");
			expect(run("$:/test/vars-chat")).toBe("azure|chat-model");
		});

		it("falls back to the default connection without a chat tiddler", function() {
			addConn("ctest1", "Test One", "claude", "model-one");
			addConn("ctest2", "Test Two", "azure", "model-two");
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEFAULT, text: "ctest2" }));
			expect(run("")).toBe("azure|model-two");
			expect(run("$:/test/does-not-exist")).toBe("azure|model-two");
		});

		it("falls back to unknown when no connection exists, without throwing", function() {
			if (require("$:/plugins/rimir/llm-connect/connections").listConnections().length) {
				pending("shipped connections present");
				return;
			}
			expect(run("")).toBe("unknown|unknown");
		});
	});
});
