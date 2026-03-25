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
	var protection = options.protectionFilter || { filter: "", mode: "allow" };

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

			// Resolve file_ref blocks before building the API request
			exports.resolveFileRefs(messages, adapter).then(function(resolvedMessages) {
				messages = resolvedMessages;
				var request = adapter.buildRequest(messages, tools, config);
				if (options.onRequest) {
					try { options.onRequest(request); } catch(e) { /* ignore */ }
				}
				return httpRequest(request, options.signal);
			}).then(function(responseText) {
				if (options.onResponse) {
					try { options.onResponse(responseText); } catch(e) { /* ignore */ }
				}
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
							result = toolExecutor.executeTool(tc, protection);
							// Auto-add created tiddlers to protection filter for subsequent calls
							if (tc.input && tc.input.title && result.indexOf("Error:") !== 0) {
								var escaped = "[[" + tc.input.title + "]]";
								if (protection.mode === "allow") {
									if (protection.filter.indexOf(escaped) === -1) {
										protection.filter = (protection.filter + " " + escaped).trim();
									}
								} else {
									var negated = "-" + escaped;
									if (protection.filter.indexOf(negated) === -1) {
										protection.filter = (protection.filter + " " + negated).trim();
									}
								}
							}
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

	// Inject context (may be string or multimodal content array)
	if (options.contextText) {
		if (options.injectAs === "system-prompt") {
			// System prompt is always text — extract text from array if needed
			var sysText = options.contextText;
			if (Array.isArray(sysText)) {
				var textParts = [];
				for (var s = 0; s < sysText.length; s++) {
					if (sysText[s].type === "text") textParts.push(sysText[s].text);
				}
				sysText = textParts.join("\n\n");
			}
			config.systemPrompt = (config.systemPrompt ? config.systemPrompt + "\n\n" : "") + sysText;
			// File attachments still go as user message
			if (Array.isArray(options.contextText)) {
				var fileParts = options.contextText.filter(function(p) { return p.type !== "text"; });
				if (fileParts.length > 0) {
					messages.push({ role: "user", content: fileParts });
				}
			}
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
			protectionFilter: options.protectionFilter || { filter: "", mode: "allow" },
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

	return exports.resolveFileRefs(messages, adapter).then(function(resolvedMessages) {
		var request = adapter.buildRequest(resolvedMessages, [], config);
		if (options.onRequest) {
			try { options.onRequest(request); } catch(e) { /* ignore */ }
		}
		return httpRequest(request);
	}).then(function(responseText) {
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

/*
Resolve file_ref blocks in messages to actual base64 content blocks.
Scans all messages, fetches referenced files in parallel, and replaces
file_ref markers with adapter-specific content blocks.
Returns a Promise that resolves with the modified messages array.
*/
exports.resolveFileRefs = function(messages, adapter) {
	var fileResolver = require("$:/plugins/rimir/llm-connect/file-resolver");
	var refs = [];

	// Collect all file_ref blocks with their location
	for (var i = 0; i < messages.length; i++) {
		var msg = messages[i];
		if (msg.role === "user" && Array.isArray(msg.content)) {
			for (var j = 0; j < msg.content.length; j++) {
				if (msg.content[j].type === "file_ref") {
					refs.push({
						msgIdx: i,
						blockIdx: j,
						ref: msg.content[j]
					});
				}
			}
		}
	}

	if (refs.length === 0) return Promise.resolve(messages);

	// Fetch all files in parallel
	var fetchPromises = refs.map(function(r) {
		return fileResolver.fetchAsBase64({
			uri: r.ref.uri,
			mediaType: r.ref.mediaType,
			category: r.ref.category || (r.ref.mediaType.indexOf("image/") === 0 ? "image" : "document"),
			filename: r.ref.filename,
			title: r.ref.title || ""
		});
	});

	return Promise.all(fetchPromises).then(function(results) {
		// Replace file_ref blocks with adapter-specific content blocks
		for (var k = 0; k < refs.length; k++) {
			var loc = refs[k];
			var fileData = results[k];
			messages[loc.msgIdx].content[loc.blockIdx] = adapter.buildFileBlock(fileData);
		}
		return messages;
	});
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
