/*\
title: $:/plugins/rimir/llm-connect/test/test-message-render.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the shared message renderer (chat-widget and <$llm-messages>).

\*/
"use strict";

describe("llm-connect: message-render", function() {

	var R = require("$:/plugins/rimir/llm-connect/message-render");
	var doc = $tw.fakeDocument;

	function spans(el) {
		var out = {};
		el.children.forEach(function(c) {
			out[c.className.replace("llm-chat-tool-", "")] = c.textContent;
		});
		return out;
	}

	it("assistant tool_use renders call with 100-char preview and full pretty JSON", function() {
		var input = { query: "x".repeat(200) };
		var els = R.renderMessage(doc, { role: "assistant", content: [{ type: "tool_use", id: "1", name: "search", input: input }] });
		expect(els.length).toBe(1);
		expect(els[0].className).toBe("llm-chat-message llm-chat-message-tool");
		var s = spans(els[0]);
		expect(s.preview.indexOf("\u{1F527} search(")).toBe(0);
		expect(s.preview.slice(-4)).toBe("...)");
		var args = s.preview.slice("\u{1F527} search(".length, -1);
		expect(args.length).toBe(103);
		expect(s.full).toBe("\u{1F527} search(" + JSON.stringify(input, null, 2) + ")");
	});

	it("assistant tool_use without input does not throw and shows empty args", function() {
		var els;
		expect(function() { els = R.renderMessage(doc, { role: "assistant", content: [{ type: "tool_use", id: "1", name: "noargs" }] }); }).not.toThrow();
		var s = spans(els[0]);
		expect(s.preview).toBe("\u{1F527} noargs({})");
		expect(s.full).toBe("\u{1F527} noargs({})");
	});

	it("OpenAI assistant tool_calls render as tool calls after the text (preview cut, full pretty JSON)", function() {
		var input = { query: "x".repeat(200) };
		var els = R.renderMessage(doc, { role: "assistant", content: "thinking", tool_calls: [
			{ id: "c1", type: "function", "function": { name: "search", arguments: JSON.stringify(input) } },
			{ id: "c2", type: "function", "function": { name: "raw", arguments: "{not json" } }
		] });
		expect(els.length).toBe(3);
		expect(els[0].className).toContain("llm-chat-md");
		expect(els[1].className).toBe("llm-chat-message llm-chat-message-tool");
		var s = spans(els[1]);
		expect(s.preview.indexOf("\u{1F527} search(")).toBe(0);
		expect(s.preview.slice("\u{1F527} search(".length, -1).length).toBe(103);
		expect(s.full).toBe("\u{1F527} search(" + JSON.stringify(input, null, 2) + ")");
		var s2 = spans(els[2]);
		expect(s2.preview).toBe("\u{1F527} raw({not json)");
		expect(s2.full).toBe("\u{1F527} raw({not json)");
	});

	it("OpenAI assistant with content null and tool_calls renders only the calls", function() {
		var els = R.renderMessage(doc, { role: "assistant", content: null, tool_calls: [
			{ id: "c1", type: "function", "function": { name: "list", arguments: "{}" } }
		] });
		expect(els.length).toBe(1);
		expect(spans(els[0]).preview).toBe("\u{1F527} list({})");
	});

	it("Claude tool_result string: preview 300 chars + '...', full complete", function() {
		var content = "y".repeat(1000);
		var els = R.renderMessage(doc, { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: content }] });
		expect(els.length).toBe(1);
		var s = spans(els[0]);
		expect(s.preview).toBe(content.substring(0, 300) + "...");
		expect(s.full).toBe(content);
	});

	it("Claude tool_result with block array content: full text is the joined text blocks", function() {
		var els = R.renderMessage(doc, { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }] });
		var s = spans(els[0]);
		expect(s.full).toContain("A");
		expect(s.full).toContain("B");
		expect(s.full).not.toContain("[object Object]");
		expect(s.preview).not.toContain("[object Object]");
	});

	it("OpenAI role:tool result: preview and full", function() {
		var content = "z".repeat(500);
		var els = R.renderMessage(doc, { role: "tool", tool_call_id: "1", content: content });
		var s = spans(els[0]);
		expect(s.preview).toBe(content.substring(0, 300) + "...");
		expect(s.full).toBe(content);
	});

	it("assistant text renders markdown into llm-chat-md", function() {
		var els = R.renderMessage(doc, { role: "assistant", content: "**bold**" });
		expect(els.length).toBe(1);
		expect(els[0].className).toBe("llm-chat-message llm-chat-message-assistant llm-chat-md");
		expect(els[0].innerHTML).toContain("bold");
		expect(R.markdownToHtml("")).toBe("");
	});

	it("_context user message renders collapsed summary", function() {
		var els = R.renderMessage(doc, { role: "user", _context: true, content: "hello" });
		expect(els[0].className).toBe("llm-chat-message llm-chat-message-context");
		expect(els[0].textContent.indexOf("\u{1F4CB} Context injected")).toBe(0);
	});

	it("bindToolToggle toggles llm-chat-tool-expanded once per click", function() {
		var listeners = [];
		var container = { addEventListener: function(t, fn) { listeners.push(fn); } };
		R.bindToolToggle(container);
		R.bindToolToggle(container);
		expect(listeners.length).toBe(1);
		var set = {};
		var tool = { classList: { toggle: function(c) { set[c] = !set[c]; } } };
		var child = { closest: function(sel) { return sel === ".llm-chat-message-tool" ? tool : null; } };
		listeners[0]({ target: child });
		expect(set["llm-chat-tool-expanded"]).toBe(true);
	});
});
