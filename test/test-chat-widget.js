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

	it("sendMessage: does nothing while a run is in progress (Stop button shown)", function() {
		conn("A1", "Main", "claude", "model-a");
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEF, text: "A1" }));
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-connection": "A1", "llm-model": "model-a" }));
		var w = makeWidget();
		w.textarea = { value: "second" };
		w.stopBtn = { style: { display: "inline-block" } };
		var statusCalls = 0;
		w.setStatus = function() { statusCalls++; };
		var controller = w.abortController = { marker: true };
		expect(w.isRunning()).toBe(true);
		w.sendMessage();
		expect(w.textarea.value).toBe("second");
		expect(statusCalls).toBe(0);
		expect(w.abortController).toBe(controller);
		expect($tw.wiki.getTiddler(CHAT).fields["llm-messages"]).toBe(MESSAGES);
		w.stopBtn.style.display = "none";
		expect(w.isRunning()).toBe(false);
	});

	it("sendMessage: a throw while preparing the run resets the Stop button so the next send works", function() {
		conn("A1", "Main", "claude", "model-a");
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: DEF, text: "A1" }));
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CHAT, "llm-messages": MESSAGES, "llm-connection": "A1", "llm-model": "model-a" }));
		var w = makeWidget();
		w.textarea = { value: "hello" };
		w.stopBtn = { style: {} };
		var status = "";
		w.setStatus = function(text) { status = text; };
		w.renderMessages = w.updateModelDisplay = w.updateTokenDisplay = w.updateToolWorkingIndicator = w.log = function() {};
		w.getWidgetHelpersModule = function() { throw new Error("Unknown provider: bogus"); };
		// (In the Jasmine sandbox `new AbortController()` already throws — also a setup throw)
		expect(function() { w.sendMessage(); }).not.toThrow();
		expect(status.indexOf("Error: ")).toBe(0);
		expect(w.stopBtn.style.display).toBe("none");
		expect(w.isRunning()).toBe(false);
	});

	it("ask_user source label: the pair-edit tiddler, else 'Chat'", function() {
		var w = makeWidget();
		expect(w.askSourceLabel()).toBe("Chat");
		w.sourceTiddler = "My Note";
		expect(w.askSourceLabel()).toBe("My Note");
	});

	it("status shows 'Waiting for your answer…' while ask_user waits and returns to Thinking after", function() {
		var w = makeWidget();
		var status = "Thinking...";
		w.setStatus = function(text) { status = text; };
		w.updateAskStatus("tool", "executed read_tiddler → x");
		expect(status).toBe("Thinking...");
		w.updateAskStatus("tool", "awaiting user: Pick one");
		expect(status).toBe("Waiting for your answer…");
		w.updateAskStatus("loop", "user answered");
		expect(status).toBe("Waiting for your answer…");
		w.updateAskStatus("tool", "user answered");
		expect(status).toBe("Thinking...");
		w.updateAskStatus("tool", "awaiting user: Next");
		w.updateAskStatus("tool", "user timeout");
		expect(status).toBe("Thinking...");
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

describe("llm-connect: chat-widget default help context", function() {

	var ChatWidget = require("$:/plugins/rimir/llm-connect/chat-widget")["llm-chat"];
	var CFG = "$:/config/rimir/llm-help/default-context";
	var CHAT = "$:/temp/test/llm-chat-help";
	var PAGE_TAG = "$:/tags/rimir/llm-help/page";
	var PAGES = ["$:/temp/test/help-a", "$:/temp/test/help-b", "$:/temp/test/help-c"];
	var savedCfg;

	beforeEach(function() {
		savedCfg = $tw.wiki.getTiddler(CFG);
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: PAGES[0], tags: PAGE_TAG, "llm-help-context": "zz-alpha" }));
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: PAGES[1], tags: PAGE_TAG, "llm-help-context": "zz-alpha/sub" }));
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: PAGES[2], tags: PAGE_TAG, "llm-help-context": "zz-beta" }));
	});
	afterEach(function() {
		PAGES.concat([CHAT]).forEach(function(t) { $tw.wiki.deleteTiddler(t); });
		$tw.wiki.deleteTiddler(CFG);
		if (savedCfg) $tw.wiki.addTiddler(savedCfg);
	});

	function initWith(attrs) {
		var w = new ChatWidget({ type: "llm-chat" }, { wiki: $tw.wiki, document: $tw.fakeDocument });
		w.attributes = $tw.utils.extend({ chatTiddler: CHAT }, attrs);
		w.execute();
		w.initDefaultHelpContext();
		return ($tw.wiki.getTiddler(CHAT).fields["llm-help-context"] || "").split(" ").filter(function(k) { return k.indexOf("zz-") === 0; });
	}

	it("falls back to llm-help's default-context config when defaultContext is unset", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CFG, text: "zz-alpha\n" }));
		expect(initWith({})).toEqual(["zz-alpha", "zz-alpha/sub"]);
	});

	it("selects nothing when neither the attribute nor the config is set", function() {
		$tw.wiki.deleteTiddler(CFG);
		expect(initWith({})).toEqual([]);
	});

	it("the defaultContext attribute replaces the config", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CFG, text: "zz-alpha" }));
		expect(initWith({ defaultContext: "zz-beta" })).toEqual(["zz-beta"]);
	});
});

describe("llm-connect: llm-default-help-context function", function() {

	var CFG = "$:/config/rimir/llm-help/default-context";
	var savedCfg;
	beforeEach(function() { savedCfg = $tw.wiki.getTiddler(CFG); });
	afterEach(function() { $tw.wiki.deleteTiddler(CFG); if (savedCfg) $tw.wiki.addTiddler(savedCfg); });

	function render(extra) {
		var text = "\\import [[$:/plugins/rimir/llm-connect/ui/chat-toolbar]]\n<$text text=<<llm-default-help-context \"" + extra + "\">>/>";
		return $tw.wiki.renderText("text/plain", "text/vnd.tiddlywiki", text);
	}

	it("prepends the config to the panel's extra keys", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CFG, text: "my-ctx\n" }));
		expect(render("rimir/typed shortcuts")).toBe("my-ctx rimir/typed shortcuts");
	});

	it("yields only the extra keys when the config is blank", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: CFG, text: "  " }));
		expect(render("rimir/typed shortcuts")).toBe("rimir/typed shortcuts");
	});
});
