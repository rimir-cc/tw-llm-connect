/*\
title: $:/plugins/rimir/llm-connect/chat-widget
type: application/javascript
module-type: widget

<$llm-chat> widget — renders chat interface, handles input, triggers orchestrator

\*/
(function() {

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var LlmChatWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

LlmChatWidget.prototype = new Widget();

LlmChatWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();

	// Main container
	var container = this.document.createElement("div");
	container.className = "llm-chat-container";

	// Messages area
	var messagesDiv = this.document.createElement("div");
	messagesDiv.className = "llm-chat-messages";
	if (this.actionMode) {
		messagesDiv.style.display = "none";
		messagesDiv.style.minHeight = "0";
	}
	this.messagesDiv = messagesDiv;
	container.appendChild(messagesDiv);

	// Render existing messages
	this.renderMessages(messagesDiv);

	// Status indicator
	var statusDiv = this.document.createElement("div");
	statusDiv.className = "llm-chat-status";
	this.statusDiv = statusDiv;
	container.appendChild(statusDiv);

	// Input area
	var inputArea = this.document.createElement("div");
	inputArea.className = "llm-chat-input-area";

	var textarea = this.document.createElement("textarea");
	textarea.className = "llm-chat-textarea";
	textarea.placeholder = this.placeholderAttr || "Type your message... (Enter to send, Ctrl+Enter for newline)";
	textarea.rows = 3;
	this.textarea = textarea;

	var self = this;
	textarea.addEventListener("keydown", function(e) {
		if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
			e.preventDefault();
			self.sendMessage();
		}
	});
	textarea.addEventListener("input", function() {
		self.refreshDebugPanel();
	});
	inputArea.appendChild(textarea);

	// Protection filter row (hidden by default)
	var protectionRow = this.document.createElement("div");
	protectionRow.className = "llm-chat-protection-row";
	protectionRow.style.display = "none";
	this.protectionRow = protectionRow;

	var protectionInput = this.document.createElement("input");
	protectionInput.className = "llm-chat-protection-input";
	protectionInput.type = "text";
	protectionInput.placeholder = "e.g. [tag[sensitive]] [prefix[Private/]]";
	// Load existing per-chat filter
	if (this.chatTiddler) {
		var protTid = this.wiki.getTiddler(this.chatTiddler);
		if (protTid) protectionInput.value = protTid.fields["llm-protection-filter"] || "";
	}
	this.protectionInput = protectionInput;
	protectionInput.addEventListener("change", function() {
		if (self.chatTiddler) {
			var fields = { title: self.chatTiddler, "llm-protection-filter": protectionInput.value };
			var existing = self.wiki.getTiddler(self.chatTiddler);
			if (existing) fields = $tw.utils.extend({}, existing.fields, fields);
			self.wiki.addTiddler(new $tw.Tiddler(fields));
		}
		self.refreshDebugPanel();
	});
	protectionInput.addEventListener("input", function() {
		self.refreshDebugPanel();
	});
	var protectionLabel = this.document.createElement("span");
	protectionLabel.className = "llm-chat-protection-label";
	protectionLabel.textContent = "Protect:";
	var baseFilter = this.wiki.getTiddlerText("$:/config/rimir/llm-connect/protection-filter") || "";
	if (baseFilter) {
		var baseRow = this.document.createElement("div");
		baseRow.className = "llm-chat-protection-base-row";
		baseRow.appendChild(protectionLabel);
		var baseFilterSpan = this.document.createElement("code");
		baseFilterSpan.className = "llm-chat-protection-base";
		baseFilterSpan.textContent = baseFilter;
		baseFilterSpan.title = "Base protection filter (from settings — always active)";
		baseRow.appendChild(baseFilterSpan);
		protectionRow.appendChild(baseRow);
		var addRow = this.document.createElement("div");
		addRow.className = "llm-chat-protection-add-row";
		var plusLabel = this.document.createElement("span");
		plusLabel.className = "llm-chat-protection-label";
		plusLabel.textContent = "+";
		addRow.appendChild(plusLabel);
		protectionInput.placeholder = "additional filter (optional)";
		addRow.appendChild(protectionInput);
		protectionRow.appendChild(addRow);
	} else {
		protectionRow.appendChild(protectionLabel);
		protectionRow.appendChild(protectionInput);
	}
	inputArea.appendChild(protectionRow);

	// Context filter row (hidden by default)
	var contextRow = this.document.createElement("div");
	contextRow.className = "llm-chat-context-row";
	contextRow.style.display = "none";
	this.contextRow = contextRow;

	var contextInput = this.document.createElement("input");
	contextInput.className = "llm-chat-context-input";
	contextInput.type = "text";
	contextInput.placeholder = "e.g. [[report.pdf]] [tag[project]has[_canonical_uri]]";
	if (this.chatTiddler) {
		var ctxTid = this.wiki.getTiddler(this.chatTiddler);
		if (ctxTid) contextInput.value = ctxTid.fields["llm-context-filter"] || "";
	}
	this.contextInput = contextInput;
	contextInput.addEventListener("change", function() {
		if (self.chatTiddler) {
			var fields = { title: self.chatTiddler, "llm-context-filter": contextInput.value };
			var existing = self.wiki.getTiddler(self.chatTiddler);
			if (existing) fields = $tw.utils.extend({}, existing.fields, fields);
			self.wiki.addTiddler(new $tw.Tiddler(fields));
		}
		self.refreshDebugPanel();
	});
	contextInput.addEventListener("input", function() {
		self.refreshDebugPanel();
	});
	var contextLabel = this.document.createElement("span");
	contextLabel.className = "llm-chat-context-label";
	contextLabel.textContent = "Context:";
	contextRow.appendChild(contextLabel);
	contextRow.appendChild(contextInput);
	inputArea.appendChild(contextRow);

	var buttonRow = this.document.createElement("div");
	buttonRow.className = "llm-chat-button-row";

	var modelSelector = this.document.createElement("div");
	modelSelector.className = "llm-model-selector-wrapper";

	var modelBtn = this.document.createElement("button");
	modelBtn.className = "llm-model-selector-btn";
	this.modelBtn = modelBtn;
	this.updateModelDisplay();
	modelSelector.appendChild(modelBtn);

	var modelDropdown = this.document.createElement("div");
	modelDropdown.className = "llm-model-selector-dropdown";
	modelDropdown.style.display = "none";
	this.modelDropdown = modelDropdown;
	modelSelector.appendChild(modelDropdown);

	modelBtn.addEventListener("click", function(e) {
		e.stopPropagation();
		// Don't allow switching if chat has messages (model is locked)
		var msgs = self.getMessages();
		if (msgs.length > 0) {
			return;
		}
		if (modelDropdown.style.display === "none") {
			self.populateModelDropdown();
			modelDropdown.style.display = "block";
			// Close on outside click
			var closeHandler = function(ev) {
				if (!modelSelector.contains(ev.target)) {
					modelDropdown.style.display = "none";
					self.document.removeEventListener("mousedown", closeHandler, true);
				}
			};
			setTimeout(function() {
				self.document.addEventListener("mousedown", closeHandler, true);
			}, 0);
		} else {
			modelDropdown.style.display = "none";
		}
	});

	buttonRow.appendChild(modelSelector);

	// Token estimate display
	var tokenLabel = this.document.createElement("span");
	tokenLabel.className = "llm-chat-token-label";
	this.tokenLabel = tokenLabel;
	this.updateTokenDisplay();
	buttonRow.appendChild(tokenLabel);

	// Paperclip icon to toggle context filter
	var contextBtn = this.document.createElement("button");
	contextBtn.className = "llm-chat-btn-context";
	contextBtn.textContent = "\uD83D\uDCCE";
	contextBtn.title = "Toggle per-chat context filter (attach tiddlers/files)";
	contextBtn.addEventListener("click", function() {
		var visible = contextRow.style.display !== "none";
		contextRow.style.display = visible ? "none" : "flex";
	});
	buttonRow.appendChild(contextBtn);

	// Shield icon to toggle protection filter
	var shieldBtn = this.document.createElement("button");
	shieldBtn.className = "llm-chat-btn-shield";
	shieldBtn.textContent = "\uD83D\uDEE1\uFE0F";
	shieldBtn.title = "Toggle per-chat tiddler protection filter";
	shieldBtn.addEventListener("click", function() {
		var visible = protectionRow.style.display !== "none";
		protectionRow.style.display = visible ? "none" : "flex";
	});
	buttonRow.appendChild(shieldBtn);

	// Debug button + panel
	var debugBtn = this.document.createElement("button");
	debugBtn.className = "llm-chat-btn-debug";
	debugBtn.textContent = "\uD83D\uDC1B";
	debugBtn.title = "Toggle debug panel (preview / last sent request)";

	var debugPanel = this.document.createElement("div");
	debugPanel.className = "llm-chat-debug-panel";
	debugPanel.style.display = "flex";
	this.debugPanel = debugPanel;
	this.lastRequestBody = null;
	this.lastResponseBody = null;
	this.debugMode = "preview";
	this.debugTabs = [];

	var debugTabs = this.document.createElement("div");
	debugTabs.className = "llm-chat-debug-tabs";
	var previewTab = this.document.createElement("button");
	previewTab.className = "llm-chat-debug-tab llm-chat-debug-tab-active";
	previewTab.textContent = "Preview";
	var sentTab = this.document.createElement("button");
	sentTab.className = "llm-chat-debug-tab";
	sentTab.textContent = "Sent";
	var responseTab = this.document.createElement("button");
	responseTab.className = "llm-chat-debug-tab";
	responseTab.textContent = "Response";
	debugTabs.appendChild(previewTab);
	debugTabs.appendChild(sentTab);
	debugTabs.appendChild(responseTab);
	this.debugTabs = [previewTab, sentTab, responseTab];

	var debugContent = this.document.createElement("pre");
	debugContent.className = "llm-chat-debug-content";
	this.debugContent = debugContent;

	debugPanel.appendChild(debugTabs);
	debugPanel.appendChild(debugContent);

	previewTab.addEventListener("click", function() {
		self.setDebugTab("preview");
	});
	sentTab.addEventListener("click", function() {
		self.setDebugTab("sent");
	});
	responseTab.addEventListener("click", function() {
		self.setDebugTab("response");
	});

	debugBtn.addEventListener("click", function() {
		if (debugPanel.parentNode) {
			debugPanel.parentNode.removeChild(debugPanel);
			return;
		}
		self.refreshDebugPanel();
		debugPanel.style.display = "flex";
		container.parentNode.appendChild(debugPanel);
	});
	buttonRow.appendChild(debugBtn);

	var stopBtn = this.document.createElement("button");
	stopBtn.className = "llm-chat-btn llm-chat-btn-stop";
	stopBtn.textContent = "Stop";
	stopBtn.style.display = "none";
	this.stopBtn = stopBtn;
	stopBtn.addEventListener("click", function() {
		if (self.abortController) {
			self.abortController.abort();
		}
	});
	buttonRow.appendChild(stopBtn);

	var clearBtn = this.document.createElement("button");
	clearBtn.className = "llm-chat-btn llm-chat-btn-clear";
	clearBtn.textContent = "Clear";
	clearBtn.title = "Clear conversation and unlock model";
	clearBtn.addEventListener("click", function() {
		self.clearChat();
	});
	buttonRow.appendChild(clearBtn);

	var sendBtn = this.document.createElement("button");
	sendBtn.className = "llm-chat-btn llm-chat-btn-send";
	sendBtn.textContent = this.sendLabelAttr || "Send";
	sendBtn.addEventListener("click", function() {
		self.sendMessage();
	});
	buttonRow.appendChild(sendBtn);

	inputArea.appendChild(buttonRow);
	container.appendChild(inputArea);

	parent.insertBefore(container, nextSibling);
	this.domNodes.push(container);
};

