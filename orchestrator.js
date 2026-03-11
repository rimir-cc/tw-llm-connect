/*\
title: $:/plugins/rimir/llm-connect/orchestrator
type: application/javascript
module-type: library

Tool-use loop orchestrator — manages LLM conversation with tool calls

\*/
(function() {

"use strict";

var MAX_ITERATIONS = 10;

exports.getAdapter = function(providerName) {
	var moduleName = "$:/plugins/rimir/llm-connect/adapter-" + providerName;
	try {
		return require(moduleName);
	} catch(e) {
		throw new Error("Unknown provider: " + providerName);
	}
};

exports.getProviderConfig = function(providerName) {
	providerName = providerName || $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/provider") || "claude";
	var prefix = "$:/config/rimir/llm-connect/providers/" + providerName + "/";
	return {
		provider: providerName,
		apiKey: $tw.wiki.getTiddlerText(prefix + "api-key") || "",
		model: $tw.wiki.getTiddlerText(prefix + "model") || "",
		maxTokens: $tw.wiki.getTiddlerText(prefix + "max-tokens") || "4096",
		systemPrompt: $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/system-prompt") || "",
		endpoint: $tw.wiki.getTiddlerText(prefix + "endpoint") || "",
		deployment: $tw.wiki.getTiddlerText(prefix + "deployment") || "",
		apiVersion: $tw.wiki.getTiddlerText(prefix + "api-version") || ""
	};
};

/*
Run a conversation with tool-use loop.
options: {
  messages: array of messages (will be mutated),
  tools: array of tool definitions (from tool-executor.getToolDefinitions),
  config: provider config,
  adapter: provider adapter,
  toolExecutor: tool-executor module,
  onUpdate: function(messages) — called after each round-trip,
  onError: function(error) — called on error,
  signal: AbortController signal for cancellation
}
Returns a promise that resolves with the final messages array.
*/
exports.runConversation = function(options) {
	var messages = options.messages;
	var tools = options.tools || [];
	var config = options.config;
	var adapter = options.adapter;
	var toolExecutor = options.toolExecutor;
	var onUpdate = options.onUpdate || function() {};
	var onError = options.onError || function() {};
	var protectionFilter = options.protectionFilter || "";

	// Build allowed tool names set for execution-time enforcement
	var allowedToolNames = null;
	if (tools.length > 0) {
		allowedToolNames = {};
		for (var t = 0; t < tools.length; t++) {
			allowedToolNames[tools[t].name] = true;
		}
	}

	return new Promise(function(resolve, reject) {
		var iteration = 0;

		function doIteration() {
			if (iteration >= MAX_ITERATIONS) {
				onUpdate(messages);
				resolve(messages);
				return;
			}
			iteration++;

			var request = adapter.buildRequest(messages, tools, config);

			httpRequest(request, options.signal).then(function(responseText) {
				var parsed;
				try {
					parsed = adapter.parseResponse(responseText);
				} catch(e) {
					onError(e);
					reject(e);
					return;
				}

				if (parsed.type === "text") {
					messages.push({ role: "assistant", content: parsed.content });
					onUpdate(messages);
					resolve(messages);
					return;
				}

				if (parsed.type === "tool_use") {
					// Add assistant message with tool calls
					messages.push(adapter.buildAssistantMessage(parsed));

					// Execute each tool call (enforce allowed set)
					for (var i = 0; i < parsed.toolCalls.length; i++) {
						var tc = parsed.toolCalls[i];
						var result;
						if (allowedToolNames && !allowedToolNames[tc.name]) {
							result = "Error: Tool not available in current chat: " + tc.name;
						} else {
							result = toolExecutor.executeTool(tc, protectionFilter);
						}
						messages.push(adapter.buildToolResult(tc.id, result));
					}

					onUpdate(messages);
					doIteration();
				}
			})["catch"](function(err) {
				onError(err);
				reject(err);
			});
		}

		doIteration();
	});
};

/*
Run a single-turn action (no tool-use loop by default).
options: {
  prompt: string,
  contextText: string (optional),
  injectAs: "user-message" | "system-prompt",
  tools: array of tool definitions (optional, usually empty for action mode),
  config: provider config,
  adapter: provider adapter,
  toolExecutor: tool-executor module
}
Returns a promise that resolves with the response text.
*/
exports.runAction = function(options) {
	var messages = [];
	var config = $tw.utils.extend({}, options.config);

	// Inject context
	if (options.contextText) {
		if (options.injectAs === "system-prompt") {
			config.systemPrompt = (config.systemPrompt ? config.systemPrompt + "\n\n" : "") + options.contextText;
		} else {
			messages.push({ role: "user", content: options.contextText });
		}
	}

	// Add the actual prompt
	if (options.prompt) {
		messages.push({ role: "user", content: options.prompt });
	}

	var tools = options.tools || [];

	if (tools.length > 0) {
		// Action mode with tools — use the full loop
		return exports.runConversation({
			messages: messages,
			tools: tools,
			config: config,
			adapter: options.adapter,
			toolExecutor: options.toolExecutor,
			protectionFilter: options.protectionFilter || "",
			onUpdate: function() {},
			onError: function() {}
		}).then(function(msgs) {
			// Find the last assistant message
			for (var i = msgs.length - 1; i >= 0; i--) {
				if (msgs[i].role === "assistant" && msgs[i].content) {
					return msgs[i].content;
				}
			}
			return "";
		});
	}

	// Simple single-turn — one API call
	var adapter = options.adapter;
	var request = adapter.buildRequest(messages, [], config);

	return httpRequest(request).then(function(responseText) {
		var parsed = adapter.parseResponse(responseText);
		return parsed.content || "";
	});
};

/*
Fetch available models for a provider and cache in $:/temp tiddler.
Returns a promise that resolves with [{id, label}] or rejects on error.
*/
exports.fetchModels = function(providerName) {
	var config = exports.getProviderConfig(providerName);
	if (!config.apiKey) {
		return Promise.reject(new Error("No API key configured for " + providerName));
	}
	var adapter = exports.getAdapter(providerName);
	if (!adapter.buildModelListRequest) {
		return Promise.reject(new Error("Provider " + providerName + " does not support model listing"));
	}
	var request = adapter.buildModelListRequest(config);
	return httpGetRequest(request).then(function(responseText) {
		var models = adapter.parseModelListResponse(responseText);
		var cacheTiddler = "$:/temp/rimir/llm-connect/models/" + providerName;
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: cacheTiddler,
			text: JSON.stringify(models),
			type: "application/json"
		}));
		return models;
	});
};

