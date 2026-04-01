/*\
title: $:/plugins/rimir/llm-connect/orchestrator
type: application/javascript
module-type: library

Tool-use loop orchestrator — manages LLM conversation with tool calls

\*/
(function() {

"use strict";

var MAX_ITERATIONS = 10;

var TIER_PRIORITY = { "cheap": 0, "default": 1, "expensive": 2 };

/*
Read model-tier routing config from individual config tiddlers.
Returns config object or null if disabled.
*/
function getTierConfig() {
	var enabled = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/tier-routing-enabled");
	if (enabled !== "yes") return null;
	return {
		tiers: {
			cheap: {
				provider: $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/tiers/cheap/provider") || "",
				model: $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/tiers/cheap/model") || ""
			},
			expensive: {
				provider: $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/tiers/expensive/provider") || "",
				model: $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/tiers/expensive/model") || ""
			}
		}
	};
}

/*
Determine the highest tier among a set of tool calls.
toolCalls: array of { name, ... } from the API response.
tools: array of tool definitions (with tier field) from getToolDefinitions.
Returns "cheap", "default", or "expensive".
*/
function getMaxTier(toolCalls, tools) {
	var toolTierMap = {};
	for (var i = 0; i < tools.length; i++) {
		toolTierMap[tools[i].name] = tools[i].tier || "default";
	}
	var maxPriority = -1;
	var maxTier = "default";
	for (var j = 0; j < toolCalls.length; j++) {
		var tier = toolTierMap[toolCalls[j].name] || "default";
		var priority = TIER_PRIORITY[tier] !== undefined ? TIER_PRIORITY[tier] : 1;
		if (priority > maxPriority) {
			maxPriority = priority;
			maxTier = tier;
		}
	}
	return maxTier;
}

/*
Build a config override for a given tier.
Returns a new config object with the tier's provider/model, or the original config if tier is "default".
*/
function applyTierConfig(baseConfig, tierConfig, tier) {
	if (tier === "default" || !tierConfig || !tierConfig.tiers) return baseConfig;
	var tierDef = tierConfig.tiers[tier];
	if (!tierDef || !tierDef.provider || !tierDef.model) return baseConfig;
	// Cross-provider switching within a conversation is unsafe (message formats differ).
	// Only switch model if provider matches, otherwise skip.
	if (tierDef.provider !== baseConfig.provider) return baseConfig;
	return $tw.utils.extend({}, baseConfig, { model: tierDef.model });
}

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
	var baseConfig = options.config;
	var adapter = options.adapter;
	var toolExecutor = options.toolExecutor;
	var onUpdate = options.onUpdate || function() {};
	var onError = options.onError || function() {};
	var protection = options.protectionFilter || { filter: "", mode: "allow" };
	var tierConfig = getTierConfig();

	// Build allowed tool names set for execution-time enforcement
	var allowedToolNames = null;
	if (tools.length > 0) {
		allowedToolNames = {};
		for (var t = 0; t < tools.length; t++) {
			allowedToolNames[tools[t].name] = true;
		}
	}

	// Ensure the chat tiddler is writable by tools (needed for attach_document's pending queue)
	if (protection.chatTiddler && protection.mode === "allow") {
		var chatEscaped = "[[" + protection.chatTiddler + "]]";
		if (protection.filter.indexOf(chatEscaped) === -1) {
			protection.filter = (protection.filter + " " + chatEscaped).trim();
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
					try { options.onRequest(request); } catch(e) { console.warn("llm-connect: hook error:", e); }
				}
				return httpRequest(request, options.signal);
			}).then(function(responseText) {
				if (options.onResponse) {
					try { options.onResponse(responseText); } catch(e) { console.warn("llm-connect: hook error:", e); }
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
							// Auto-add created/modified tiddlers to protection filter for subsequent calls
							if (tc.input && result.indexOf("Error:") !== 0) {
								var createdTitle = tc.input.title;
								if (!createdTitle && tc.input.basetitle) {
									// Extract actual title from basetitle result
									var match = result.match(/Done — created tiddler '(.+)'$/);
									if (match) createdTitle = match[1];
								}
								if (createdTitle) {
									// Note: [[title]] notation breaks if title contains "]]" — extremely rare in TiddlyWiki
									var escaped = "[[" + createdTitle + "]]";
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
						}
						messages.push(adapter.buildToolResult(tc.id, result));
					}

					onUpdate(messages);

					// Model tier routing: switch model for next iteration based on tool tiers
					if (tierConfig) {
						var maxTier = getMaxTier(parsed.toolCalls, tools);
						config = applyTierConfig(baseConfig, tierConfig, maxTier);
					}

					// Resolve pending attachments queued by attach_document tool
					resolvePendingAttachments(protection, adapter).then(function(attachParts) {
						if (attachParts && attachParts.length > 0) {
							messages.push({ role: "user", content: attachParts });
							onUpdate(messages);
						}
						doIteration();
					})["catch"](function() {
						doIteration();
					});
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
			try { options.onRequest(request); } catch(e) { console.warn("llm-connect: hook error:", e); }
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
	try { return JSON.parse(text); } catch(e) { console.warn("llm-connect: Failed to parse model cache for " + providerName + ":", e); return []; }
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
	var extractionEnabled = ($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/extraction-enabled") || "yes") !== "no";
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

	// Resolve each ref: try text extraction first (if enabled), fall back to base64
	var resolvePromises = refs.map(function(r) {
		var ref = r.ref;

		// If extraction is enabled and the type is extractable, prefer text
		if (extractionEnabled && fileResolver.isExtractable(ref.mediaType)) {
			// Check cache first
			var cached = fileResolver.getExtractedText(ref.title || "");
			if (cached) {
				return Promise.resolve({ mode: "extracted", text: cached, title: ref.title || ref.filename });
			}
			// Attempt live extraction via runner
			return fileResolver.extractDocument({
				title: ref.title || "",
				uri: ref.uri,
				mediaType: ref.mediaType,
				filename: ref.filename
			}).then(function(text) {
				return { mode: "extracted", text: text, title: ref.title || ref.filename };
			})["catch"](function() {
				// Extraction failed — fall back to base64
				return fileResolver.fetchAsBase64({
					uri: ref.uri,
					mediaType: ref.mediaType,
					category: ref.category || "document",
					filename: ref.filename,
					title: ref.title || ""
				}).then(function(fileData) {
					return { mode: "base64", data: fileData };
				});
			});
		}

		// Not extractable (images, unsupported types) — use base64 as before
		return fileResolver.fetchAsBase64({
			uri: ref.uri,
			mediaType: ref.mediaType,
			category: ref.category || (ref.mediaType.indexOf("image/") === 0 ? "image" : "document"),
			filename: ref.filename,
			title: ref.title || ""
		}).then(function(fileData) {
			return { mode: "base64", data: fileData };
		});
	});

	return Promise.all(resolvePromises).then(function(results) {
		for (var k = 0; k < refs.length; k++) {
			var loc = refs[k];
			var result = results[k];
			if (result.mode === "extracted") {
				// Replace file_ref with text block containing extracted markdown
				messages[loc.msgIdx].content[loc.blockIdx] = {
					type: "text",
					text: "--- Document: " + result.title + " (extracted text) ---\n" + result.text
				};
			} else {
				messages[loc.msgIdx].content[loc.blockIdx] = adapter.buildFileBlock(result.data);
			}
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

/*
Check for pending attachments queued by the attach_document tool.
Reads llm-pending-attachments from the chat tiddler, fetches each file,
and returns an array of content parts (text + file_ref) for injection.
*/
function resolvePendingAttachments(protection, adapter) {
	var chatTiddler = protection && protection.chatTiddler;
	if (!chatTiddler) return Promise.resolve(null);

	var chatTid = $tw.wiki.getTiddler(chatTiddler);
	if (!chatTid) return Promise.resolve(null);

	var pending = $tw.utils.parseStringArray(chatTid.fields["llm-pending-attachments"] || "");
	if (pending.length === 0) return Promise.resolve(null);

	// Clear pending list immediately
	$tw.wiki.addTiddler(new $tw.Tiddler(chatTid, { "llm-pending-attachments": "" }));

	var fileResolver = require("$:/plugins/rimir/llm-connect/file-resolver");
	var parts = [];

	for (var i = 0; i < pending.length; i++) {
		var title = pending[i];
		var fileInfo = fileResolver.detectFile(title);
		if (fileInfo) {
			// Binary file — push file_ref with uri for resolveFileRefs to fetch
			parts.push({
				type: "file_ref",
				title: fileInfo.title,
				uri: fileInfo.uri,
				mediaType: fileInfo.mediaType,
				category: fileInfo.category,
				filename: fileInfo.filename
			});
		} else {
			// Regular text tiddler — include its content directly
			var text = $tw.wiki.getTiddlerText(title);
			if (text) {
				parts.push({ type: "text", text: "--- Attached: " + title + " ---\n" + text });
			}
		}
	}

	return Promise.resolve(parts.length > 0 ? parts : null);
}

})();
