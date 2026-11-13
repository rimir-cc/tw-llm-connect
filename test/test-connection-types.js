/*\
title: $:/plugins/rimir/llm-connect/test/test-connection-types.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect connection-types registry.

\*/
"use strict";

describe("llm-connect: connection-types", function() {

	var ct = require("$:/plugins/rimir/llm-connect/connection-types");
	var FAKE = "$:/plugins/rimir/llm-connect/connection-types/fake";

	afterEach(function() {
		$tw.wiki.deleteTiddler(FAKE);
	});

	it("listTypes returns the four built-in types sorted by caption", function() {
		var types = ct.listTypes().map(function(t) { return t.type; });
		expect(types).toEqual(["azure", "claude", "openai", "openai-compatible"]);
	});

	it("getType azure has ordered fields", function() {
		expect(ct.getType("azure").fields).toEqual(["endpoint","api-key","deployment","api-version","model","max-tokens"]);
		expect(ct.getType("azure").required).toBe("api-key");
	});

	it("getType openai-compatible requires endpoint", function() {
		expect(ct.getType("openai-compatible").required).toBe("endpoint");
	});

	it("getType unknown returns null", function() {
		expect(ct.getType("nope")).toBe(null);
	});

	it("picks up a newly added type tiddler", function() {
		$tw.wiki.addTiddler({
			title: FAKE,
			tags: "$:/tags/rimir/llm-connect/connection-type",
			"connection-type": "fake",
			caption: "Fake",
			"connection-fields": "api-key model",
			"required-field": "api-key"
		});
		var t = ct.getType("fake");
		expect(t.caption).toBe("Fake");
		expect(t.fields).toEqual(["api-key", "model"]);
		expect(ct.listTypes().length).toBe(5);
	});
});