/*
Get cached models for a provider, or empty array.
*/
exports.getCachedModels = function(providerName) {
	var text = $tw.wiki.getTiddlerText("$:/temp/rimir/llm-connect/models/" + providerName);
	if (!text) return [];
	try { return JSON.parse(text); } catch(e) { return []; }
};

/*
Get all configured providers (those with an API key set).
*/
exports.getConfiguredProviders = function() {
	var providers = ["claude", "openai", "azure"];
	var result = [];
	for (var i = 0; i < providers.length; i++) {
		var key = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/providers/" + providers[i] + "/api-key");
		if (key) {
			result.push(providers[i]);
		}
	}
	return result;
};

function httpGetRequest(requestConfig) {
	return new Promise(function(resolve, reject) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", requestConfig.url, true);
		var headers = requestConfig.headers;
		for (var key in headers) {
			xhr.setRequestHeader(key, headers[key]);
		}
		xhr.onload = function() {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve(xhr.responseText);
			} else {
				reject(new Error("API error " + xhr.status + ": " + xhr.responseText.substring(0, 200)));
			}
		};
		xhr.onerror = function() { reject(new Error("Network error")); };
		xhr.send();
	});
}

function httpRequest(requestConfig, signal) {
	return new Promise(function(resolve, reject) {
		var xhr = new XMLHttpRequest();
		xhr.open("POST", requestConfig.url, true);

		var headers = requestConfig.headers;
		for (var key in headers) {
			xhr.setRequestHeader(key, headers[key]);
		}

		if (signal) {
			signal.addEventListener("abort", function() {
				xhr.abort();
				reject(new Error("Request aborted"));
			});
		}

		xhr.onload = function() {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve(xhr.responseText);
			} else {
				var errorMsg = "API error " + xhr.status;
				try {
					var errData = JSON.parse(xhr.responseText);
					if (errData.error && errData.error.message) {
						errorMsg += ": " + errData.error.message;
					}
				} catch(e) {
					errorMsg += ": " + xhr.responseText.substring(0, 200);
				}
				reject(new Error(errorMsg));
			}
		};

		xhr.onerror = function() {
			reject(new Error("Network error"));
		};

		xhr.send(requestConfig.body);
	});
}

})();
