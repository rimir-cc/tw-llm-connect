/*\
title: $:/plugins/rimir/llm-connect/test/test-widget-helpers.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect widget-helpers: resolveProtectionFilter, resolveTools, resolveProviderConfig.

\*/
"use strict";

describe("llm-connect: widget-helpers", function() {

	var helpers = require("$:/plugins/rimir/llm-connect/widget-helpers");

	var addedTitles;
	beforeEach(function() {
		addedTitles = [];
	});
	afterEach(function() {
		for (var i = 0; i < addedTitles.length; i++) {
			$tw.wiki.deleteTiddler(addedTitles[i]);
		}
	});

	function addTiddler(title, fields) {
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.utils.extend({ title: title }, fields)));
		addedTitles.push(title);
	}

	describe("keysExclusion", function() {
		var KEYS = "[prefix[$:/config/rimir/llm-connect/keys/]]";
		it("removes keys from the allow set in allow mode", function() {
			expect(helpers.keysExclusion("allow")).toBe(" -" + KEYS);
		});
		it("adds keys to the deny set in deny mode", function() {
			expect(helpers.keysExclusion("deny")).toBe(" " + KEYS);
		});
		it("is what resolveProtectionFilter appends for each mode", function() {
			expect(helpers.resolveProtectionFilter({mode: "allow"}).filter).toContain(helpers.keysExclusion("allow").trim());
			expect(helpers.resolveProtectionFilter({mode: "deny"}).filter).toContain(helpers.keysExclusion("deny").trim());
		});
	});

	describe("resolveProtectionFilter", function() {
		it("should default to allow mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "allow" });
			addTiddler("$:/config/rimir/llm-connect/allow-filter", { text: "[all[tiddlers]]" });
			var result = helpers.resolveProtectionFilter({});
			expect(result.mode).toBe("allow");
			expect(result.filter).toContain("[all[tiddlers]]");
		});

		it("should use deny mode when configured", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "deny" });
			addTiddler("$:/config/rimir/llm-connect/protection-filter", { text: "[prefix[$:/]]" });
			var result = helpers.resolveProtectionFilter({ mode: "deny" });
			expect(result.mode).toBe("deny");
			expect(result.filter).toContain("[prefix[$:/]]");
		});

		it("should normalize invalid mode to allow", function() {
			var result = helpers.resolveProtectionFilter({ mode: "invalid" });
			expect(result.mode).toBe("allow");
		});

		it("should append extra allowFilter in allow mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "allow" });
			addTiddler("$:/config/rimir/llm-connect/allow-filter", { text: "[all[tiddlers]]" });
			var result = helpers.resolveProtectionFilter({ allowFilter: "[tag[Test]]" });
			expect(result.filter).toContain("[all[tiddlers]]");
			expect(result.filter).toContain("[tag[Test]]");
		});

		it("should append extra denyFilter in deny mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "deny" });
			addTiddler("$:/config/rimir/llm-connect/protection-filter", { text: "[prefix[$:/]]" });
			var result = helpers.resolveProtectionFilter({ mode: "deny", denyFilter: "[tag[Secret]]" });
			expect(result.filter).toContain("[prefix[$:/]]");
			expect(result.filter).toContain("[tag[Secret]]");
		});

		it("should append base protection filter with correct polarity", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "allow" });
			addTiddler("$:/config/rimir/llm-connect/allow-filter", { text: "[all[tiddlers]]" });
			addTiddler("$:/config/rimir/llm-connect/base-protection-filter", { text: "[prefix[$:/config/]]" });
			var result = helpers.resolveProtectionFilter({});
			expect(result.filter).toContain("-[subfilter{$:/config/rimir/llm-connect/base-protection-filter}]");
		});

		it("should append base protection as additive in deny mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "deny" });
			addTiddler("$:/config/rimir/llm-connect/protection-filter", { text: "" });
			addTiddler("$:/config/rimir/llm-connect/base-protection-filter", { text: "[prefix[$:/config/]]" });
			var result = helpers.resolveProtectionFilter({ mode: "deny" });
			expect(result.filter).toContain("[subfilter{$:/config/rimir/llm-connect/base-protection-filter}]");
			expect(result.filter).not.toContain("-[subfilter{$:/config/rimir/llm-connect/base-protection-filter}]");
		});

		it("should append excluded plugin filters in allow mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "allow" });
			addTiddler("$:/config/rimir/llm-connect/allow-filter", { text: "[all[tiddlers]]" });
			addTiddler("$:/config/rimir/llm-connect/excluded-plugins", { text: "$:/plugins/example/alpha $:/plugins/example/beta" });
			var result = helpers.resolveProtectionFilter({});
			expect(result.filter).toContain("-[all[shadows+tiddlers]prefix[$:/plugins/example/alpha]]");
			expect(result.filter).toContain("-[all[shadows+tiddlers]prefix[$:/plugins/example/beta]]");
		});

		it("should append excluded plugin filters as additive in deny mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "deny" });
			addTiddler("$:/config/rimir/llm-connect/protection-filter", { text: "" });
			addTiddler("$:/config/rimir/llm-connect/excluded-plugins", { text: "$:/plugins/example/alpha" });
			var result = helpers.resolveProtectionFilter({ mode: "deny" });
			expect(result.filter).toContain("[all[shadows+tiddlers]prefix[$:/plugins/example/alpha]]");
			expect(result.filter).not.toContain("-[all[shadows+tiddlers]prefix[$:/plugins/example/alpha]]");
		});

		it("should append hard protection filter in allow mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "allow" });
			addTiddler("$:/config/rimir/llm-connect/allow-filter", { text: "[all[tiddlers]]" });
			addTiddler("$:/config/rimir/llm-connect/hard-protection-filter", { text: "[prefix[$:/state/]]" });
			var result = helpers.resolveProtectionFilter({});
			expect(result.filter).toContain("-[subfilter{$:/config/rimir/llm-connect/hard-protection-filter}]");
		});

		it("should handle no config tiddlers gracefully", function() {
			// Even without explicit config tiddlers, should return a valid result
			var result = helpers.resolveProtectionFilter({});
			expect(result.mode === "allow" || result.mode === "deny").toBe(true);
			expect(typeof result.filter).toBe("string");
		});

		it("always excludes key tiddlers in allow mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "allow" });
			addTiddler("$:/config/rimir/llm-connect/allow-filter", { text: "[all[tiddlers]]" });
			addTiddler("$:/config/rimir/llm-connect/keys/A1", { text: "secret" });
			var result = helpers.resolveProtectionFilter({});
			expect(result.filter).toContain("-[prefix[$:/config/rimir/llm-connect/keys/]]");
			expect($tw.wiki.filterTiddlers(result.filter)).not.toContain("$:/config/rimir/llm-connect/keys/A1");
		});

		it("always includes key tiddlers in the deny filter in deny mode", function() {
			addTiddler("$:/config/rimir/llm-connect/protection-mode", { text: "deny" });
			addTiddler("$:/config/rimir/llm-connect/protection-filter", { text: "" });
			addTiddler("$:/config/rimir/llm-connect/keys/A1", { text: "secret" });
			var result = helpers.resolveProtectionFilter({});
			expect(result.filter).toContain(" [prefix[$:/config/rimir/llm-connect/keys/]]");
			expect($tw.wiki.filterTiddlers(result.filter)).toContain("$:/config/rimir/llm-connect/keys/A1");
		});
		describe("keys stay excluded after the llm-help grant", function() {
			var KEY = "$:/config/rimir/llm-connect/keys/A1";
			beforeEach(function() {
				var orig = $tw.wiki.isShadowTiddler;
				spyOn($tw.wiki, "isShadowTiddler").and.callFake(function(title) {
					return title === "$:/plugins/rimir/llm-help/functions" || orig.call($tw.wiki, title);
				});
				addTiddler(KEY, { text: "secret", tags: "$:/tags/rimir/llm-help/page" });
			});

			it("allow mode: a key tagged as llm-help page is not allowed", function() {
				var result = helpers.resolveProtectionFilter({ mode: "allow" });
				expect(result.filter).toContain("$:/tags/rimir/llm-help/page");
				expect($tw.wiki.filterTiddlers(result.filter)).not.toContain(KEY);
			});

			it("deny mode: a key tagged as llm-help page stays denied", function() {
				addTiddler("$:/config/rimir/llm-connect/protection-filter", { text: "" });
				var result = helpers.resolveProtectionFilter({ mode: "deny" });
				expect(result.filter).toContain("$:/tags/rimir/llm-help/page");
				expect($tw.wiki.filterTiddlers(result.filter)).toContain(KEY);
			});
		});
	});

	describe("resolveProviderConfig", function() {
		var P = "$:/config/rimir/llm-connect/connections/";
		function conn(id, name, type, extra) {
			addTiddler(P + id, $tw.utils.extend({
				tags: "$:/tags/rimir/llm-connect/connection",
				"connection-id": id, "connection-name": name, "connection-type": type
			}, extra || {}));
		}
		beforeEach(function() {
			conn("A1", "Main", "claude", {model: "claude-sonnet-4-20250514", "max-tokens": "8192"});
			conn("B2", "Oai", "openai", {model: "gpt-4o"});
			addTiddler("$:/config/rimir/llm-connect/keys/A1", { text: "sk-test" });
			addTiddler("$:/config/rimir/llm-connect/keys/B2", { text: "sk-oai" });
			addTiddler("$:/config/rimir/llm-connect/default-connection", { text: "A1" });
		});

		it("empty ref uses the default connection (llm-inline contract)", function() {
			addTiddler("$:/config/rimir/llm-connect/system-prompt", { text: "Be helpful" });
			var config = helpers.resolveProviderConfig("", "", "");
			expect(config.provider).toBe("claude");
			expect(config.connection).toBe("A1");
			expect(config.apiKey).toBe("sk-test");
			expect(config.model).toBe("claude-sonnet-4-20250514");
			expect(config.maxTokens).toBe("8192");
			expect(config.systemPrompt).toBe("Be helpful");
			var adapter = require("$:/plugins/rimir/llm-connect/orchestrator").getAdapter(config.provider);
			expect(typeof adapter.buildRequest).toBe("function");
		});

		it("type name resolves to a connection of that type", function() {
			var config = helpers.resolveProviderConfig("openai");
			expect(config.provider).toBe("openai");
			expect(config.connection).toBe("B2");
			expect(config.apiKey).toBe("sk-oai");
		});

		it("a type ref never picks a connection merely named like the type", function() {
			conn("N1", "openai", "claude", {model: "named"});
			expect(helpers.resolveProviderConfig("openai").connection).toBe("B2");
			expect(helpers.resolveProviderConfig({type: "openai"}).connection).toBe("B2");
			expect(helpers.resolveProviderConfig({connection: "openai"}).connection).toBe("N1");
		});

		it("an unresolvable type or connection throws a readable error", function() {
			expect(function() { helpers.resolveProviderConfig({type: "azure"}); }).toThrowError('No connection of type "azure"');
			expect(function() { helpers.resolveProviderConfig("nope"); }).toThrowError('Unknown connection "nope"');
		});

		it("should override model when specified", function() {
			var config = helpers.resolveProviderConfig("claude", "m-x", "");
			expect(config.connection).toBe("A1");
			expect(config.model).toBe("m-x");
		});

		it("should override systemPrompt when specified", function() {
			addTiddler("$:/config/rimir/llm-connect/system-prompt", { text: "default prompt" });
			var config = helpers.resolveProviderConfig(null, null, "Custom prompt");
			expect(config.systemPrompt).toBe("Custom prompt");
		});
	});

	describe("resolveTools", function() {
		it("should return empty array when no filter and no group", function() {
			var tools = helpers.resolveTools(null, null);
			expect(tools).toEqual([]);
		});

		it("should return empty array for both empty strings", function() {
			var tools = helpers.resolveTools("", "");
			expect(tools).toEqual([]);
		});
	});
});
