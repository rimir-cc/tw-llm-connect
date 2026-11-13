/*\
title: $:/plugins/rimir/llm-connect/test/test-chat-widget.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for <$llm-chat> connection handling (no DOM: the widget is driven through execute/refresh/sendMessage).

\*/
"use strict";

describe("llm-connect: chat-widget connection", function() {

	var ChatWidget = require("$:/plugins/rimir/llm-connect/chat-widget")["llm-chat"];
	var P = "$:/config/rimir/llm-connect/connections/";
	var TAG = "$:/tags/rimir/llm-connect/connection";
	var DEF = "$:/config/rimir/llm-connect/default-connection";
	var CHAT = "$:/temp/test/llm-chat";
	var MESSAGES = JSON.stringify([{ role: "user", content: "x" }, { role: "assistant", content: "y" }]);
	var saved, savedDefault;

	beforeEach(function() {
		saved = $tw.wiki.filterTiddlers("[all[tiddlers]tag[" + TAG + "]]").map(function(t) { return $tw.wiki.getTiddler(t); });
		saved.forEach(function(t) { $tw.wiki.deleteTiddler(t.fields.title); });
		savedDefault = $tw.wiki.getTiddler(DEF);
		$tw.wiki.deleteTiddler(DEF);
	});
	afterEach(function() {
		$tw.wiki.filterTiddlers("[all[tiddlers]tag[" + TAG + "]]").forEach(function(t) { $tw.wiki.deleteTiddler(t); });
		saved.forEach(function(t) { $tw.wiki.addTiddler(t); });
		$tw.wiki.deleteTiddler(DEF);
		if (savedDefault) $tw.wiki.addTiddler(savedDefault);
		$tw.wiki.deleteTiddler(CHAT);
	});

	function conn(id, name, type, model) {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: P + id, tags: TAG, "connection-name": name, "connection-type": type, model: model }));
	}
	function makeWidget() {
		var w = new ChatWidget({ type: "llm-chat" }, { wiki: $tw.wiki, document: $tw.fakeDocument });
		w.attributes = { chatTiddler: CHAT };
		w.execute();
		return w;
	}

	describe("a started chat opens on its own connection", function() {
		beforeEach(function() {
			conn("A1", "Main", "claude", "model-a");
			conn("B2", "Other", "openai", "model-b");
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEF, text: "A1" }));
		});

		it("uses the connection's model when the chat has no llm-model", function() {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-connection": "B2", "llm-model": "" }));
			var w = makeWidget();
			expect(w.connection).toBe("B2");
			expect(w.model).toBe("model-b");
		});

		it("keeps the chat's own model when it has one", function() {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-connection": "B2", "llm-model": "model-x" }));
			var w = makeWidget();
			expect(w.connection).toBe("B2");
			expect(w.model).toBe("model-x");
		});

		it("a legacy chat with only llm-provider resolves by type", function() {
			$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-provider": "openai" }));
			var w = makeWidget();
			expect(w.connection).toBe("B2");
			expect(w.model).toBe("model-b");
		});
	});

	it("sendMessage: a connection deleted while the chat is open stops before any state change", function() {
		conn("A1", "Main", "claude", "model-a");
		conn("B2", "Other", "openai", "model-b");
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEF, text: "A1" }));
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-connection": "B2",
			"llm-connection-name": "Other", "llm-connection-type": "openai", "llm-model": "model-b" }));
		var w = makeWidget();
		expect(w.connection).toBe("B2");
		$tw.wiki.deleteTiddler(P + "B2");
		w.textarea = { value: "hello" };
		w.stopBtn = { style: {} };
		var status = "";
		w.setStatus = function(text) { status = text; };
		expect(function() { w.sendMessage(); }).not.toThrow();
		expect(status).toBe("No connection of type openai exists. Pick a connection.");
		expect(w.textarea.value).toBe("hello");
		expect(w.stopBtn.style.display).not.toBe("inline-block");
		expect($tw.wiki.getTiddler(CHAT).fields["llm-messages"]).toBe(MESSAGES);
	});

	it("sendMessage: a deleted connection with a same-type fallback shows the notice and waits", function() {
		conn("A1", "Main", "claude", "model-a");
		conn("B2", "Other", "openai", "model-b");
		conn("B3", "Third", "openai", "model-c");
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEF, text: "A1" }));
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-connection": "B2",
			"llm-connection-name": "Other", "llm-connection-type": "openai", "llm-model": "model-b" }));
		var w = makeWidget();
		$tw.wiki.deleteTiddler(P + "B2");
		w.textarea = { value: "hello" };
		w.stopBtn = { style: {} };
		var status = "";
		w.setStatus = function(text) { status = text; };
		w.sendMessage();
		expect(status).toBe('Connection "Other" no longer exists, using "Third".');
		expect(w.connection).toBe("B3");
		expect(w.textarea.value).toBe("hello");
		expect($tw.wiki.getTiddler(CHAT).fields["llm-messages"]).toBe(MESSAGES);
	});

	it("refresh: an empty chat picks up the first connection when it is added", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT }));
		var w = makeWidget();
		expect(w.connection).toBe("");
		conn("A1", "Main", "claude", "model-a");
		var changes = {};
		changes[P + "A1"] = { modified: true };
		w.refresh(changes);
		expect(w.connection).toBe("A1");
		expect(w.model).toBe("model-a");
	});
});