LlmChatWidget.prototype.execute = function() {
	this.chatTiddler = this.getAttribute("chatTiddler", "");
	this.systemPromptAttr = this.getAttribute("systemPrompt", "");
	this.toolsFilter = this.getAttribute("tools", "");
	this.toolGroupAttr = this.getAttribute("toolGroup", "");
	this.contextTemplateAttr = this.getAttribute("contextTemplate", "");
	this.sourceTiddler = this.getAttribute("tiddler", "");
	this.placeholderAttr = this.getAttribute("placeholder", "");
	this.sendLabelAttr = this.getAttribute("sendLabel", "");
	this.actionMode = this.getAttribute("actionMode", "") === "yes";

	// Use chat tiddler's locked provider/model if conversation has started, otherwise global config
	var chatTid = this.chatTiddler ? this.wiki.getTiddler(this.chatTiddler) : null;
	var hasMessages = chatTid && chatTid.fields["llm-messages"] && chatTid.fields["llm-messages"] !== "[]";
	if (hasMessages && chatTid.fields["llm-provider"] && chatTid.fields["llm-model"]) {
		this.provider = chatTid.fields["llm-provider"];
		this.model = chatTid.fields["llm-model"];
	} else {
		var config = this.getOrchestratorModule().getProviderConfig();
		this.provider = config.provider;
		this.model = config.model;
	}
	this.contextInjected = false;
	this.attachmentsInjected = false;
};

