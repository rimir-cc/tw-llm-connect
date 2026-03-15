/*\
title: $:/plugins/rimir/llm-connect/test/test-context-resolver.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect context-resolver: resolveTemplate, resolveOutputTarget, resolvePrompt.

\*/
"use strict";

describe("llm-connect: context-resolver", function() {

	var contextResolver = require("$:/plugins/rimir/llm-connect/context-resolver");

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
		var tiddlerFields = $tw.utils.extend({title: title}, fields);
		$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
		addedTitles.push(title);
	}

	describe("resolveTemplate", function() {
		it("should use tiddler field llm-context-template first (highest precedence)", function() {
			addTiddler("$:/test/source-with-template", {
				"llm-context-template": "$:/my/template",
				text: "source content"
			});
			var result = contextResolver.resolveTemplate({
				sourceTiddler: "$:/test/source-with-template",
				promptTemplate: "$:/test/prompt-tpl",
				contextTemplate: "$:/fallback"
			});
			expect(result).toBe("$:/my/template");
		});

		it("should use prompt template context-template field as second precedence", function() {
			addTiddler("$:/test/prompt-tpl", {
				"context-template": "$:/prompt-ctx-template"
			});
			var result = contextResolver.resolveTemplate({
				sourceTiddler: "$:/test/source-no-field",
				promptTemplate: "$:/test/prompt-tpl",
				contextTemplate: "$:/widget-fallback"
			});
			expect(result).toBe("$:/prompt-ctx-template");
		});

		it("should use widget contextTemplate as third precedence", function() {
			var result = contextResolver.resolveTemplate({
				contextTemplate: "$:/widget-attr-template"
			});
			expect(result).toBe("$:/widget-attr-template");
		});

		it("should use global default as fourth precedence", function() {
			addTiddler("$:/config/rimir/llm-connect/default-context-template", {
				text: "$:/global-default-template"
			});
			var result = contextResolver.resolveTemplate({});
			expect(result).toBe("$:/global-default-template");
		});

		it("should return null when nothing is configured (built-in fallback)", function() {
			// Ensure no global default
			$tw.wiki.deleteTiddler("$:/config/rimir/llm-connect/default-context-template");
			var result = contextResolver.resolveTemplate({});
			expect(result).toBeNull();
		});
	});

	describe("resolveOutputTarget", function() {
		it("should return null for 'display' target", function() {
			expect(contextResolver.resolveOutputTarget("display", "Source")).toBeNull();
		});

		it("should return null for empty/falsy target", function() {
			expect(contextResolver.resolveOutputTarget("", "Source")).toBeNull();
			expect(contextResolver.resolveOutputTarget(null, "Source")).toBeNull();
			expect(contextResolver.resolveOutputTarget(undefined, "Source")).toBeNull();
		});

		it("should parse field: prefix into title + field", function() {
			var result = contextResolver.resolveOutputTarget("field:summary", "$:/test/my-tiddler");
			expect(result).not.toBeNull();
			expect(result.title).toBe("$:/test/my-tiddler");
			expect(result.field).toBe("summary");
		});

		it("should return new-tiddler marker", function() {
			var result = contextResolver.resolveOutputTarget("new-tiddler", "Source");
			expect(result).not.toBeNull();
			expect(result.title).toBeNull();
			expect(result.field).toBe("text");
			expect(result.isNewTiddler).toBe(true);
		});

		it("should evaluate filter expressions to resolve target title", function() {
			addTiddler("$:/test/filter-target", {text: "target content"});
			var result = contextResolver.resolveOutputTarget("[[$:/test/filter-target]]", "Source");
			expect(result).not.toBeNull();
			expect(result.title).toBe("$:/test/filter-target");
			expect(result.field).toBe("text");
		});

		it("should return null for filter that yields no results", function() {
			var result = contextResolver.resolveOutputTarget("[tag[nonexistent-tag-xyz]]", "Source");
			expect(result).toBeNull();
		});
	});

	describe("resolvePrompt", function() {
		it("should return inline prompt when provided", function() {
			var result = contextResolver.resolvePrompt({prompt: "Summarize this"});
			expect(result).toBe("Summarize this");
		});

		it("should prefer inline prompt over template", function() {
			addTiddler("$:/test/prompt-template", {
				"prompt-template": "Template prompt"
			});
			var result = contextResolver.resolvePrompt({
				prompt: "Inline prompt",
				promptTemplate: "$:/test/prompt-template"
			});
			expect(result).toBe("Inline prompt");
		});

		it("should use prompt-template field from template tiddler", function() {
			addTiddler("$:/test/prompt-tpl-2", {
				"prompt-template": "Translate to German"
			});
			var result = contextResolver.resolvePrompt({
				promptTemplate: "$:/test/prompt-tpl-2"
			});
			expect(result).toBe("Translate to German");
		});

		it("should return empty string when nothing is configured", function() {
			var result = contextResolver.resolvePrompt({});
			expect(result).toBe("");
		});

		it("should return empty string for missing template tiddler", function() {
			var result = contextResolver.resolvePrompt({
				promptTemplate: "$:/test/nonexistent-prompt-tpl"
			});
			expect(result).toBe("");
		});
	});

	describe("renderContext", function() {
		it("should return defaults when no template and no source", function() {
			var result = contextResolver.renderContext({});
			expect(result.text).toBeNull();
			expect(result.outputMode).toBe("text");
			expect(result.outputTarget).toBe("display");
			expect(result.injectAs).toBe("user-message");
		});

		it("should render source tiddler text as built-in default", function() {
			addTiddler("$:/test/render-source", {
				text: "Hello world",
				type: "text/vnd.tiddlywiki"
			});
			var result = contextResolver.renderContext({
				sourceTiddler: "$:/test/render-source"
			});
			expect(result.text).toContain("Hello world");
			expect(result.outputMode).toBe("text");
		});

		it("should return null text when template tiddler does not exist", function() {
			var result = contextResolver.renderContext({
				templateTitle: "$:/test/nonexistent-tpl"
			});
			expect(result.text).toBeNull();
		});

		it("should read output-mode and output-target from template fields", function() {
			addTiddler("$:/test/tpl-with-fields", {
				text: "Template content",
				"output-mode": "markup",
				"output-target": "field:notes",
				"inject-as": "system-message"
			});
			var result = contextResolver.renderContext({
				templateTitle: "$:/test/tpl-with-fields"
			});
			expect(result.outputMode).toBe("markup");
			expect(result.outputTarget).toBe("field:notes");
			expect(result.injectAs).toBe("system-message");
		});

		it("should allow overriding outputMode via options", function() {
			addTiddler("$:/test/tpl-override", {
				text: "Content",
				"output-mode": "markup"
			});
			var result = contextResolver.renderContext({
				templateTitle: "$:/test/tpl-override",
				outputMode: "text"
			});
			expect(result.outputMode).toBe("text");
		});
	});
});
