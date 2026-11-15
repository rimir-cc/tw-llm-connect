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

		it("names a non-empty ref that resolves to nothing", function() {
			conn("A1", "Main", "claude");
			addTiddler(DEF, { text: "A1" });
			expect(function() { orchestrator.getProviderConfig("nope"); }).toThrowError('Unknown connection "nope"');
			expect(function() { orchestrator.getProviderConfig({connection: "nope"}); }).toThrowError('Unknown connection "nope"');
			expect(function() { orchestrator.getProviderConfig({type: "azure"}); }).toThrowError('No connection of type "azure"');
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
			spyOn(console, "warn");
			var result = orchestrator.getCachedModels("broken");
			expect(result.length).toBe(0);
			expect(console.warn).toHaveBeenCalled();
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
	// Modules run in TW's shared vm context; free identifiers resolve against it
	var sandboxGlobal = $tw.utils.sandbox;
	var origXHR, xhrs;
	function stubXHR() {
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
	}
	function restoreXHR() {
		sandboxGlobal.XMLHttpRequest = origXHR;
	}
	function completeWithOk() {
		sandboxGlobal.XMLHttpRequest.prototype.send = function() {
			var self = this;
			this.status = 200;
			this.responseText = "ok";
			Promise.resolve().then(function() { self.onload(); });
		};
	}

	// The TW module sandbox has no AbortController; minimal stand-in
	function fakeController() {
		var listeners = [];
		var signal = {
			aborted: false,
			listeners: listeners,
			addEventListener: function(type, fn) { listeners.push(fn); },
			removeEventListener: function(type, fn) {
				var i = listeners.indexOf(fn);
				if (i !== -1) listeners.splice(i, 1);
			}
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

	describe("runAction signal", function() {
		var stubAdapter;
		beforeEach(function() {
			stubXHR();
			stubAdapter = {
				buildRequest: function() { return { url: "http://x", headers: {}, body: "{}" }; },
				parseResponse: function() { return { type: "text", content: "ok" }; }
			};
		});
		afterEach(restoreXHR);

		it("single-call path reports onLog then onUpdate with the reply", function(done) {
			completeWithOk();
			var logs = [], updates = [];
			orchestrator.runAction({ prompt: "x", config: { model: "m1" }, adapter: stubAdapter,
				onLog: function(c, m) { logs.push([c, m]); },
				onUpdate: function(msgs) { updates.push(msgs); }
			}).then(function(r) {
				expect(r).toBe("ok");
				expect(logs.length).toBe(1);
				expect(logs[0][0]).toBe("loop");
				expect(logs[0][1]).toBe("single call \u2014 model=m1");
				expect(updates.length).toBe(1);
				expect(updates[0][updates[0].length - 1]).toEqual({ role: "assistant", content: "ok" });
				done();
			}, done.fail);
		});

		it("tool path passes onUpdate/onLog/onRequest/onResponse through to runConversation", function(done) {
			var spy = spyOn(orchestrator, "runConversation").and.returnValue(Promise.resolve([]));
			var cbs = { onUpdate: function() {}, onLog: function() {}, onRequest: function() {}, onResponse: function() {} };
			orchestrator.runAction({ prompt: "x", config: {}, adapter: stubAdapter, tools: [{}],
				onUpdate: cbs.onUpdate, onLog: cbs.onLog, onRequest: cbs.onRequest, onResponse: cbs.onResponse
			}).then(function() {
				var o = spy.calls.mostRecent().args[0];
				expect(o.onUpdate).toBe(cbs.onUpdate);
				expect(o.onLog).toBe(cbs.onLog);
				expect(o.onRequest).toBe(cbs.onRequest);
				expect(o.onResponse).toBe(cbs.onResponse);
				done();
			}, done.fail);
		});

		it("a throwing onUpdate/onLog does not fail the run", function(done) {
			completeWithOk();
			spyOn(console, "warn");
			orchestrator.runAction({ prompt: "x", config: {}, adapter: stubAdapter,
				onLog: function() { throw new Error("boom"); },
				onUpdate: function() { throw new Error("boom"); }
			}).then(function(r) {
				expect(r).toBe("ok");
				done();
			}, done.fail);
		});

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
	describe("await tools", function() {
		var ASK = "$:/temp/rimir/llm-connect/ask/test/";
		var TOOL = "$:/temp/rimir/llm-connect/test/await-tool";
		var TEMPLATE = "$:/temp/rimir/llm-connect/test/await-template";

		function changeListenerCount() {
			return (($tw.wiki.eventListeners || {}).change || []).length;
		}
		function wait(ms) {
			return new Promise(function(r) { setTimeout(r, ms); });
		}
		function waitFor(cond) {
			return new Promise(function(resolve, reject) {
				var n = 0;
				(function poll() {
					if (cond()) return resolve();
					if (++n > 200) return reject(new Error("waitFor timed out"));
					setTimeout(poll, 5);
				})();
			});
		}
		function settle(title, status) {
			$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(title), { "ask.status": status }));
		}
		function pending(title) {
			addTiddler(title, { "ask.status": "pending", "ask.title": "Pick " + title.split("/").pop() });
		}

		describe("waitForSettle", function() {
			var T = ASK + "w1";
			var baseline;
			beforeEach(function() {
				pending(T);
				baseline = changeListenerCount();
			});

			it("resolves on status change", function(done) {
				var p = orchestrator.waitForSettle(T, null, 30);
				expect(changeListenerCount()).toBe(baseline + 1);
				settle(T, "answered");
				p.then(function(status) {
					expect(status).toBe("answered");
					expect(changeListenerCount()).toBe(baseline);
					// a leftover timer would overwrite the status with "timeout"
					return wait(60);
				}).then(function() {
					expect($tw.wiki.getTiddler(T).fields["ask.status"]).toBe("answered");
					done();
				}, done.fail);
			});

			it("resolves declined when the tiddler is deleted", function(done) {
				var p = orchestrator.waitForSettle(T, null, 30);
				$tw.wiki.deleteTiddler(T);
				p.then(function(status) {
					expect(status).toBe("declined");
					expect(changeListenerCount()).toBe(baseline);
					return wait(60);
				}).then(function() {
					expect($tw.wiki.getTiddler(T)).toBeUndefined();
					done();
				}, done.fail);
			});

			it("sets timeout after timeoutMs", function(done) {
				orchestrator.waitForSettle(T, null, 20).then(function(status) {
					expect(status).toBe("timeout");
					var f = $tw.wiki.getTiddler(T).fields;
					expect(f["ask.status"]).toBe("timeout");
					expect(f["ask.settled"]).toBeTruthy();
					expect(changeListenerCount()).toBe(baseline);
					done();
				}, done.fail);
			});

			it("sets aborted on signal abort", function(done) {
				var ac = fakeController();
				var p = orchestrator.waitForSettle(T, ac.signal, 30);
				expect(ac.signal.listeners.length).toBe(1);
				ac.abort();
				p.then(function(status) {
					expect(status).toBe("aborted");
					expect($tw.wiki.getTiddler(T).fields["ask.status"]).toBe("aborted");
					expect(changeListenerCount()).toBe(baseline);
					expect(ac.signal.listeners.length).toBe(0);
					return wait(60);
				}).then(function() {
					expect($tw.wiki.getTiddler(T).fields["ask.status"]).toBe("aborted");
					done();
				}, done.fail);
			});

			it("an abort right after the user settled keeps the user's status (change event not yet delivered)", function(done) {
				var ac = fakeController();
				var p = orchestrator.waitForSettle(T, ac.signal, 0);
				settle(T, "answered");
				ac.abort();
				p.then(function(status) {
					expect(status).toBe("answered");
					expect($tw.wiki.getTiddler(T).fields["ask.status"]).toBe("answered");
					expect(changeListenerCount()).toBe(baseline);
					done();
				}, done.fail);
			});

			it("resolves immediately when already settled", function(done) {
				settle(T, "answered");
				orchestrator.waitForSettle(T, null, 0).then(function(status) {
					expect(status).toBe("answered");
					expect(changeListenerCount()).toBe(baseline);
					done();
				}, done.fail);
			});
		});

		describe("runConversation", function() {
			var requests, responses, logs, updates, executed;
			var adapter = {
				buildRequest: function(messages) {
					requests.push(JSON.parse(JSON.stringify(messages)));
					return { url: "http://x", headers: {}, body: "{}" };
				},
				parseResponse: function() { return responses.shift(); },
				buildAssistantMessage: function(parsed) { return { role: "assistant", toolCalls: parsed.toolCalls }; },
				buildToolResult: function(id, result) { return { role: "tool", id: id, content: result }; }
			};
			var executor = {
				executeTool: function(tc) {
					executed.push(tc.id);
					pending(ASK + tc.id);
					return { await: ASK + tc.id, tool: TOOL };
				}
			};

			beforeEach(function() {
				stubXHR();
				completeWithOk();
				requests = []; logs = []; updates = []; executed = [];
				addTiddler(TEMPLATE, { text: "status: <$text text={{{ [<awaitTitle>get[ask.status]] }}}/>" });
				addTiddler(TOOL, { "tool-result-template": TEMPLATE });
			});
			afterEach(function() {
				restoreXHR();
				$tw.wiki.filterTiddlers("[all[tiddlers]prefix[" + ASK + "]]").forEach(function(t) {
					$tw.wiki.deleteTiddler(t);
				});
			});

			function run(calls, signal) {
				responses = [
					{ type: "tool_use", toolCalls: calls.map(function(id) { return { id: id, name: "ask", input: {} }; }) },
					{ type: "text", content: "done" }
				];
				return orchestrator.runConversation({
					messages: [{ role: "user", content: "hi" }],
					tools: [{ name: "ask" }],
					config: { model: "m" },
					adapter: adapter,
					toolExecutor: executor,
					signal: signal,
					onLog: function(c, m) { logs.push([c, m]); },
					onUpdate: function(m) { updates.push(m); }
				});
			}
			function toolResults(messages) {
				return messages.filter(function(m) { return m.role === "tool"; }).map(function(m) { return m.content; });
			}

			it("waits, then sends the rendered result template as tool result", function(done) {
				var p = run(["c1"]);
				waitFor(function() { return !!$tw.wiki.getTiddler(ASK + "c1"); }).then(function() {
					return wait(20);
				}).then(function() {
					expect(requests.length).toBe(1);
					expect(updates.length).toBe(0);
					settle(ASK + "c1", "answered");
					return p;
				}).then(function() {
					expect(requests.length).toBe(2);
					expect(toolResults(requests[1])).toEqual(["status: answered"]);
					expect(logs).toContain(["tool", "awaiting user: Pick c1"]);
					expect(logs).toContain(["tool", "user answered"]);
					done();
				}, done.fail);
			});

			it("two await calls in one round settle in order", function(done) {
				var p = run(["c1", "c2"]);
				waitFor(function() { return !!$tw.wiki.getTiddler(ASK + "c1"); }).then(function() {
					return wait(20);
				}).then(function() {
					expect(executed).toEqual(["c1"]);
					expect($tw.wiki.getTiddler(ASK + "c2")).toBeUndefined();
					settle(ASK + "c1", "answered");
					return waitFor(function() { return !!$tw.wiki.getTiddler(ASK + "c2"); });
				}).then(function() {
					settle(ASK + "c2", "declined");
					return p;
				}).then(function() {
					expect(toolResults(requests[1])).toEqual(["status: answered", "status: declined"]);
					expect(requests[1].filter(function(m) { return m.role === "tool"; }).map(function(m) { return m.id; })).toEqual(["c1", "c2"]);
					done();
				}, done.fail);
			});

			it("times out after the configured ask-timeout (minutes)", function(done) {
				addTiddler("$:/config/rimir/llm-connect/ask-timeout", { text: " 0.0005 " });
				run(["c1"]).then(function() {
					expect(toolResults(requests[1])).toEqual(["status: timeout"]);
					expect(logs).toContain(["tool", "user timeout"]);
					done();
				}, done.fail);
			});

			it("renderAwaitResult truncates by max-tool-result-length", function() {
				pending(ASK + "r1");
				addTiddler("$:/config/rimir/llm-connect/max-tool-result-length", { text: "8" });
				expect(orchestrator.renderAwaitResult(TOOL, ASK + "r1")).toBe("status: \n... [truncated at 8 chars]");
			});

			it("abort while waiting rejects Request aborted without onUpdate", function(done) {
				var ac = fakeController();
				var p = run(["c1", "c2"], ac.signal);
				waitFor(function() { return !!$tw.wiki.getTiddler(ASK + "c1"); }).then(function() {
					ac.abort();
					return p;
				}).then(function() {
					done.fail("expected rejection");
				}, function(err) {
					expect(err.message).toBe("Request aborted");
					expect(updates.length).toBe(0);
					expect(requests.length).toBe(1);
					expect(executed).toEqual(["c1"]);
					expect($tw.wiki.getTiddler(ASK + "c1").fields["ask.status"]).toBe("aborted");
					done();
				});
			});

			it("Stop run from the form (status aborted) rejects an abort error and skips the rest", function(done) {
				var p = run(["c1", "c2"]);
				waitFor(function() { return !!$tw.wiki.getTiddler(ASK + "c1"); }).then(function() {
					settle(ASK + "c1", "aborted");
					return p;
				}).then(function() {
					done.fail("expected rejection");
				}, function(err) {
					expect(err.message).toBe("Request aborted");
					expect(err.aborted).toBe(true);
					expect(logs).toContain(["tool", "user aborted"]);
					expect(updates.length).toBe(0);
					expect(requests.length).toBe(1);
					expect(executed).toEqual(["c1"]);
					done();
				});
			});
		});
	});
});