LlmChatWidget.prototype.getMessages = function() {
	if (!this.chatTiddler) return [];
	var tiddler = this.wiki.getTiddler(this.chatTiddler);
	if (!tiddler || !tiddler.fields["llm-messages"]) return [];
	try {
		return JSON.parse(tiddler.fields["llm-messages"]);
	} catch(e) {
		return [];
	}
};

LlmChatWidget.prototype.saveMessages = function(messages) {
	if (!this.chatTiddler) return;
	this.wiki.addTiddler(new $tw.Tiddler(
		this.wiki.getTiddler(this.chatTiddler) || {},
		{
			title: this.chatTiddler,
			"llm-messages": JSON.stringify(messages),
			"llm-provider": this.provider,
			"llm-model": this.model,
			tags: "$:/tags/rimir/llm-connect/chat"
		}
	));
};

LlmChatWidget.prototype.renderMessages = function(container) {
	container.innerHTML = "";
	var messages = this.getMessages();

	for (var i = 0; i < messages.length; i++) {
		var msg = messages[i];
		var rendered = this.renderOneMessage(msg);
		if (rendered) {
			for (var r = 0; r < rendered.length; r++) {
				container.appendChild(rendered[r]);
			}
		}
	}

	container.scrollTop = container.scrollHeight;
};

