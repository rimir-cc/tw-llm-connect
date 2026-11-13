/*\
title: $:/plugins/rimir/llm-connect/test/test-orchestrator.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect orchestrator: getProviderConfig, getConfiguredConnections, tiers, fetchModels, getCachedModels, getAdapter.

\*/
"use strict";

describe("llm-connect: orchestrator", function() {

	var orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");

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
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.utils.extend({ title: title }, fields)));
		addedTitles.push(title);
	}

	var P = "$:/config/rimir/llm-connect/connections/";
	var K = "$:/config/rimir/llm-connect/keys/";
	var DEF = "$:/config/rimir/llm-connect/default-connection";

	function conn(id, name, type, extra) {
		addTiddler(P + id, $tw.utils.extend({
			tags: "$:/tags/rimir/llm-connect/connection",
			"connection-id": id,
			"connection-name": name,
			"connection-type": type
		}, extra || {}));
	}
	function clearConnections() {
		$tw.wiki.filterTiddlers("[all[tiddlers]tag[$:/tags/rimir/llm-connect/connection]]").forEach(function(t) {
			addedTitles.push(t);
		});
	}

	describe("getProviderConfig", function() {
		it("should resolve by type, name, id", function() {
			conn("A1", "Main", "claude", {model: "m1", "max-tokens": "123"});
			addTiddler(K + "A1", { text: "sk-abc" });
			addTiddler(DEF, { text: "A1" });
			["claude", "Main", "A1", ""].forEach(function(ref) {
				var c = orchestrator.getProviderConfig(ref);
				expect(c.provider).toBe("claude");
				expect(c.connection).toBe("A1");
				expect(c.apiKey).toBe("sk-abc");
				expect(c.model).toBe("m1");
				expect(c.maxTokens).toBe("123");
			});
		});

		it("should have empty provider when no connection exists", function() {
			var saved = $tw.wiki.filterTiddlers("[all[tiddlers]tag[$:/tags/rimir/llm-connect/connection]]");
			var tids = saved.map(function(t) { return $tw.wiki.getTiddler(t); });
			saved.forEach(function(t) { $tw.wiki.deleteTiddler(t); });
			try {
				expect(orchestrator.getProviderConfig("").provider).toBe("");
				expect(function() { orchestrator.getAdapter(""); }).toThrowError("No connection configured");
				expect(orchestrator.getConfiguredConnections()).toEqual([]);
			} finally {
				tids.forEach(function(t) { $tw.wiki.addTiddler(t); });
			}
		});
	});

	describe("getConfiguredConnections", function() {
		it("lists configured connections only", function() {
			conn("A1", "Main", "claude");
			conn("B2", "Local", "openai-compatible", {endpoint: "http://gpu/v1"});
			conn("C3", "NoKey", "openai");
			addTiddler(K + "A1", { text: "k" });
			var ids = orchestrator.getConfiguredConnections();
			expect(ids).toContain("A1");
			expect(ids).toContain("B2");
			expect(ids).not.toContain("C3");
		});
	});

	describe("tier routing", function() {
		it("getTierConfig follows the enabled flag", function() {
			addTiddler("$:/config/rimir/llm-connect/tier-routing-enabled", { text: "yes" });
			expect(orchestrator.getTierConfig()).toEqual({enabled: true});
			addTiddler("$:/config/rimir/llm-connect/tier-routing-enabled", { text: "no" });
			expect(orchestrator.getTierConfig()).toBe(null);
		});

		it("applyTierConfig switches model within the connection", function() {
			var cfg = {provider: "claude", connection: "A1", model: "big", tiers: {cheap: "small", expensive: ""}};
			var c = orchestrator.applyTierConfig(cfg, "cheap");
			expect(c.model).toBe("small");
			expect(c.connection).toBe("A1");
			expect(c.provider).toBe("claude");
			expect(orchestrator.applyTierConfig(cfg, "expensive")).toBe(cfg);
			expect(orchestrator.applyTierConfig(cfg, "default")).toBe(cfg);
		});
	});

	describe("fetchModels", function() {
		it("rejects an unconfigured connection with the required field caption", function(done) {
			conn("A1", "Main", "claude");
			orchestrator.fetchModels("A1")["catch"](function(e) {
				expect(e.message).toMatch(/^No .+ configured for Main$/);
				done();
			});
		});
	});

	describe("getCachedModels", function() {
		it("reads models/<connection id>", function() {
			addTiddler("$:/temp/rimir/llm-connect/models/A1", { text: '[{"id":"x","label":"x"}]' });
			expect(orchestrator.getCachedModels("A1")[0].id).toBe("x");
		});

		it("should return cached models from temp tiddler", function() {
			var models = [{ id: "gpt-4o", label: "gpt-4o" }, { id: "gpt-4o-mini", label: "gpt-4o-mini" }];
			addTiddler("$:/temp/rimir/llm-connect/models/openai", {
				text: JSON.stringify(models),
				type: "application/json"
			});
			var result = orchestrator.getCachedModels("openai");
			expect(result.length).toBe(2);
			expect(result[0].id).toBe("gpt-4o");
		});

		it("should return empty array when no cache exists", function() {
			$tw.wiki.deleteTiddler("$:/temp/rimir/llm-connect/models/nocache");
			var result = orchestrator.getCachedModels("nocache");
			expect(result.length).toBe(0);
		});

		it("should return empty array for invalid JSON cache", function() {
			addTiddler("$:/temp/rimir/llm-connect/models/broken", { text: "not json" });
			var result = orchestrator.getCachedModels("broken");
			expect(result.length).toBe(0);
		});
	});

	describe("getAdapter", function() {
		it("should load claude adapter", function() {
			var adapter = orchestrator.getAdapter("claude");
			expect(adapter.name).toBe("claude");
			expect(typeof adapter.buildRequest).toBe("function");
		});

		it("should load openai adapter", function() {
			var adapter = orchestrator.getAdapter("openai");
			expect(adapter.name).toBe("openai");
		});

		it("should load azure adapter", function() {
			var adapter = orchestrator.getAdapter("azure");
			expect(adapter.name).toBe("azure");
		});

		it("should load openai-compatible adapter", function() {
			var adapter = orchestrator.getAdapter("openai-compatible");
			expect(adapter.name).toBe("openai-compatible");
		});

		it("should throw for empty type", function() {
			expect(function() { orchestrator.getAdapter(""); }).toThrowError("No connection configured");
		});

		it("should throw for unknown provider", function() {
			expect(function() { orchestrator.getAdapter("nonexistent"); }).toThrow();
		});
	});
	describe("runAction signal", function() {
		// Modules run in TW's shared vm context; free identifiers resolve against it
		var sandboxGlobal = $tw.utils.sandbox;
		var origXHR, xhrs, stubAdapter;
		beforeEach(function() {
			origXHR = sandboxGlobal.XMLHttpRequest;
			xhrs = [];
			sandboxGlobal.XMLHttpRequest = function() {
				this.aborted = false;
				this.calls = [];
				xhrs.push(this);
			};
			sandboxGlobal.XMLHttpRequest.prototype.open = function() { this.calls.push("open"); };
			sandboxGlobal.XMLHttpRequest.prototype.setRequestHeader = function() { this.calls.push("setRequestHeader"); };
			sandboxGlobal.XMLHttpRequest.prototype.send = function() { this.calls.push("send"); };
			sandboxGlobal.XMLHttpRequest.prototype.abort = function() { this.aborted = true; };
			stubAdapter = {
				buildRequest: function() { return { url: "http://x", headers: {}, body: "{}" }; },
				parseResponse: function() { return { type: "text", content: "ok" }; }
			};
		});
		afterEach(function() {
			sandboxGlobal.XMLHttpRequest = origXHR;
		});

		// The TW module sandbox has no AbortController; minimal stand-in
		function fakeController() {
			var listeners = [];
			var signal = {
				aborted: false,
				addEventListener: function(type, fn) { listeners.push(fn); }
			};
			return {
				signal: signal,
				abort: function() {
					signal.aborted = true;
					listeners.slice().forEach(function(fn) { fn(); });
				}
			};
		}

		function tick(n) {
			var p = Promise.resolve();
			for (var i = 0; i < n; i++) p = p.then(function() {});
			return p;
		}

		it("aborts the single-turn request", function(done) {
			var ac = fakeController();
			var p = orchestrator.runAction({ prompt: "x", config: {}, adapter: stubAdapter, signal: ac.signal });
			tick(20).then(function() {
				ac.abort();
				return p;
			}).then(function() {
				done.fail("expected rejection");
			}, function(err) {
				expect(err.message).toBe("Request aborted");
				expect(xhrs[xhrs.length - 1].aborted).toBe(true);
				done();
			});
		});

		it("aborts the tool-loop request", function(done) {
			var ac = fakeController();
			var p = orchestrator.runAction({ prompt: "x", config: {}, adapter: stubAdapter, signal: ac.signal,
				tools: [{ name: "t", description: "", schema: {} }], toolExecutor: {} });
			tick(20).then(function() {
				ac.abort();
				return p;
			}).then(function() {
				done.fail("expected rejection");
			}, function(err) {
				expect(err.message).toBe("Request aborted");
				expect(xhrs[xhrs.length - 1].aborted).toBe(true);
				done();
			});
		});

		it("already-aborted signal rejects", function(done) {
			var ac = fakeController();
			ac.abort();
			orchestrator.runAction({ prompt: "x", config: {}, adapter: stubAdapter, signal: ac.signal }).then(function() {
				done.fail("expected rejection");
			}, function(err) {
				expect(err.message).toBe("Request aborted");
				done();
			});
		});
	});
});
