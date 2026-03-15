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
});