LlmChatWidget.prototype.renderOneMessage = function(msg) {
	var elements = [];
	var doc = this.document;

	// User message with tool_result content (Claude format)
	if (msg.role === "user" && Array.isArray(msg.content)) {
		for (var i = 0; i < msg.content.length; i++) {
			var block = msg.content[i];
			if (block.type === "tool_result") {
				var toolDiv = doc.createElement("div");
				toolDiv.className = "llm-chat-message llm-chat-message-tool";
				var preview = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
				if (preview.length > 300) preview = preview.substring(0, 300) + "...";
				toolDiv.textContent = preview;
				elements.push(toolDiv);
			} else if (typeof block === "string") {
				var userDiv = doc.createElement("div");
				userDiv.className = "llm-chat-message llm-chat-message-user";
				userDiv.textContent = block;
				elements.push(userDiv);
			}
		}
		return elements;
	}

	// Plain user message
	if (msg.role === "user") {
		var userDiv = doc.createElement("div");
		if (msg._context) {
			userDiv.className = "llm-chat-message llm-chat-message-context";
			// Build summary for context messages (may contain file_ref blocks)
			var contextSummary = "\u{1F4CB} Context injected";
			var contextDetail = "";
			if (Array.isArray(msg.content)) {
				var fileCount = 0;
				var textCount = 0;
				for (var ci = 0; ci < msg.content.length; ci++) {
					var cb = msg.content[ci];
					if (cb.type === "file_ref" || cb.type === "image" || cb.type === "document" || cb.type === "image_url" || cb.type === "file") {
						fileCount++;
					} else if (cb.type === "text") {
						textCount++;
						contextDetail += cb.text + "\n";
					}
				}
				var parts = [];
				if (textCount > 0) parts.push(textCount + " text");
				if (fileCount > 0) parts.push(fileCount + " file" + (fileCount > 1 ? "s" : ""));
				contextSummary += " (" + parts.join(", ") + ")";
				// Add file badges
				for (var fi = 0; fi < msg.content.length; fi++) {
					var fb = msg.content[fi];
					if (fb.type === "file_ref") {
						var cat = fb.mediaType && fb.mediaType.indexOf("image/") === 0 ? "IMG" : "PDF";
						contextSummary += " [" + cat + " " + fb.filename + "]";
					}
				}
			} else {
				contextDetail = typeof msg.content === "string" ? msg.content : "";
			}
			contextSummary += " (click to expand)";
			userDiv.textContent = contextSummary;
			userDiv.title = contextDetail.substring(0, 500);
			userDiv.addEventListener("click", function() {
				if (userDiv.classList.contains("llm-chat-context-expanded")) {
					userDiv.classList.remove("llm-chat-context-expanded");
					userDiv.textContent = contextSummary;
				} else {
					userDiv.classList.add("llm-chat-context-expanded");
					userDiv.textContent = contextDetail || contextSummary;
				}
			});
		} else {
			userDiv.className = "llm-chat-message llm-chat-message-user";
			userDiv.textContent = typeof msg.content === "string" ? msg.content : "";
		}
		elements.push(userDiv);
		return elements;
	}

	// Assistant message — may contain text + tool_use blocks
	if (msg.role === "assistant") {
		if (Array.isArray(msg.content)) {
			var textParts = [];
			for (var j = 0; j < msg.content.length; j++) {
				var aBlock = msg.content[j];
				if (aBlock.type === "text" && aBlock.text) {
					textParts.push(aBlock.text);
				} else if (aBlock.type === "tool_use") {
					// Render any text before this tool call
					if (textParts.length > 0) {
						var textDiv = doc.createElement("div");
						textDiv.className = "llm-chat-message llm-chat-message-assistant";
						textDiv.textContent = textParts.join("\n");
						elements.push(textDiv);
						textParts = [];
					}
					var toolCallDiv = doc.createElement("div");
					toolCallDiv.className = "llm-chat-message llm-chat-message-tool";
					var inputPreview = JSON.stringify(aBlock.input);
					if (inputPreview.length > 100) inputPreview = inputPreview.substring(0, 100) + "...";
					toolCallDiv.textContent = "\u{1F527} " + aBlock.name + "(" + inputPreview + ")";
					elements.push(toolCallDiv);
				}
			}
			if (textParts.length > 0) {
				var remainingDiv = doc.createElement("div");
				remainingDiv.className = "llm-chat-message llm-chat-message-assistant";
				remainingDiv.textContent = textParts.join("\n");
				elements.push(remainingDiv);
			}
		} else if (typeof msg.content === "string" && msg.content) {
			var assistDiv = doc.createElement("div");
			assistDiv.className = "llm-chat-message llm-chat-message-assistant";
			assistDiv.textContent = msg.content;
			elements.push(assistDiv);
		}
		return elements;
	}

	// OpenAI tool result
	if (msg.role === "tool") {
		var toolResDiv = doc.createElement("div");
		toolResDiv.className = "llm-chat-message llm-chat-message-tool";
		var content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
		if (content.length > 300) content = content.substring(0, 300) + "...";
		toolResDiv.textContent = content;
		elements.push(toolResDiv);
		return elements;
	}

	return elements;
};

