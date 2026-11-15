/*\
title: $:/plugins/rimir/llm-connect/test/test-ask-user.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the ask_user tool and its result template.

\*/
"use strict";

describe("llm-connect: ask_user tool", function() {

	var toolExecutor = require("$:/plugins/rimir/llm-connect/tool-executor");
	var orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");
	var TOOL = "$:/plugins/rimir/llm-connect/tools/ask-user";
	var TIMEOUT_CFG = "$:/config/rimir/llm-connect/ask-timeout";
	var PROT = function() { return { filter: "", mode: "deny" }; };
	var savedTimeout;

	function clearAsk() {
		$tw.wiki.filterTiddlers("[prefix[" + toolExecutor.ASK_PREFIX + "]]").forEach(function(t) {
			$tw.wiki.deleteTiddler(t);
		});
	}
	beforeEach(function() {
		clearAsk();
		savedTimeout = $tw.wiki.getTiddler(TIMEOUT_CFG);
	});
	afterEach(function() {
		clearAsk();
		if (savedTimeout) $tw.wiki.addTiddler(savedTimeout); else $tw.wiki.deleteTiddler(TIMEOUT_CFG);
	});

	function ask(input, id) {
		return toolExecutor.executeTool({ id: id || "c1", name: "ask_user", input: input }, PROT());
	}
	function fields(r) { return $tw.wiki.getTiddler(r.await).fields; }
	function settle(r, extra) {
		var t = $tw.wiki.getTiddler(r.await);
		$tw.wiki.addTiddler(new $tw.Tiddler(t, extra));
		return orchestrator.renderAwaitResult(r.tool, r.await);
	}

	var QS = [
		{ id: "provider", prompt: "Which provider?", kind: "choice", options: [{ value: "claude" }, { value: "azure" }], default: "claude" },
		{ id: "scope", prompt: "Which plugins?", kind: "multi", options: [{ value: "kind" }, { value: "ports" }], allow_other: true },
		{ prompt: "Free text?", kind: "text" }
	];

	it("creates a pending question tiddler with fields and pre-filled defaults", function() {
		var r = ask({ heading: "Setup", intro: "Some *intro*", questions: QS });
		expect(typeof r).toBe("object");
		expect(r.tool).toBe(TOOL);
		var f = fields(r);
		expect(f["ask.status"]).toBe("pending");
		expect(f["ask.title"]).toBe("Setup");
		expect(f["ask.intro"]).toBe("Some *intro*");
		expect(f["ask.source-label"]).toBe("LLM");
		expect(f["ask.created"]).toBeDefined();
		expect(f["ask.answer-0"]).toBe("claude");
		expect(f["ask.answer-1"]).toBeUndefined();
		expect(JSON.parse(f.text)).toEqual(QS);
	});

	it("multi default as a TW title list: description says so, form pre-ticks, result lists each value", function() {
		var t = $tw.wiki.getTiddler(TOOL).fields;
		expect(t["tool-description"]).toContain("space-separated list of option values");
		expect(t["tool-description"]).toContain("[[two words]]");
		expect(JSON.parse(t["tool-schema"]).properties.questions.items.properties["default"].description).toContain("[[two words]]");
		var r = ask({ questions: [{ id: "p", prompt: "Which?", kind: "multi",
			options: [{ value: "kind" }, { value: "two words" }, { value: "ports" }], default: "kind [[two words]]" }] });
		var form = $tw.wiki.renderText("text/html", "text/vnd.tiddlywiki",
			"<$transclude $tiddler=\"$:/plugins/rimir/llm-connect/ui/ask-form\" $mode=\"block\"/>", { variables: { askTitle: r.await } });
		expect((form.match(/checked="true"/g) || []).length).toBe(2);
		expect(settle(r, { "ask.status": "answered" })).toContain("answer: kind, two words");
	});

	it("ask.created sorts chronologically", function() {
		var a = ask({ questions: QS }, "a");
		var b = ask({ questions: QS }, "b");
		expect(fields(a)["ask.created"] <= fields(b)["ask.created"]).toBe(true);
		expect(String(fields(a)["ask.created"]).length).toBe(17);
	});

	it("questions as JSON string works; empty array, non-array and malformed give Error, no tiddler", function() {
		var ok = ask({ questions: JSON.stringify(QS) }, "s");
		expect(typeof ok).toBe("object");
		expect(JSON.parse(fields(ok).text)).toEqual(QS);
		["[]", "{\"a\":1}", "not json", "", "\"text\""].forEach(function(bad, n) {
			var r = ask({ questions: bad }, "bad" + n);
			expect(typeof r).toBe("string");
			expect(r.indexOf("Error:")).toBe(0);
		});
		expect(typeof ask({}, "none")).toBe("string");
		expect($tw.wiki.filterTiddlers("[prefix[" + toolExecutor.ASK_PREFIX + "]]").length).toBe(1);
	});

	it("result: answered with ids mapped, multi list joined with ', ', other", function() {
		var r = ask({ questions: QS });
		var out = settle(r, { "ask.status": "answered", "ask.answer-0": "azure", "ask.answer-1": "kind [[my ports]]", "ask.other-1": "also llm-inline", "ask.answer-2": "hello" });
		expect(out).toBe([
			"status: answered",
			"[provider] Which provider?",
			"  answer: azure",
			"[scope] Which plugins?",
			"  answer: kind, my ports",
			"  other: also llm-inline",
			"[3] Free text?",
			"  answer: hello"
		].join("\n"));
	});

	it("result: declined with reason", function() {
		var r = ask({ questions: QS });
		expect(settle(r, { "ask.status": "declined" })).toBe("status: declined");
		expect(settle(r, { "ask.status": "declined", "ask.decline-reason": "not now" })).toBe("status: declined — reason: not now");
	});

	it("result: timeout lists defaults", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: TIMEOUT_CFG, text: "5" }));
		var r = ask({ questions: QS });
		var out = settle(r, { "ask.status": "timeout" });
		expect(out.indexOf("status: timeout — user did not answer within 5 min")).toBe(0);
		expect(out).toContain("[provider] Which provider?\n  default: claude");
		expect(out).not.toContain("Free text");
		expect(out).toContain("Proceed with the defaults or stop and summarise.");
	});

	it("prompts containing quotes, ]], {{ and << appear verbatim in the result", function() {
		var nasty = "Say \"hi\" ]] {{Foo}} <<now>> <$text text=x/> ''b''";
		var r = ask({ questions: [{ id: "x", prompt: nasty, kind: "text" }] });
		var out = settle(r, { "ask.status": "answered", "ask.answer-0": nasty });
		expect(out).toBe("status: answered\n[x] " + nasty + "\n  answer: " + nasty);
	});
});
