/*\
title: $:/plugins/rimir/llm-connect/test/test-messages-widget.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for <$llm-messages>: read-only rendering of a stored llm-messages field.

\*/
"use strict";

describe("llm-connect: messages-widget", function() {

	var T = "$:/temp/test/llm-messages-widget";
	var MSGS = [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "search", input: { q: "x" } }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "result" }] },
		{ role: "assistant", content: "done" }
	];

	afterEach(function() { $tw.wiki.deleteTiddler(T); });

	function setMessages(value) {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: T, "llm-messages": value }));
	}
	function has(el, cls) { return (" " + el.className + " ").indexOf(" " + cls + " ") !== -1; }
	function render(attrs) {
		var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", "<$llm-messages tiddler='" + T + "' " + (attrs || "") + "/>\n\n");
		var widget = $tw.wiki.makeWidget(parser, { document: $tw.fakeDocument });
		var parent = $tw.fakeDocument.createElement("div");
		widget.render(parent, null);
		return { widget: widget, parent: parent };
	}
	function container(r) { return r.parent.children[0]; }
	function messages(r) { return container(r).children.filter(function(c) { return has(c, "llm-chat-message"); }); }
	function tools(r) { return container(r).children.filter(function(c) { return has(c, "llm-chat-message-tool"); }); }

	it("renders each message of the field", function() {
		setMessages(JSON.stringify(MSGS));
		var r = render();
		expect(messages(r).length).toBeGreaterThan(1);
		expect(messages(r).length).toBe(4);
	});

	it("uses tool-display class, default brief", function() {
		setMessages(JSON.stringify(MSGS));
		var r = render();
		expect(has(container(r), "llm-chat-messages")).toBe(true);
		expect(has(container(r), "llm-chat-tools-brief")).toBe(true);
		var r2 = render("tool-display='details' class='extra'");
		expect(has(container(r2), "llm-chat-tools-details")).toBe(true);
		expect(has(container(r2), "extra")).toBe(true);
	});

	it("re-renders when the tiddler changes", function() {
		setMessages(JSON.stringify(MSGS.slice(0, 2)));
		var r = render();
		var before = messages(r).length;
		setMessages(JSON.stringify(MSGS));
		var changed = {};
		changed[T] = { modified: true };
		r.widget.refresh(changed);
		expect(messages(r).length).toBeGreaterThan(before);
	});

	it("keeps expanded tool messages across re-render", function() {
		setMessages(JSON.stringify(MSGS.slice(0, 3)));
		var r = render();
		tools(r)[0].className += " llm-chat-tool-expanded";
		setMessages(JSON.stringify(MSGS));
		var changed = {};
		changed[T] = { modified: true };
		r.widget.refresh(changed);
		expect(has(tools(r)[0], "llm-chat-tool-expanded")).toBe(true);
		expect(has(tools(r)[1], "llm-chat-tool-expanded")).toBe(false);
	});

	it("does not re-render when only another field of the tiddler changes", function() {
		setMessages(JSON.stringify(MSGS));
		var r = render();
		var c = container(r);
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(T), { "llm-log": "[1]" }));
		var changed = {};
		changed[T] = { modified: true };
		expect(r.widget.refresh(changed)).toBe(false);
		expect(container(r)).toBe(c);
	});

	it("keeps the scroll position across re-render, sticks to the bottom when it was there", function() {
		setMessages(JSON.stringify(MSGS.slice(0, 2)));
		var r = render();
		var changed = {};
		changed[T] = { modified: true };
		// scrolled up: keep scrollTop
		var c = container(r);
		c.scrollTop = 40; c.scrollHeight = 500; c.clientHeight = 100;
		setMessages(JSON.stringify(MSGS.slice(0, 3)));
		r.widget.refresh(changed);
		expect(container(r)).not.toBe(c);
		expect(container(r).scrollTop).toBe(40);
		// at the bottom: stick to the (new) bottom — fake elements get a scrollHeight of 900
		var proto = Object.getPrototypeOf(c);
		Object.defineProperty(proto, "scrollHeight", { configurable: true,
			get: function() { return this._sh === undefined ? 900 : this._sh; },
			set: function(v) { this._sh = v; } });
		try {
			c = container(r);
			c.scrollTop = 400; c.scrollHeight = 500; c.clientHeight = 100;
			setMessages(JSON.stringify(MSGS));
			r.widget.refresh(changed);
			expect(container(r).scrollTop).toBe(900);
		} finally {
			delete proto.scrollHeight;
		}
	});

	it("missing, empty or invalid JSON renders nothing and does not throw", function() {
		var r;
		expect(function() { r = render(); }).not.toThrow();
		expect(messages(r).length).toBe(0);
		["", "{oops", "{}"].forEach(function(v) {
			setMessages(v);
			expect(function() { r = render(); }).not.toThrow();
			expect(messages(r).length).toBe(0);
		});
	});
});