LlmChatWidget.prototype.sendMessage = function() {
	var text = this.textarea.value.trim();
	if (!text && !this.actionMode) return;
	if (!text) text = "Go.";
	this.textarea.value = "";

	var messages = this.getMessages();
	var self = this;

	// Context template injection — first message only
	if (!this.contextInjected && messages.length === 0) {
		var contextResolver = this.getContextResolverModule();
		var templateTitle = contextResolver.resolveTemplate({
			sourceTiddler: this.sourceTiddler,
			contextTemplate: this.contextTemplateAttr
		});
		var rendered = contextResolver.renderContext({
			templateTitle: templateTitle,
			sourceTiddler: this.sourceTiddler
		});

		// Resolve context attachments (llm-context field + per-chat filter)
		var chatCtxFilter = "";
		if (this.chatTiddler) {
			var ctxTid = this.wiki.getTiddler(this.chatTiddler);
			if (ctxTid) chatCtxFilter = ctxTid.fields["llm-context-filter"] || "";
		}
		var attachments = contextResolver.resolveContextAttachments({
			sourceTiddler: this.sourceTiddler,
			chatFilter: chatCtxFilter,
			templateTitle: templateTitle
		});

		// Abort if context filter is broken
		if (attachments.error) {
			this.textarea.value = text;
			this.setStatus("Context filter error: " + attachments.error);
			return;
		}

		var hasFiles = attachments.fileParts.length > 0;
		var hasTextAttachments = attachments.textTitles.length > 0;

		if (rendered.text || hasFiles || hasTextAttachments) {
			if (rendered.injectAs === "system-prompt") {
				this.systemPromptOverride = (this.systemPromptAttr ? this.systemPromptAttr + "\n\n" : "") + rendered.text;
				// Attachments still go as user message even if template injects as system-prompt
				if (hasFiles || hasTextAttachments) {
					var sysContentParts = [];
					for (var ti = 0; ti < attachments.textTitles.length; ti++) {
						sysContentParts.push({ type: "text", text: attachments.renderText(attachments.textTitles[ti]) });
					}
					for (var fi = 0; fi < attachments.fileParts.length; fi++) {
						var fp = attachments.fileParts[fi];
						sysContentParts.push({ type: "file_ref", uri: fp.uri, mediaType: fp.mediaType, category: fp.category, filename: fp.filename, title: fp.title });
					}
					if (sysContentParts.length > 0) {
						messages.push({ role: "user", content: sysContentParts, _context: true });
					}
				}
			} else {
				// Build multimodal content array
				var contentParts = [];
				if (rendered.text) {
					contentParts.push({ type: "text", text: rendered.text });
				}
				for (var ti2 = 0; ti2 < attachments.textTitles.length; ti2++) {
					contentParts.push({ type: "text", text: attachments.renderText(attachments.textTitles[ti2]) });
				}
				for (var fi2 = 0; fi2 < attachments.fileParts.length; fi2++) {
					var fp2 = attachments.fileParts[fi2];
					contentParts.push({ type: "file_ref", uri: fp2.uri, mediaType: fp2.mediaType, category: fp2.category, filename: fp2.filename, title: fp2.title });
				}
				if (contentParts.length === 1 && contentParts[0].type === "text") {
					// Simple text-only context — keep as plain string for backward compatibility
					messages.push({ role: "user", content: contentParts[0].text, _context: true });
				} else if (contentParts.length > 0) {
					messages.push({ role: "user", content: contentParts, _context: true });
				}
			}
			if (hasFiles || hasTextAttachments) {
				this.attachmentsInjected = true;
			}
		}
		this.contextInjected = true;
	}

	// Late attachment injection — if context filter was set/changed after first message
	if (this.contextInjected && !this.attachmentsInjected) {
		var lateCtxFilter = "";
		if (this.chatTiddler) {
			var lateCtxTid = this.wiki.getTiddler(this.chatTiddler);
			if (lateCtxTid) lateCtxFilter = lateCtxTid.fields["llm-context-filter"] || "";
		}
		if (lateCtxFilter) {
			var lateContextResolver = this.getContextResolverModule();
			var lateAttachments = lateContextResolver.resolveContextAttachments({
				sourceTiddler: this.sourceTiddler,
				chatFilter: lateCtxFilter,
				templateTitle: null
			});
			if (lateAttachments.error) {
				this.textarea.value = text;
				this.setStatus("Context filter error: " + lateAttachments.error);
				return;
			}
			if (lateAttachments.fileParts.length > 0 || lateAttachments.textTitles.length > 0) {
				var lateParts = [];
				for (var lti = 0; lti < lateAttachments.textTitles.length; lti++) {
					lateParts.push({ type: "text", text: lateAttachments.renderText(lateAttachments.textTitles[lti]) });
				}
				for (var lfi = 0; lfi < lateAttachments.fileParts.length; lfi++) {
					var lfp = lateAttachments.fileParts[lfi];
					lateParts.push({ type: "file_ref", uri: lfp.uri, mediaType: lfp.mediaType, category: lfp.category, filename: lfp.filename, title: lfp.title });
				}
				if (lateParts.length > 0) {
					messages.push({ role: "user", content: lateParts, _context: true });
				}
				this.attachmentsInjected = true;
			}
		}
	}

	messages.push({ role: "user", content: text });
	this.saveMessages(messages);
	this.renderMessages(this.messagesDiv);
	this.updateModelDisplay();
	this.updateTokenDisplay();

	this.setStatus("Thinking...");
	this.stopBtn.style.display = "inline-block";
	if (this.actionMode && this.messagesDiv.style.display === "none") {
		this.messagesDiv.style.display = "";
	}
	this.abortController = new AbortController();

	var orchestrator = this.getOrchestratorModule();
	var helpers = this.getWidgetHelpersModule();
	var config = helpers.resolveProviderConfig(this.provider, this.model, null);

	if (this.systemPromptOverride) {
		config.systemPrompt = this.systemPromptOverride;
	} else if (this.systemPromptAttr) {
		config.systemPrompt = this.systemPromptAttr;
	}

	var adapter = orchestrator.getAdapter(this.provider);
	var tools = this.toolsFilter ? helpers.resolveTools(this.toolsFilter, this.toolGroupAttr, this.chatTiddler) : [];

	// Compute protection filter (base + per-chat)
	var chatProtection = "";
	if (this.chatTiddler) {
		var protChatTid = this.wiki.getTiddler(this.chatTiddler);
		if (protChatTid) chatProtection = protChatTid.fields["llm-protection-filter"] || "";
	}
	var protectionFilter = helpers.resolveProtectionFilter(chatProtection);

	orchestrator.runConversation({
		messages: messages,
		tools: tools,
		config: config,
		adapter: adapter,
		toolExecutor: this.getToolExecutorModule(),
		protectionFilter: protectionFilter,
		signal: this.abortController.signal,
		onRequest: function(request) {
			self.lastRequestBody = request.body;
		},
		onResponse: function(responseText) {
			self.lastResponseBody = responseText;
		},
		onUpdate: function(msgs) {
			self.saveMessages(msgs);
			self.renderMessages(self.messagesDiv);
			self.updateTokenDisplay();
		},
		onError: function(err) {
			self.setStatus("Error: " + err.message);
		}
	}).then(function() {
		self.setStatus("");
		self.stopBtn.style.display = "none";
	})["catch"](function(err) {
		self.setStatus("Error: " + err.message);
		self.stopBtn.style.display = "none";
	});
};

