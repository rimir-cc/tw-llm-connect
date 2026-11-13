/*\
title: $:/plugins/rimir/llm-connect/test/test-action-widget.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for <$llm-action>: connection errors are reported in the status tiddler, never thrown.

\*/
"use strict";

describe("llm-connect: action-widget", function() {

	var STATUS = "$:/temp/test/llm-action-status";
	var P = "$:/config/rimir/llm-connect/connections/";
	var TAG = "$:/tags/rimir/llm-connect/connection";
	var saved;

	beforeEach(function() {
		// Start from zero connections; restore the existing ones afterwards
		saved = $tw.wiki.filterTiddlers("[all[tiddlers]tag[" + TAG + "]]").map(function(t) { return $tw.wiki.getTiddler(t); });
		saved.forEach(function(t) { $tw.wiki.deleteTiddler(t.fields.title); });
	});
	afterEach(function() {
		$tw.wiki.filterTiddlers("[all[tiddlers]tag[" + TAG + "]]").forEach(function(t) { $tw.wiki.deleteTiddler(t); });
		saved.forEach(function(t) { $tw.wiki.addTiddler(t); });
		$tw.wiki.deleteTiddler(STATUS);
	});

	function invoke(attrs) {
		var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", "<$llm-action prompt=\"hi\" statusTiddler=\"" + STATUS + "\" " + attrs + "/>");
		var widget = $tw.wiki.makeWidget(parser, { document: $tw.fakeDocument });
		widget.render($tw.fakeDocument.createElement("div"), null);
		widget.invokeActions(widget, {});
		return $tw.wiki.getTiddlerText(STATUS);
	}

	it("zero connections: reports the error instead of throwing", function() {
		var status;
		expect(function() { status = invoke(""); }).not.toThrow();
		expect(status).toBe("Error: No connection configured");
	});

	it("unresolvable connection: names it", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: P + "A1", tags: TAG, "connection-name": "Main", "connection-type": "claude" }));
		expect(invoke("connection=\"nope\"")).toBe('Error: Unknown connection "nope"');
	});

	it("provider attribute maps by type, not by a same-named connection", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: P + "A1", tags: TAG, "connection-name": "azure", "connection-type": "claude" }));
		expect(invoke("provider=\"azure\"")).toBe('Error: No connection of type "azure"');
	});
});
