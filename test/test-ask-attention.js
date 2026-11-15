/*\
title: $:/plugins/rimir/llm-connect/test/test-ask-attention.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the ask_user attention helpers (tab title marker, notification gate).

\*/
"use strict";

describe("llm-connect: ask-attention", function() {

	var att = require("$:/plugins/rimir/llm-connect/ask-attention");

	it("titleWithMarker adds exactly one prefix when pending", function() {
		expect(att.titleWithMarker("Wiki", true)).toBe("(?) Wiki");
		expect(att.titleWithMarker("(?) Wiki", true)).toBe("(?) Wiki");
	});

	it("titleWithMarker removes the prefix when not pending", function() {
		expect(att.titleWithMarker("(?) Wiki", false)).toBe("Wiki");
		expect(att.titleWithMarker("Wiki", false)).toBe("Wiki");
	});

	it("shouldNotify is true when hidden or unfocused", function() {
		expect(att.shouldNotify({ hidden: true, hasFocus: function() { return true; } })).toBe(true);
		expect(att.shouldNotify({ hidden: false, hasFocus: function() { return false; } })).toBe(true);
		expect(att.shouldNotify({ hidden: false, hasFocus: function() { return true; } })).toBe(false);
	});

	describe("focusDialog", function() {
		function el(name) {
			return { name: name, focused: false, focus: function() { this.focused = true; doc.activeElement = this; } };
		}
		var doc, dialog, inner;
		function makeDoc(innerSel) {
			doc = { activeElement: null };
			inner = innerSel ? el("inner") : null;
			dialog = el("dialog");
			dialog.queried = [];
			dialog.contains = function(x) { return x === dialog || x === inner; };
			dialog.querySelector = function(sel) {
				dialog.queried.push(sel);
				return inner && sel === innerSel ? inner : null;
			};
			doc.querySelector = function(sel) { return sel === ".llm-ask-dialog" ? dialog : null; };
		}

		it("focuses the first text field of the form", function() {
			makeDoc(".llm-ask-body textarea, .llm-ask-body input");
			expect(att.focusDialog(doc)).toBe(inner);
			expect(inner.focused).toBe(true);
		});

		it("falls back to the first button, then to the dialog itself", function() {
			makeDoc(".llm-ask-body button");
			expect(att.focusDialog(doc)).toBe(inner);
			makeDoc(null);
			expect(att.focusDialog(doc)).toBe(dialog);
			expect(dialog.focused).toBe(true);
		});

		it("leaves focus alone when it is already inside the dialog, and does nothing without a dialog", function() {
			makeDoc(".llm-ask-body textarea, .llm-ask-body input");
			doc.activeElement = inner;
			expect(att.focusDialog(doc)).toBe(inner);
			expect(inner.focused).toBe(false);
			expect(att.focusDialog({ querySelector: function() { return null; } })).toBeNull();
		});
	});

	it("notificationContent: title is the heading (else '<source> asks'), body the first prompt", function() {
		var text = JSON.stringify([{ prompt: "First?", kind: "text" }, { prompt: "Second?", kind: "text" }]);
		expect(att.notificationContent({ text: text, "ask.title": "Setup", "ask.source-label": "Note A" }))
			.toEqual({ title: "Setup", body: "First?" });
		expect(att.notificationContent({ text: text, "ask.source-label": "Note A" }))
			.toEqual({ title: "Note A asks", body: "First?" });
		expect(att.notificationContent({ text: "not json" }))
			.toEqual({ title: "LLM asks", body: "The LLM has a question for you" });
	});

	it("requestPermission asks only while permission is 'default'", function() {
		var asked = 0;
		var N = { permission: "default", requestPermission: function() { asked++; } };
		expect(att.requestPermission(N)).toBe(true);
		N.permission = "granted";
		expect(att.requestPermission(N)).toBe(false);
		N.permission = "denied";
		expect(att.requestPermission(N)).toBe(false);
		expect(att.requestPermission(null)).toBe(false);
		expect(asked).toBe(1);
	});

	it("Test button and Notifications checkbox send the permission message (user gesture)", function() {
		var text = $tw.wiki.getTiddlerText("$:/plugins/rimir/llm-connect/settings/tools");
		expect(text).toContain("\\procedure llm-ask-request-permission() <$action-sendmessage $message=\"" + att.PERMISSION_MESSAGE + "\"/>");
		expect(text).toContain("<$eventcatcher selector=\"input\" $click=<<llm-ask-request-permission>>>");
		expect(text).toMatch(/<\$button class="tc-btn-big-green">\s*<<llm-ask-request-permission>>/);
	});

	it("clicking Test sends the permission message and raises a sample question", function() {
		var Widget = require("$:/core/modules/widgets/widget.js").widget;
		var root = new Widget({}, { wiki: $tw.wiki, document: $tw.fakeDocument });
		var got = 0;
		root.addEventListener(att.PERMISSION_MESSAGE, function() { got++; return false; });
		var w = $tw.wiki.makeTranscludeWidget("$:/plugins/rimir/llm-connect/settings/tools",
			{ parentWidget: root, document: $tw.fakeDocument, mode: "block", importPageMacros: true });
		w.render($tw.fakeDocument.createElement("div"), null);
		function find(x) {
			if(x.parseTreeNode && x.parseTreeNode.type === "button" && x.getAttribute("class") === "tc-btn-big-green") { return x; }
			for(var i = 0; i < (x.children || []).length; i++) { var r = find(x.children[i]); if(r) { return r; } }
			return null;
		}
		var btn = find(w);
		expect(btn).not.toBeNull();
		var before = $tw.wiki.filterTiddlers("[prefix[$:/temp/rimir/llm-connect/ask/settings-test/]]");
		btn.invokeActions(btn, {});
		expect(got).toBe(1);
		$tw.wiki.filterTiddlers("[prefix[$:/temp/rimir/llm-connect/ask/settings-test/]]").forEach(function(t) {
			if(before.indexOf(t) === -1) { $tw.wiki.deleteTiddler(t); }
		});
	});

	it("Tools settings tab renders the Ask user section with its config fields", function() {
		var html = $tw.wiki.renderTiddler("text/html", "$:/plugins/rimir/llm-connect/settings/tools", { variables: {} });
		expect(html).toContain("Ask user");
		expect(html).toContain("Timeout (minutes)");
		expect(html).toContain("Test");
	});

	describe("change listener", function() {
		var P = "$:/temp/rimir/llm-connect/ask/r/c";
		var calls, fakeWiki, doc, notified, pendingNow, focused, filters;
		beforeEach(function() {
			calls = 0; notified = []; pendingNow = [];
			doc = { title: "Wiki" };
			focused = 0; filters = [];
			fakeWiki = {
				filterTiddlers: function(f) { calls++; filters.push(f); return pendingNow.slice(); },
				getTiddlerText: function(t) { return $tw.wiki.getTiddlerText(t); }
			};
		});
		function make() {
			return att.createChangeListener({ wiki: fakeWiki, doc: doc, notify: function(t) { notified.push(t); },
				focus: function() { focused++; } });
		}

		it("uses the shared pending filter tiddler (also used by the overlay)", function() {
			var l = make();
			l({ [P]: { modified: true } });
			expect(filters).toEqual([$tw.wiki.getTiddlerText("$:/plugins/rimir/llm-connect/ui/ask-pending-filter").trim()]);
			expect(filters[0]).toMatch(/^\[all\[tiddlers\]field:ask\.status\[pending\]prefix\[/);
		});

		it("focuses the dialog when a new question becomes the oldest pending one", function() {
			var l = make();
			var Q = "$:/temp/rimir/llm-connect/ask/r/d";
			pendingNow = [P];
			l({ [P]: { modified: true } });
			expect(focused).toBe(1);
			// a newer question queues behind the shown one: no focus steal
			pendingNow = [P, Q];
			l({ [Q]: { modified: true } });
			expect(focused).toBe(1);
			// the shown one settles, the next one is shown
			pendingNow = [Q];
			l({ [P]: { modified: true } });
			expect(focused).toBe(2);
			pendingNow = [];
			l({ [Q]: { modified: true } });
			expect(focused).toBe(2);
		});

		it("does not evaluate the pending filter for unrelated changes", function() {
			var l = make();
			l({ "Some tiddler": { modified: true } });
			expect(calls).toBe(0);
			expect(doc.title).toBe("Wiki");
		});

		it("marks the title, notifies once, and re-applies the marker without re-filtering", function() {
			var l = make();
			pendingNow = [P];
			l({ [P]: { modified: true } });
			expect(calls).toBe(1);
			expect(doc.title).toBe("(?) Wiki");
			doc.title = "Wiki"; // TW core refreshed the title
			l({ "Unrelated": { modified: true } });
			expect(calls).toBe(1);
			expect(doc.title).toBe("(?) Wiki");
			l({ [P]: { modified: true } });
			expect(notified).toEqual([P]);
		});

		it("clears the marker when nothing is pending and re-notifies a later question", function() {
			var l = make();
			pendingNow = [P];
			l({ [P]: { modified: true } });
			pendingNow = [];
			l({ [P]: { modified: true } });
			expect(doc.title).toBe("Wiki");
			pendingNow = [P];
			l({ [P]: { modified: true } });
			expect(notified).toEqual([P, P]);
		});
	});
});