LlmChatWidget.prototype.setStatus = function(text) {
	if (this.statusDiv) {
		this.statusDiv.textContent = text;
		this.statusDiv.style.display = text ? "block" : "none";
	}
};

LlmChatWidget.prototype.clearChat = function() {
	if (!this.chatTiddler) return;
	// Clear messages and unlock provider/model
	this.saveMessages([]);
	this.contextInjected = false;
	this.attachmentsInjected = false;
	this.systemPromptOverride = null;
	this.lastRequestBody = null;
	this.lastResponseBody = null;
	// Reset to global config
	var config = this.getOrchestratorModule().getProviderConfig();
	this.provider = config.provider;
	this.model = config.model;
	this.renderMessages(this.messagesDiv);
	this.updateModelDisplay();
	this.updateTokenDisplay();
	this.setStatus("");
};

LlmChatWidget.prototype.isDebugVisible = function() {
	return this.debugPanel && this.debugPanel.parentNode;
};

LlmChatWidget.prototype.setDebugTab = function(mode) {
	this.debugMode = mode;
	for (var i = 0; i < this.debugTabs.length; i++) {
		this.debugTabs[i].className = "llm-chat-debug-tab";
	}
	var idx = mode === "preview" ? 0 : mode === "sent" ? 1 : 2;
	this.debugTabs[idx].className = "llm-chat-debug-tab llm-chat-debug-tab-active";
	this.refreshDebugPanel();
};

LlmChatWidget.prototype.refreshDebugPanel = function() {
	if (!this.debugContent) return;
	if (!this.isDebugVisible()) return;
	if (this.debugMode === "sent") {
		if (!this.lastRequestBody) {
			this.debugContent.textContent = "(no request sent yet)";
		} else {
			this.debugContent.textContent = abbreviateBase64(this.lastRequestBody);
		}
	} else if (this.debugMode === "response") {
		if (!this.lastResponseBody) {
			this.debugContent.textContent = "(no response received yet)";
		} else {
			this.debugContent.textContent = abbreviateBase64(this.lastResponseBody);
		}
	} else {
		this.debugContent.textContent = abbreviateBase64(this.buildPreview());
	}
};

