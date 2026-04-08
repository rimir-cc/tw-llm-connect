/*\
title: $:/plugins/rimir/llm-connect/test/test-orchestrator.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect orchestrator: getProviderConfig, getConfiguredProviders, getCachedModels, getAdapter.

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

	describe("getProviderConfig", function() {
		it("should read claude config from wiki tiddlers", function() {
			addTiddler("$:/config/rimir/llm-connect/provider", { text: "claude" });
			addTiddler("$:/config/rimir/llm-connect/providers/claude/api-key", { text: "sk-abc" });
			addTiddler("$:/config/rimir/llm-connect/providers/claude/model", { text: "claude-sonnet-4-20250514" });
			addTiddler("$:/config/rimir/llm-connect/providers/claude/max-tokens", { text: "4096" });
			addTiddler("$:/config/rimir/llm-connect/system-prompt", { text: "You are helpful" });

			var config = orchestrator.getProviderConfig("claude");
			expect(config.provider).toBe("claude");
			expect(config.apiKey).toBe("sk-abc");
			expect(config.model).toBe("claude-sonnet-4-20250514");
			expect(config.maxTokens).toBe("4096");
			expect(config.systemPrompt).toBe("You are helpful");
		});

		it("should read openai config", function() {
			addTiddler("$:/config/rimir/llm-connect/providers/openai/api-key", { text: "sk-oai" });
			addTiddler("$:/config/rimir/llm-connect/providers/openai/model", { text: "gpt-4o" });
			var config = orchestrator.getProviderConfig("openai");
			expect(config.provider).toBe("openai");
			expect(config.apiKey).toBe("sk-oai");
			expect(config.model).toBe("gpt-4o");
		});

		it("should read azure config with endpoint and deployment", function() {
			addTiddler("$:/config/rimir/llm-connect/providers/azure/api-key", { text: "az-key" });
			addTiddler("$:/config/rimir/llm-connect/providers/azure/endpoint", { text: "https://myinstance.openai.azure.com" });
			addTiddler("$:/config/rimir/llm-connect/providers/azure/deployment", { text: "gpt-4o" });
			addTiddler("$:/config/rimir/llm-connect/providers/azure/api-version", { text: "2025-04-01-preview" });
			var config = orchestrator.getProviderConfig("azure");
			expect(config.provider).toBe("azure");
			expect(config.endpoint).toBe("https://myinstance.openai.azure.com");
			expect(config.deployment).toBe("gpt-4o");
			expect(config.apiVersion).toBe("2025-04-01-preview");
		});

		it("should fall back to default provider when none specified", function() {
			addTiddler("$:/config/rimir/llm-connect/provider", { text: "openai" });
			addTiddler("$:/config/rimir/llm-connect/providers/openai/api-key", { text: "sk-default" });
			var config = orchestrator.getProviderConfig();
			expect(config.provider).toBe("openai");
			expect(config.apiKey).toBe("sk-default");
		});

		it("should default to claude when no provider configured", function() {
			$tw.wiki.deleteTiddler("$:/config/rimir/llm-connect/provider");
			var config = orchestrator.getProviderConfig();
			expect(config.provider).toBe("claude");
		});

		it("should return empty strings for missing config", function() {
			var config = orchestrator.getProviderConfig("nonexistent");
			expect(config.apiKey).toBe("");
			expect(config.model).toBe("");
			expect(config.endpoint).toBe("");
		});
	});

	describe("getConfiguredProviders", function() {
		it("should return providers that have API keys set", function() {
			addTiddler("$:/config/rimir/llm-connect/providers/claude/api-key", { text: "sk-claude" });
			addTiddler("$:/config/rimir/llm-connect/providers/openai/api-key", { text: "sk-openai" });
			// Azure has no key
			$tw.wiki.deleteTiddler("$:/config/rimir/llm-connect/providers/azure/api-key");
			var providers = orchestrator.getConfiguredProviders();
			expect(providers).toContain("claude");
			expect(providers).toContain("openai");
			expect(providers).not.toContain("azure");
		});

		it("should return empty array when no providers configured", function() {
			$tw.wiki.deleteTiddler("$:/config/rimir/llm-connect/providers/claude/api-key");
			$tw.wiki.deleteTiddler("$:/config/rimir/llm-connect/providers/openai/api-key");
			$tw.wiki.deleteTiddler("$:/config/rimir/llm-connect/providers/azure/api-key");
			var providers = orchestrator.getConfiguredProviders();
			expect(providers.length).toBe(0);
		});
	});

	describe("getCachedModels", function() {
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

		it("should throw for unknown provider", function() {
			expect(function() { orchestrator.getAdapter("nonexistent"); }).toThrow();
		});
	});
});
