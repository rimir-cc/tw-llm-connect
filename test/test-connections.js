/*\
title: $:/plugins/rimir/llm-connect/test/test-connections.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect connections store and resolution.

\*/
"use strict";

describe("llm-connect: connections", function() {

	var cx = require("$:/plugins/rimir/llm-connect/connections");
	var P = "$:/config/rimir/llm-connect/connections/";
	var K = "$:/config/rimir/llm-connect/keys/";
	var DEF = "$:/config/rimir/llm-connect/default-connection";
	var added;

	beforeEach(function() { added = []; });
	afterEach(function() {
		added.forEach(function(t) { $tw.wiki.deleteTiddler(t); });
	});

	function add(title, fields) {
		$tw.wiki.addTiddler(new $tw.Tiddler({title: title}, fields));
		added.push(title);
	}
	function conn(id, name, type, extra) {
		add(P + id, $tw.utils.extend({
			tags: "$:/tags/rimir/llm-connect/connection",
			"connection-id": id,
			"connection-name": name,
			"connection-type": type
		}, extra || {}));
	}
	function setup() {
		conn("A1", "Zeta", "openai-compatible", {endpoint: "http://x/v1", model: "m1", "max-tokens": "100", "cheap-model": "c1", "expensive-model": "e1", "connection-description": "d"});
		conn("B2", "Alpha", "openai-compatible", {endpoint: "http://y/v1"});
		add(DEF, {text: "A1"});
	}

	it("listConnections sorts by name case-insensitively and maps fields", function() {
		setup();
		conn("C3", "beta", "claude");
		var l = cx.listConnections();
		expect(l.map(function(c) { return c.id; })).toEqual(["B2", "C3", "A1"]);
		var a = cx.getConnection("A1");
		expect(a.name).toBe("Zeta");
		expect(a.description).toBe("d");
		expect(a.type).toBe("openai-compatible");
		expect(a.fields.endpoint).toBe("http://x/v1");
		expect(a.fields.maxTokens).toBe("100");
		expect(a.cheapModel).toBe("c1");
		expect(a.expensiveModel).toBe("e1");
		expect(cx.getConnection("nope")).toBe(null);
	});

	it("resolveConnectionId handles default, id, name, type", function() {
		setup();
		expect(cx.resolveConnectionId("")).toBe("A1");
		expect(cx.resolveConnectionId(undefined)).toBe("A1");
		expect(cx.resolveConnectionId("B2")).toBe("B2");
		expect(cx.resolveConnectionId("Alpha")).toBe("B2");
		expect(cx.resolveConnectionId("openai-compatible")).toBe("A1");
		expect(cx.resolveConnectionId("claude")).toBe("");
		$tw.wiki.deleteTiddler(DEF);
		expect(cx.resolveConnectionId("openai-compatible")).toBe("B2");
	});

	it("getDefaultConnectionId falls back to first by name", function() {
		setup();
		add(DEF, {text: "GONE"});
		expect(cx.getDefaultConnectionId()).toBe("B2");
		$tw.wiki.deleteTiddler(DEF);
		$tw.wiki.deleteTiddler(P + "A1");
		$tw.wiki.deleteTiddler(P + "B2");
		expect(cx.getDefaultConnectionId()).toBe("");
	});

	it("round-trips awkward names", function() {
		var name = 'My "llama" [[x]]';
		conn("Q1", name, "openai-compatible");
		expect(cx.getConnection("Q1").name).toBe(name);
		expect(cx.resolveConnectionId(name)).toBe("Q1");
	});

	it("connectionConfig builds the flat shape", function() {
		setup();
		add(K + "A1", {text: "k-1"});
		var c = cx.connectionConfig("A1");
		expect(c.provider).toBe("openai-compatible");
		expect(c.connection).toBe("A1");
		expect(c.connectionName).toBe("Zeta");
		expect(c.apiKey).toBe("k-1");
		expect(c.model).toBe("m1");
		expect(c.maxTokens).toBe("100");
		expect(c.endpoint).toBe("http://x/v1");
		expect(c.tiers).toEqual({cheap: "c1", expensive: "e1"});
		expect(cx.connectionConfig("B2").maxTokens).toBe("4096");
		var u = cx.connectionConfig("zzz");
		expect(u.provider).toBe("");
		expect(u.apiKey).toBe("");
		expect(u.tiers).toEqual({cheap: "", expensive: ""});
	});

	it("isConfigured follows the type's required field", function() {
		conn("C1", "C", "claude");
		expect(cx.isConfigured("C1")).toBe(false);
		add(K + "C1", {text: "key"});
		expect(cx.isConfigured("C1")).toBe(true);
		conn("O1", "O", "openai-compatible", {endpoint: "http://z"});
		expect(cx.isConfigured("O1")).toBe(true);
		conn("O2", "O2", "openai-compatible");
		expect(cx.isConfigured("O2")).toBe(false);
		expect(cx.isConfigured("nope")).toBe(false);
	});

	describe("resolveChatConnection", function() {
		it("returns an existing connection without notice", function() {
			setup();
			expect(cx.resolveChatConnection({"llm-connection": "B2"})).toEqual({id: "B2", notice: ""});
		});
		it("missing connection uses stored name in notice", function() {
			setup();
			expect(cx.resolveChatConnection({"llm-connection": "GONE", "llm-connection-name": "Old", "llm-connection-type": "openai-compatible"}))
				.toEqual({id: "A1", notice: 'Connection "Old" no longer exists, using "Zeta".'});
		});
		it("missing connection falls back to type then provider in notice", function() {
			setup();
			expect(cx.resolveChatConnection({"llm-connection": "GONE", "llm-connection-type": "openai-compatible"}).notice)
				.toBe('Connection "openai-compatible" no longer exists, using "Zeta".');
			expect(cx.resolveChatConnection({"llm-connection": "GONE", "llm-provider": "openai-compatible"}).notice)
				.toBe('Connection "openai-compatible" no longer exists, using "Zeta".');
		});
		it("old chat with only llm-provider resolves silently", function() {
			setup();
			expect(cx.resolveChatConnection({"llm-provider": "openai-compatible"})).toEqual({id: "A1", notice: ""});
		});
		it("no match gives a pick notice", function() {
			setup();
			expect(cx.resolveChatConnection({"llm-provider": "claude"}))
				.toEqual({id: "", notice: "No connection of type claude exists. Pick a connection."});
		});
	});
});