LlmChatWidget.prototype.buildPreview = function() {
	var orchestrator = this.getOrchestratorModule();
	var contextResolver = this.getContextResolverModule();

	var preview = {};

	// Provider + model
	preview.provider = this.provider;
	preview.model = this.model;

	// System prompt
	var config = orchestrator.getProviderConfig(this.provider);
	if (this.systemPromptOverride) {
		preview.systemPrompt = this.systemPromptOverride;
	} else if (this.systemPromptAttr) {
		preview.systemPrompt = this.systemPromptAttr;
	} else {
		preview.systemPrompt = config.systemPrompt;
	}

	// Current messages
	var messages = this.getMessages();
	preview.messages = messages;

	// Pending text in textarea
	if (this.textarea && this.textarea.value.trim()) {
		preview.pendingInput = this.textarea.value.trim();
	}

	// Context (what would be injected on first message)
	if (!this.contextInjected && messages.length === 0) {
		var templateTitle = contextResolver.resolveTemplate({
			sourceTiddler: this.sourceTiddler,
			contextTemplate: this.contextTemplateAttr
		});
		var rendered = contextResolver.renderContext({
			templateTitle: templateTitle,
			sourceTiddler: this.sourceTiddler
		});

		var chatCtxFilter = "";
		if (this.chatTiddler) {
			var ctxTid = this.wiki.getTiddler(this.chatTiddler);
			if (ctxTid) chatCtxFilter = ctxTid.fields["llm-context-filter"] || "";
		}
		var attachments = contextResolver.resolveContextAttachments({
			sourceTiddler: this.sourceTiddler,
			chatFilter: chatCtxFilter,
			templateTitle: templateTitle
		});

		preview.contextWillInject = {
			templateTitle: templateTitle || "(built-in default)",
			injectAs: rendered.injectAs,
			renderedText: rendered.text ? (rendered.text.length > 500 ? rendered.text.substring(0, 500) + "..." : rendered.text) : null,
			textAttachments: attachments.textTitles,
			fileAttachments: attachments.fileParts.map(function(f) {
				return { title: f.title, filename: f.filename, mediaType: f.mediaType, category: f.category, uri: f.uri };
			})
		};
	} else if (this.contextInjected) {
		preview.contextWillInject = "(already injected)";
	}

	// Tools
	var helpers = this.getWidgetHelpersModule();
	if (this.toolsFilter) {
		var tools = helpers.resolveTools(this.toolsFilter, this.toolGroupAttr, this.chatTiddler);
		preview.tools = tools.map(function(t) { return t.name; });
	}

	// Protection filter
	var chatProtection = "";
	if (this.chatTiddler) {
		var protTid = this.wiki.getTiddler(this.chatTiddler);
		if (protTid) chatProtection = protTid.fields["llm-protection-filter"] || "";
	}
	var protectionFilter = helpers.resolveProtectionFilter(chatProtection);
	if (protectionFilter) {
		preview.protectionFilter = protectionFilter;
	}

	return JSON.stringify(preview, null, 2);
};

LlmChatWidget.prototype.getOrchestratorModule = function() {
	return require("$:/plugins/rimir/llm-connect/orchestrator");
};

LlmChatWidget.prototype.getToolExecutorModule = function() {
	return require("$:/plugins/rimir/llm-connect/tool-executor");
};

LlmChatWidget.prototype.getContextResolverModule = function() {
	return require("$:/plugins/rimir/llm-connect/context-resolver");
};

LlmChatWidget.prototype.getWidgetHelpersModule = function() {
	return require("$:/plugins/rimir/llm-connect/widget-helpers");
};

LlmChatWidget.prototype.populateModelDropdown = function() {
	var dropdown = this.modelDropdown;
	var self = this;
	dropdown.innerHTML = "";

	var orchestrator = this.getOrchestratorModule();
	var providers = orchestrator.getConfiguredProviders();

	if (providers.length === 0) {
		dropdown.textContent = "No providers configured";
		return;
	}

	var hasModels = false;
	for (var p = 0; p < providers.length; p++) {
		var provName = providers[p];
		var models = orchestrator.getCachedModels(provName);

		if (models.length === 0) continue;
		hasModels = true;

		var header = this.document.createElement("div");
		header.className = "llm-model-selector-provider-header";
		header.textContent = provName;
		dropdown.appendChild(header);

		for (var m = 0; m < models.length; m++) {
			var item = this.document.createElement("div");
			item.className = "llm-model-selector-item";
			if (models[m].id === self.model && provName === self.provider) {
				item.classList.add("llm-model-selector-item-active");
			}
			item.textContent = models[m].label;
			item.setAttribute("data-provider", provName);
			item.setAttribute("data-model", models[m].id);
			item.addEventListener("click", function() {
				var prov = this.getAttribute("data-provider");
				var mod = this.getAttribute("data-model");
				self.wiki.setText("$:/config/rimir/llm-connect/provider", "text", null, prov);
				self.wiki.setText("$:/config/rimir/llm-connect/providers/" + prov + "/model", "text", null, mod);
				self.provider = prov;
				self.model = mod;
				self.updateModelDisplay();
				self.modelDropdown.style.display = "none";
			});
			dropdown.appendChild(item);
		}
	}

	if (!hasModels) {
		var fetchBtn = this.document.createElement("div");
		fetchBtn.className = "llm-model-selector-empty llm-model-selector-fetch";
		fetchBtn.textContent = "No models cached — click to fetch";
		fetchBtn.style.cursor = "pointer";
		fetchBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			fetchBtn.textContent = "Fetching models…";
			fetchBtn.style.cursor = "default";
			var promises = [];
			for (var i = 0; i < providers.length; i++) {
				promises.push(orchestrator.fetchModels(providers[i]));
			}
			Promise.all(promises).then(function() {
				self.populateModelDropdown();
			}).catch(function() {
				self.populateModelDropdown();
			});
		});
		dropdown.appendChild(fetchBtn);
	}
};

