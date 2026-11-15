/*\
title: $:/plugins/rimir/llm-connect/test/test-ask-ui.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the ask_user form (ui/ask-form) and the modal overlay (ui/ask-overlay).

\*/
"use strict";

describe("llm-connect: ask UI", function() {

	var PREFIX = "$:/temp/rimir/llm-connect/ask/";
	var FORM = "$:/plugins/rimir/llm-connect/ui/ask-form";
	var OVERLAY = "$:/plugins/rimir/llm-connect/ui/ask-overlay";
	var DECLINE_STATE = "$:/temp/rimir/llm-connect/ask-decline/";
	var TIMEOUT_CFG = "$:/config/rimir/llm-connect/ask-timeout";
	var created, savedTimeout;

	function clear() {
		$tw.wiki.filterTiddlers("[prefix[" + PREFIX + "]] [prefix[" + DECLINE_STATE + "]]").forEach(function(t) {
			$tw.wiki.deleteTiddler(t);
		});
	}
	beforeEach(function() {
		created = [];
		clear();
		savedTimeout = $tw.wiki.getTiddler(TIMEOUT_CFG);
		$tw.wiki.deleteTiddler(TIMEOUT_CFG);
	});
	afterEach(function() {
		clear();
		created.forEach(function(t) { $tw.wiki.deleteTiddler(t); });
		if(savedTimeout) { $tw.wiki.addTiddler(savedTimeout); } else { $tw.wiki.deleteTiddler(TIMEOUT_CFG); }
	});

	function addQ(id, questions, extra) {
		var title = PREFIX + "run/" + id;
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: title, text: JSON.stringify(questions), "ask.status": "pending",
			"ask.source-label": "LLM", "ask.created": "20261115100000000"
		}, extra || {}));
		return title;
	}
	function get(title, field) { return $tw.wiki.getTiddler(title).fields[field]; }
	function renderOverlay() { return $tw.wiki.renderTiddler("text/html", OVERLAY); }
	function renderForm(title) {
		return $tw.wiki.renderText("text/html", "text/vnd.tiddlywiki",
			"<$transclude $tiddler=\"" + FORM + "\" $mode=\"block\"/>", {variables: {askTitle: title}});
	}
	function makeWidget(title) {
		var widget = $tw.wiki.makeTranscludeWidget(FORM, {
			parentWidget: $tw.rootWidget, variables: {askTitle: title}, document: $tw.fakeDocument, mode: "block"});
		widget.render($tw.fakeDocument.createElement("div"), null);
		return widget;
	}
	function findBtn(w, cls) {
		if(w.parseTreeNode && w.parseTreeNode.type === "button" &&
			(" " + (w.getAttribute("class") || "") + " ").indexOf(" " + cls + " ") !== -1) { return w; }
		for(var i = 0; i < (w.children || []).length; i++) { var r = findBtn(w.children[i], cls); if(r) { return r; } }
		return null;
	}
	function click(title, cls) {
		var b = findBtn(makeWidget(title), cls);
		expect(b).not.toBeNull();
		b.invokeActions(b, {});
	}

	var TEXT_Q = [{ prompt: "Free text?", kind: "text" }];

	it("overlay renders nothing without pending questions", function() {
		expect(renderOverlay().trim()).toBe("");
		addQ("a", TEXT_Q, { "ask.status": "answered" });
		expect(renderOverlay().trim()).toBe("");
	});

	it("overlay shows the oldest pending question, source label and '1 of 2'", function() {
		addQ("newer", [{ prompt: "Newer question", kind: "text" }], { "ask.created": "20261115110000000", "ask.source-label": "Note B" });
		addQ("older", [{ prompt: "Older question", kind: "text" }], { "ask.created": "20261115090000000", "ask.source-label": "Note A" });
		var h = renderOverlay();
		expect(h).toContain("llm-ask-backdrop");
		expect(h).toContain("llm-ask-dialog");
		expect(h).toContain("Older question");
		expect(h).not.toContain("Newer question");
		expect(h).toContain("Note A");
		expect(h).toContain("1 of 2");
	});

	it("overlay hides the counter when only one question is pending", function() {
		addQ("a", TEXT_Q);
		var h = renderOverlay();
		expect(h).toContain("Free text?");
		expect(h).not.toContain(" of 1");
	});

	it("form renders per kind: textarea, radios with descriptions, checkboxes, yes/no; Other fields when allow_other", function() {
		var t = addQ("a", [
			{ prompt: "Free text?", kind: "text" },
			{ prompt: "Which provider?", kind: "choice", allow_other: true,
				options: [{ value: "claude", label: "Claude", description: "Anthropic models" }, { value: "azure" }] },
			{ prompt: "Which plugins?", kind: "multi", options: [{ value: "kind" }, { value: "ports", label: "Ports" }] },
			{ prompt: "Proceed?", kind: "confirm" }
		], { "ask.title": "Setup", "ask.answer-1": "claude", "ask.answer-2": "ports" });
		var h = renderForm(t);
		expect(h).toContain("Setup");
		expect(h).toMatch(/<textarea[^>]*llm-ask-textarea/);
		expect((h.match(/type="radio"/g) || []).length).toBe(2);
		expect(h).toContain("Claude");
		expect(h).toContain("Anthropic models");
		expect(h).toContain("llm-ask-option-desc");
		expect(h).toContain(">azure<"); // label falls back to value
		expect((h.match(/type="checkbox"/g) || []).length).toBe(2);
		// current answers are reflected (radio selected, list checkbox checked)
		expect(h).toMatch(/tc-radio-selected"><input type="radio"><span><span class="llm-ask-option-label">Claude</);
		expect(h).toMatch(/<input checked="true" type="checkbox"><span><span class="llm-ask-option-label">Ports</);
		expect((h.match(/checked="true"/g) || []).length).toBe(1);
		expect(h).toContain("llm-ask-yes");
		expect(h).toContain("llm-ask-no");
		// Other only for the choice question (allow_other), not for the multi one
		expect((h.match(/llm-ask-other/g) || []).length).toBe(1);
	});

	it("Submit disabled until required answers exist", function() {
		var qs = [{ prompt: "Name?", kind: "text", required: true }, { prompt: "Optional?", kind: "text" },
			{ prompt: "Pick", kind: "choice", required: true, allow_other: true, options: [{ value: "a" }] }];
		var t = addQ("a", qs);
		var submit = function(h) { return h.match(/<button[^>]*llm-ask-submit[^>]*>/)[0]; };
		expect(submit(renderForm(t))).toContain("disabled");
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(t), { "ask.answer-0": "Bob" }));
		expect(submit(renderForm(t))).toContain("disabled");
		// Other text counts as an answer
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(t), { "ask.other-2": "custom" }));
		expect(submit(renderForm(t))).not.toContain("disabled");
		// whitespace-only is not an answer
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(t), { "ask.answer-0": "   " }));
		expect(submit(renderForm(t))).toContain("disabled");
	});

	it("Submit sets answered + settled; Decline sets declined + reason; confirm buttons set yes/no", function() {
		var t = addQ("a", [{ prompt: "Proceed?", kind: "confirm" }]);
		click(t, "llm-ask-yes");
		expect(get(t, "ask.answer-0")).toBe("yes");
		click(t, "llm-ask-no");
		expect(get(t, "ask.answer-0")).toBe("no");
		expect(renderForm(t)).toMatch(/llm-ask-no llm-ask-selected/);
		click(t, "llm-ask-submit");
		expect(get(t, "ask.status")).toBe("answered");
		expect(get(t, "ask.settled")).toMatch(/^\d{17}$/);

		var d = addQ("b", TEXT_Q);
		expect(renderForm(d)).not.toContain("llm-ask-reason");
		click(d, "llm-ask-decline");
		expect(get(d, "ask.status")).toBe("pending");
		expect(renderForm(d)).toContain("llm-ask-reason");
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(d), { "ask.decline-reason": "not now" }));
		click(d, "llm-ask-decline-confirm");
		expect(get(d, "ask.status")).toBe("declined");
		expect(get(d, "ask.decline-reason")).toBe("not now");
		expect(get(d, "ask.settled")).toMatch(/^\d{17}$/);
		expect($tw.wiki.tiddlerExists(DECLINE_STATE + d)).toBe(false);
	});

	it("Stop run sets aborted + settled, also while the decline reason is open", function() {
		var t = addQ("a", TEXT_Q);
		click(t, "llm-ask-stop");
		expect(get(t, "ask.status")).toBe("aborted");
		expect(get(t, "ask.settled")).toMatch(/^\d{17}$/);

		var d = addQ("b", TEXT_Q);
		click(d, "llm-ask-decline");
		click(d, "llm-ask-stop");
		expect(get(d, "ask.status")).toBe("aborted");
		expect($tw.wiki.tiddlerExists(DECLINE_STATE + d)).toBe(false);
	});

	it("dialog is focusable (tabindex -1) for moving focus into it", function() {
		addQ("a", TEXT_Q);
		expect(renderOverlay()).toMatch(/<div[^>]*class="llm-ask-dialog"[^>]*tabindex="-1"/);
	});

	it("overlay uses the shared pending filter (field before prefix, oldest first)", function() {
		var f = $tw.wiki.getTiddlerText("$:/plugins/rimir/llm-connect/ui/ask-pending-filter").trim();
		expect(f.indexOf("field:ask.status[pending]")).toBeLessThan(f.indexOf("prefix["));
		expect($tw.wiki.getTiddlerText(OVERLAY)).toContain("ask-functions");
		expect($tw.wiki.getTiddlerText(OVERLAY)).not.toContain("prefix[");
	});

	it("Decline cancel collapses the reason field", function() {
		var d = addQ("b", TEXT_Q);
		click(d, "llm-ask-decline");
		click(d, "llm-ask-decline-cancel");
		expect(get(d, "ask.status")).toBe("pending");
		expect(renderForm(d)).not.toContain("llm-ask-reason");
	});

	it("prompt markdown renders; labels with quotes, ]], {{, << render as text", function() {
		created.push("LeakTarget");
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: "LeakTarget", text: "LEAKED" }));
		var hostile = "He said \"hi\" ]] {{LeakTarget}} <<now>>";
		var t = addQ("a", [{ prompt: "Pick **one**", kind: "choice",
			options: [{ value: "v1", label: hostile, description: hostile }] }],
			{ "ask.title": hostile, "ask.source-label": hostile, "ask.intro": "Some *intro*" });
		var h = renderOverlay();
		expect(h).toContain("<strong>one</strong>");
		expect(h).toContain("<em>intro</em>");
		expect(h).not.toContain("LEAKED");
		expect(h).toContain("{{LeakTarget}}");
		expect(h).toContain("&lt;&lt;now&gt;&gt;");
		expect(h).toContain("]]");
		// heading, source label, option label and description: four plain-text copies
		expect(h.split("{{LeakTarget}}").length - 1).toBe(4);
	});

	it("shows the timeout hint only when a timeout is configured", function() {
		var t = addQ("a", TEXT_Q);
		expect(renderForm(t)).not.toContain("llm-ask-timeout");
		$tw.wiki.addTiddler(new $tw.Tiddler({ title: TIMEOUT_CFG, text: " 5\n" }));
		var h = renderForm(t);
		expect(h).toContain("llm-ask-timeout");
		expect(h).toContain("5 min");
	});

	it("no <p> wraps the dialog structure", function() {
		addQ("a", [
			{ prompt: "Free text?", kind: "text" },
			{ prompt: "Which?", kind: "choice", allow_other: true, options: [{ value: "a", description: "d" }] },
			{ prompt: "Several?", kind: "multi", options: [{ value: "a" }] },
			{ prompt: "Ok?", kind: "confirm" }
		], { "ask.title": "T", "ask.intro": "intro" });
		var h = renderOverlay();
		expect(h).not.toMatch(/<p>\s*<(div|form|fieldset)/);
		expect(h.trim().indexOf("<div class=\"llm-ask-backdrop")).toBe(0);
	});
});