LlmChatWidget.prototype.updateModelDisplay = function() {
	if (!this.modelBtn) return;
	var msgs = this.getMessages();
	var locked = msgs.length > 0;
	this.modelBtn.textContent = this.provider + " / " + this.model + (locked ? " \uD83D\uDD12" : "");
	this.modelBtn.title = locked ? "Model locked for this conversation \u2014 clear chat to switch" : "Click to select model";
	this.modelBtn.style.cursor = locked ? "default" : "pointer";
	if (locked) {
		this.modelBtn.classList.add("llm-model-selector-btn-locked");
	} else {
		this.modelBtn.classList.remove("llm-model-selector-btn-locked");
	}
};

LlmChatWidget.prototype.updateTokenDisplay = function() {
	if (!this.tokenLabel) return;
	var messages = this.getMessages();
	if (messages.length === 0) {
		this.tokenLabel.textContent = "";
		this.tokenLabel.title = "";
		return;
	}
	var inChars = 0, outChars = 0;
	for (var i = 0; i < messages.length; i++) {
		var msg = messages[i];
		var len = extractTextLength(msg.content);
		if (msg.role === "assistant") {
			inChars += len;
		} else {
			outChars += len;
		}
	}
	var inTokens = Math.round(inChars / 4);
	var outTokens = Math.round(outChars / 4);
	var totalTokens = inTokens + outTokens;
	var fmt = function(t) { return t >= 1000 ? (t / 1000).toFixed(1) + "k" : String(t); };
	this.tokenLabel.textContent = "~" + fmt(totalTokens) + " tok (" + fmt(inTokens) + " in / " + fmt(outTokens) + " out)";
	this.tokenLabel.title = "Estimate (~4 chars/token)\nIn (assistant): " + inChars + " chars / ~" + inTokens + " tokens\nOut (user+context+tools): " + outChars + " chars / ~" + outTokens + " tokens";
};

LlmChatWidget.prototype.refresh = function(changedTiddlers) {
	if (changedTiddlers[this.chatTiddler]) {
		this.renderMessages(this.messagesDiv);
		this.updateTokenDisplay();
		this.refreshDebugPanel();
	}
	// Update provider/model display if config changed — but only if chat is empty (not locked)
	var msgs = this.getMessages();
	if (msgs.length === 0 &&
		(changedTiddlers["$:/config/rimir/llm-connect/provider"] ||
		changedTiddlers["$:/config/rimir/llm-connect/providers/" + this.provider + "/model"])) {
		var config = this.getOrchestratorModule().getProviderConfig();
		this.provider = config.provider;
		this.model = config.model;
		this.updateModelDisplay();
	}
	return false;
};

function extractTextLength(content) {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	var len = 0;
	for (var i = 0; i < content.length; i++) {
		var block = content[i];
		if (block.type === "text" && block.text) {
			len += block.text.length;
		} else if (block.type === "tool_use" && block.input) {
			len += JSON.stringify(block.input).length;
		} else if (block.type === "tool_result" && block.content) {
			len += typeof block.content === "string" ? block.content.length : JSON.stringify(block.content).length;
		} else if (typeof block.content === "string") {
			len += block.content.length;
		}
		// Skip base64 data (image/document/file_ref blocks) — not text
	}
	return len;
}

function abbreviateBase64(jsonBody) {
	try {
		var obj = JSON.parse(jsonBody);
		return JSON.stringify(obj, function(key, value) {
			if (typeof value === "string" && value.length > 200) {
				// Check for data URIs (OpenAI format)
				if (value.indexOf("data:") === 0 && value.indexOf(";base64,") !== -1) {
					var prefix = value.substring(0, value.indexOf(";base64,") + 8);
					return prefix + "... [" + Math.round(value.length / 1024) + "KB data URI truncated]";
				}
				// Check if it looks like base64 data (Claude format — raw base64 in "data" field)
				if (/^[A-Za-z0-9+/=\s]+$/.test(value.substring(0, 100))) {
					return value.substring(0, 80) + "... [" + Math.round(value.length / 1024) + "KB base64 truncated]";
				}
			}
			return value;
		}, 2);
	} catch(e) {
		return jsonBody;
	}
}

exports["llm-chat"] = LlmChatWidget;

})();
