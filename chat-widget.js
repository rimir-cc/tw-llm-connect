/*\
title: $:/plugins/rimir/llm-connect/chat-widget
type: application/javascript
module-type: widget

<$llm-chat> widget — renders chat interface, handles input, triggers orchestrator

\*/
(function() {

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var CHAT_STATE_FIELDS = ["llm-provider", "llm-model", "llm-active-tools", "llm-tools-init",
	"llm-context-filter", "llm-protection-mode", "llm-allow-filter", "llm-deny-filter"];

/*
Render markdown text to HTML using TW's markdown plugin (text/x-markdown parser).
Falls back to plain text with escaped HTML if the parser is unavailable.
*/
function markdownToHtml(text) {
	if (!text) return "";
	try {
		return $tw.wiki.renderText("text/html", "text/x-markdown", text);
	} catch(e) {
		return "<p>" + text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>") + "</p>";
	}
}

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

	var self = this;
	this.pinIconDefault = "\uD83D\uDCCC"; // 📌
	this.pinIconActive = "\uD83D\uDD34"; // 🔴

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

	// Mode toggle (deny/allow)
	var baseMode = (this.wiki.getTiddlerText("$:/config/rimir/llm-connect/protection-mode") || "allow").trim();
	var chatMode = "";
	if (this.chatTiddler) {
		var protModeTid = this.wiki.getTiddler(this.chatTiddler);
		if (protModeTid) chatMode = protModeTid.fields["llm-protection-mode"] || "";
	}
	var activeMode = this.protectionModeAttr || chatMode || baseMode;

	var modeRow = this.document.createElement("div");
	modeRow.className = "llm-chat-protection-mode-row";
	var modeLabel = this.document.createElement("span");
	modeLabel.className = "llm-chat-protection-label";
	modeLabel.textContent = "Mode:";
	modeRow.appendChild(modeLabel);

	var modeSelect = this.document.createElement("select");
	modeSelect.className = "llm-chat-protection-mode-select";
	var denyOption = this.document.createElement("option");
	denyOption.value = "deny";
	denyOption.textContent = "Deny (blacklist)";
	var allowOption = this.document.createElement("option");
	allowOption.value = "allow";
	allowOption.textContent = "Allow (whitelist)";
	modeSelect.appendChild(denyOption);
	modeSelect.appendChild(allowOption);
	modeSelect.value = activeMode;
	this.protectionModeSelect = modeSelect;

	modeSelect.addEventListener("change", function() {
		// Negate the current filter and carry it over to the new mode
		var currentFilter = self.protectionInput.value.trim();
		var negated = negateFilter(currentFilter);
		// Save negated filter to the NEW mode's field
		var newMode = modeSelect.value;
		var newField = newMode === "allow" ? "llm-allow-filter" : "llm-deny-filter";
		if (self.chatTiddler) {
			var fields = { title: self.chatTiddler, "llm-protection-mode": newMode };
			fields[newField] = negated;
			var existing = self.wiki.getTiddler(self.chatTiddler);
			if (existing) fields = $tw.utils.extend({}, existing.fields, fields);
			self.wiki.addTiddler(new $tw.Tiddler(fields));
		}
		self.protectionInput.value = negated;
		self.updateProtectionLabels();
		self.refreshDebugPanel();
		self.refreshAccessPanel();
		self.syncIfPinned();
	});
	modeRow.appendChild(modeSelect);

	var modeHint = this.document.createElement("span");
	modeHint.className = "llm-chat-protection-mode-hint rr-muted";
	this.protectionModeHint = modeHint;
	modeRow.appendChild(modeHint);
	protectionRow.appendChild(modeRow);

	// Base filter row (shows the settings-level filter for the active mode)
	var baseRow = this.document.createElement("div");
	baseRow.className = "llm-chat-protection-base-row";
	var protectionLabel = this.document.createElement("span");
	protectionLabel.className = "llm-chat-protection-label";
	this.protectionFilterLabel = protectionLabel;
	baseRow.appendChild(protectionLabel);
	var baseFilterSpan = this.document.createElement("code");
	baseFilterSpan.className = "llm-chat-protection-base";
	baseFilterSpan.title = "Base filter (from settings — always active)";
	this.protectionBaseFilterSpan = baseFilterSpan;
	baseRow.appendChild(baseFilterSpan);
	this.protectionBaseRow = baseRow;
	protectionRow.appendChild(baseRow);

	// Per-chat additional filter input (switches between deny/allow field based on mode)
	var addRow = this.document.createElement("div");
	addRow.className = "llm-chat-protection-add-row";
	var plusLabel = this.document.createElement("span");
	plusLabel.className = "llm-chat-protection-label";
	plusLabel.textContent = "+";
	addRow.appendChild(plusLabel);
	var protectionInput = this.document.createElement("input");
	protectionInput.className = "llm-chat-protection-input";
	protectionInput.type = "text";
	protectionInput.placeholder = "additional filter (optional)";
	this.protectionInput = protectionInput;
	this.loadProtectionInput();
	protectionInput.addEventListener("change", function() {
		self.saveProtectionInput();
		self.refreshDebugPanel();
		self.refreshAccessPanel();
	});
	protectionInput.addEventListener("input", function() {
		self.refreshDebugPanel();
	});
	addRow.appendChild(protectionInput);
	protectionRow.appendChild(addRow);

	this.updateProtectionLabels();
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
		self.syncIfPinned();
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

	// Eye icon to toggle accessible tiddlers panel
	var accessPanel = this.document.createElement("div");
	accessPanel.className = "llm-chat-access-panel";
	accessPanel.style.display = "none";
	this.accessPanel = accessPanel;

	var accessHeader = this.document.createElement("div");
	accessHeader.className = "llm-chat-access-header";
	var accessTitle = this.document.createElement("span");
	accessTitle.className = "llm-chat-access-title";
	this.accessTitle = accessTitle;
	accessHeader.appendChild(accessTitle);
	accessPanel.appendChild(accessHeader);

	var accessList = this.document.createElement("div");
	accessList.className = "llm-chat-access-list";
	this.accessList = accessList;
	accessPanel.appendChild(accessList);

	// Drop zone for adding/removing tiddlers
	accessPanel.addEventListener("dragover", function(e) {
		e.preventDefault();
		accessPanel.classList.add("llm-chat-access-dragover");
	});
	accessPanel.addEventListener("dragleave", function(e) {
		if (!accessPanel.contains(e.relatedTarget)) {
			accessPanel.classList.remove("llm-chat-access-dragover");
		}
	});
	accessPanel.addEventListener("drop", function(e) {
		e.preventDefault();
		accessPanel.classList.remove("llm-chat-access-dragover");
		var jsonData = e.dataTransfer.getData("text/vnd.tiddler") || e.dataTransfer.getData("text/plain");
		if (!jsonData) return;
		var title;
		try {
			var parsed = JSON.parse(jsonData);
			title = Array.isArray(parsed) ? parsed[0].title : parsed.title;
		} catch(ex) {
			title = jsonData.trim();
		}
		if (!title) return;
		self.handleAccessDrop(title);
	});

	var accessBtn = this.document.createElement("button");
	accessBtn.className = "llm-chat-btn-access";
	accessBtn.textContent = "\uD83D\uDC41\uFE0F";
	accessBtn.title = "Show accessible tiddlers (drop tiddlers to add/remove)";
	accessBtn.addEventListener("click", function() {
		var visible = accessPanel.style.display !== "none";
		accessPanel.style.display = visible ? "none" : "block";
		if (!visible) self.refreshAccessPanel();
	});
	buttonRow.appendChild(accessBtn);
	inputArea.appendChild(accessPanel);

	// Tool output toggle (expand/collapse tool messages in chat)
	this.toolOutputExpanded = false;
	var toolToggleBtn = this.document.createElement("button");
	toolToggleBtn.className = "llm-chat-btn-tool-toggle";
	toolToggleBtn.textContent = "\u2699\uFE0F";
	toolToggleBtn.title = "Expand tool call details (currently collapsed)";
	this.toolToggleBtn = toolToggleBtn;
	toolToggleBtn.addEventListener("click", function() {
		self.toolOutputExpanded = !self.toolOutputExpanded;
		toolToggleBtn.title = self.toolOutputExpanded
			? "Collapse tool call details (currently expanded)"
			: "Expand tool call details (currently collapsed)";
		toolToggleBtn.classList.toggle("llm-chat-btn-active", self.toolOutputExpanded);
		// Toggle all tool messages in the chat
		var toolMsgs = self.messagesDiv.querySelectorAll(".llm-chat-message-tool");
		for (var t = 0; t < toolMsgs.length; t++) {
			toolMsgs[t].classList.toggle("llm-chat-tool-expanded", self.toolOutputExpanded);
		}
	});
	buttonRow.appendChild(toolToggleBtn);

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

	// Auto-focus textarea when chat opens (defer to next tick so DOM is settled)
	if (this.textarea && this.textarea.focus) {
		setTimeout(function() { textarea.focus(); }, 50);
	}

	// Hook into pin button rendered by the wikitext template (sibling of container in header)
	this.pinBtn = null;
	this.pinMenu = null;
	var parentEl = container.parentNode;
	if (parentEl) {
		var existingPin = parentEl.querySelector(".llm-chat-btn-pin");
		if (existingPin) {
			this.pinBtn = existingPin;
			this.pinMenu = parentEl.querySelector(".llm-chat-pin-menu");
			existingPin.addEventListener("click", function(e) {
				e.stopPropagation();
				self.handlePinClick();
			});
			this.updatePinDisplay();
		}
		// Hook into export/import buttons
		var exportBtn = parentEl.querySelector(".llm-chat-btn-export");
		var importBtn = parentEl.querySelector(".llm-chat-btn-import");
		if (exportBtn) {
			exportBtn.addEventListener("click", function(e) {
				e.stopPropagation();
				self.exportChat();
			});
		}
		if (importBtn) {
			importBtn.addEventListener("click", function(e) {
				e.stopPropagation();
				self.importChat();
			});
		}
	}
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
	this.denyFilterAttr = this.getAttribute("denyFilter", "");
	this.allowFilterAttr = this.getAttribute("allowFilter", "");
	this.protectionModeAttr = this.getAttribute("protectionMode", "");
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
	// Auto-sync to saved tiddler if pinned
	if (this.isPinned()) {
		this.syncPinnedSave(messages);
	}
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
	// Click-to-toggle individual tool messages (delegated, attach once)
	if (!container._toolClickBound) {
		container.addEventListener("click", function(e) {
			var el = e.target.closest(".llm-chat-message-tool");
			if (el) el.classList.toggle("llm-chat-tool-expanded");
		});
		container._toolClickBound = true;
	}

	container.scrollTop = container.scrollHeight;
};

LlmChatWidget.prototype.renderOneMessage = function(msg) {
	var elements = [];
	var doc = this.document;

	var toolExpandedClass = this.toolOutputExpanded ? " llm-chat-tool-expanded" : "";

	// User message with tool_result content (Claude format)
	if (msg.role === "user" && Array.isArray(msg.content)) {
		for (var i = 0; i < msg.content.length; i++) {
			var block = msg.content[i];
			if (block.type === "tool_result") {
				var toolDiv = doc.createElement("div");
				toolDiv.className = "llm-chat-message llm-chat-message-tool" + toolExpandedClass;
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
						textDiv.className = "llm-chat-message llm-chat-message-assistant llm-chat-md";
						textDiv.innerHTML = markdownToHtml(textParts.join("\n"));
						elements.push(textDiv);
						textParts = [];
					}
					var toolCallDiv = doc.createElement("div");
					toolCallDiv.className = "llm-chat-message llm-chat-message-tool" + toolExpandedClass;
					var inputPreview = JSON.stringify(aBlock.input);
					if (inputPreview.length > 100) inputPreview = inputPreview.substring(0, 100) + "...";
					toolCallDiv.textContent = "\u{1F527} " + aBlock.name + "(" + inputPreview + ")";
					elements.push(toolCallDiv);
				}
			}
			if (textParts.length > 0) {
				var remainingDiv = doc.createElement("div");
				remainingDiv.className = "llm-chat-message llm-chat-message-assistant llm-chat-md";
				remainingDiv.innerHTML = markdownToHtml(textParts.join("\n"));
				elements.push(remainingDiv);
			}
		} else if (typeof msg.content === "string" && msg.content) {
			var assistDiv = doc.createElement("div");
			assistDiv.className = "llm-chat-message llm-chat-message-assistant llm-chat-md";
			assistDiv.innerHTML = markdownToHtml(msg.content);
			elements.push(assistDiv);
		}
		return elements;
	}

	// OpenAI tool result
	if (msg.role === "tool") {
		var toolResDiv = doc.createElement("div");
		toolResDiv.className = "llm-chat-message llm-chat-message-tool" + toolExpandedClass;
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
		var ctxError = this.injectContextOnFirstMessage(messages);
		if (ctxError) {
			this.textarea.value = text;
			this.setStatus(ctxError);
			return;
		}
	}

	// Late attachment injection — if context filter was set/changed after first message
	if (this.contextInjected && !this.attachmentsInjected) {
		var lateError = this.injectLateAttachments(messages);
		if (lateError) {
			this.textarea.value = text;
			this.setStatus(lateError);
			return;
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

	var protection = this.resolveProtectionForChat(helpers);
	var protectionFilterBefore = protection.filter;

	orchestrator.runConversation({
		messages: messages,
		tools: tools,
		config: config,
		adapter: adapter,
		toolExecutor: this.getToolExecutorModule(),
		protectionFilter: protection,
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
		// Persist protection filter if tools added new tiddlers
		if (protection.filter !== protectionFilterBefore) {
			self.persistProtectionUpdate(protection);
		}
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
	// Unpin before clearing (saved tiddler remains for restore)
	if (this.isPinned()) {
		this.unpin();
	}
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
	this.updatePinDisplay();
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
	var protection = this.resolveProtectionForChat(helpers);
	if (protection.filter) {
		preview.protectionFilter = protection.filter;
		preview.protectionMode = protection.mode;
	}

	return JSON.stringify(preview, null, 2);
};

// --- Pin / Save / Restore ---

LlmChatWidget.prototype.getSaveTitle = function() {
	if (!this.chatTiddler) return null;
	return "$:/saved-chats/rimir/llm-connect/" + chatContextSlug(this.chatTiddler);
};

LlmChatWidget.prototype.isPinned = function() {
	if (!this.chatTiddler) return false;
	var tid = this.wiki.getTiddler(this.chatTiddler);
	return tid && tid.fields["llm-pinned-save"] === "yes";
};

LlmChatWidget.prototype.hasSavedChat = function() {
	var saveTitle = this.getSaveTitle();
	return saveTitle && this.wiki.tiddlerExists(saveTitle);
};

LlmChatWidget.prototype.pin = function() {
	if (!this.chatTiddler) return;
	var chatTid = this.wiki.getTiddler(this.chatTiddler);
	if (!chatTid) {
		// Create the chat tiddler if it doesn't exist yet
		this.wiki.addTiddler(new $tw.Tiddler({
			title: this.chatTiddler,
			tags: "$:/tags/rimir/llm-connect/chat",
			"llm-pinned-save": "yes"
		}));
	} else {
		this.wiki.addTiddler(new $tw.Tiddler(chatTid, { "llm-pinned-save": "yes" }));
	}

	// Save current state to saved tiddler
	var messages = this.getMessages();
	this.syncPinnedSave(messages);
	this.updatePinDisplay();
};

LlmChatWidget.prototype.unpin = function() {
	if (!this.chatTiddler) return;
	var chatTid = this.wiki.getTiddler(this.chatTiddler);
	if (!chatTid) return;
	this.wiki.addTiddler(new $tw.Tiddler(chatTid, { "llm-pinned-save": "" }));
	this.updatePinDisplay();
};

LlmChatWidget.prototype.syncPinnedSave = function(messages) {
	var saveTitle = this.getSaveTitle();
	if (!saveTitle) return;
	var chatTid = this.wiki.getTiddler(this.chatTiddler);
	if (!messages) messages = this.getMessages();
	var fields = {
		title: saveTitle,
		tags: "$:/tags/rimir/llm-connect/saved-chat",
		"llm-chat-context": this.chatTiddler,
		"llm-messages": JSON.stringify(messages),
		"llm-message-count": String(messages.length),
		"llm-context-injected": this.contextInjected ? "yes" : "no",
		"llm-attachments-injected": this.attachmentsInjected ? "yes" : "no",
		"llm-system-prompt-override": this.systemPromptOverride || ""
	};
	// Copy all llm-* fields from chat tiddler
	if (chatTid) {
		var chatFields = chatTid.fields;
		for (var i = 0; i < CHAT_STATE_FIELDS.length; i++) {
			if (chatFields[CHAT_STATE_FIELDS[i]]) fields[CHAT_STATE_FIELDS[i]] = chatFields[CHAT_STATE_FIELDS[i]];
		}
	}
	this.wiki.addTiddler(new $tw.Tiddler(fields));
};

LlmChatWidget.prototype.syncIfPinned = function() {
	if (this.isPinned()) {
		this.syncPinnedSave();
	}
};

// --- Export / Import ---

LlmChatWidget.prototype.exportChat = function() {
	var self = this;
	var messages = this.getMessages();
	if (!messages.length) {
		this.setStatus("Nothing to export");
		setTimeout(function() { self.setStatus(""); }, 2000);
		return;
	}
	var chatTid = this.wiki.getTiddler(this.chatTiddler);
	var exportData = {
		version: 1,
		exported: new Date().toISOString(),
		messages: messages,
		provider: this.provider || "",
		model: this.model || ""
	};
	// Include all llm state fields
	if (chatTid) {
		for (var i = 0; i < CHAT_STATE_FIELDS.length; i++) {
			var key = CHAT_STATE_FIELDS[i];
			if (chatTid.fields[key]) exportData[key] = chatTid.fields[key];
		}
	}
	// Include widget instance state
	if (this.contextInjected) exportData["context-injected"] = true;
	if (this.attachmentsInjected) exportData["attachments-injected"] = true;
	if (this.systemPromptOverride) exportData["system-prompt-override"] = this.systemPromptOverride;
	var json = JSON.stringify(exportData, null, 2);
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(json).then(function() {
			self.setStatus("Chat exported to clipboard (" + messages.length + " messages)");
			setTimeout(function() { self.setStatus(""); }, 3000);
		}, function() {
			self.fallbackCopyToClipboard(json);
		});
	} else {
		this.fallbackCopyToClipboard(json);
	}
};

LlmChatWidget.prototype.fallbackCopyToClipboard = function(text) {
	var self = this;
	var ta = this.document.createElement("textarea");
	ta.value = text;
	ta.style.position = "fixed";
	ta.style.left = "-9999px";
	this.document.body.appendChild(ta);
	ta.select();
	try {
		this.document.execCommand("copy");
		self.setStatus("Chat exported to clipboard");
		setTimeout(function() { self.setStatus(""); }, 3000);
	} catch(e) {
		self.setStatus("Export failed — could not copy to clipboard");
		setTimeout(function() { self.setStatus(""); }, 3000);
	}
	this.document.body.removeChild(ta);
};

LlmChatWidget.prototype.importChat = function() {
	var self = this;
	if (navigator.clipboard && navigator.clipboard.readText) {
		navigator.clipboard.readText().then(function(text) {
			self.processImport(text);
		}, function() {
			// Clipboard read denied — show paste dialog
			self.showImportDialog();
		});
	} else {
		this.showImportDialog();
	}
};

LlmChatWidget.prototype.showImportDialog = function() {
	var self = this;
	var overlay = this.document.createElement("div");
	overlay.className = "llm-chat-import-overlay";
	var dialog = this.document.createElement("div");
	dialog.className = "llm-chat-import-dialog";
	var label = this.document.createElement("div");
	label.textContent = "Paste exported chat JSON:";
	label.style.marginBottom = "8px";
	label.style.fontWeight = "bold";
	dialog.appendChild(label);
	var ta = this.document.createElement("textarea");
	ta.className = "llm-chat-import-textarea";
	ta.placeholder = "Paste JSON here...";
	dialog.appendChild(ta);
	var btnRow = this.document.createElement("div");
	btnRow.style.display = "flex";
	btnRow.style.justifyContent = "flex-end";
	btnRow.style.gap = "8px";
	btnRow.style.marginTop = "8px";
	var cancelBtn = this.document.createElement("button");
	cancelBtn.textContent = "Cancel";
	cancelBtn.className = "llm-chat-import-btn";
	cancelBtn.addEventListener("click", function() {
		self.document.body.removeChild(overlay);
	});
	var importBtn = this.document.createElement("button");
	importBtn.textContent = "Import";
	importBtn.className = "llm-chat-import-btn llm-chat-import-btn-primary";
	importBtn.addEventListener("click", function() {
		self.processImport(ta.value);
		self.document.body.removeChild(overlay);
	});
	btnRow.appendChild(cancelBtn);
	btnRow.appendChild(importBtn);
	dialog.appendChild(btnRow);
	overlay.appendChild(dialog);
	this.document.body.appendChild(overlay);
	ta.focus();
};

LlmChatWidget.prototype.processImport = function(text) {
	var self = this;
	if (!text || !text.trim()) {
		this.setStatus("Clipboard is empty");
		setTimeout(function() { self.setStatus(""); }, 2000);
		return;
	}
	var data;
	try {
		data = JSON.parse(text);
	} catch(e) {
		this.setStatus("Import failed — invalid JSON");
		setTimeout(function() { self.setStatus(""); }, 3000);
		return;
	}
	if (!data.messages || !Array.isArray(data.messages)) {
		this.setStatus("Import failed — no messages found in data");
		setTimeout(function() { self.setStatus(""); }, 3000);
		return;
	}
	// Restore provider/model
	if (data.provider) this.provider = data.provider;
	if (data.model) this.model = data.model;
	// Restore widget instance state
	this.contextInjected = !!data["context-injected"];
	this.attachmentsInjected = !!data["attachments-injected"];
	this.systemPromptOverride = data["system-prompt-override"] || null;
	// Build fields for chat tiddler
	var fields = {
		title: this.chatTiddler,
		tags: "$:/tags/rimir/llm-connect/chat",
		"llm-messages": JSON.stringify(data.messages),
		"llm-provider": this.provider,
		"llm-model": this.model
	};
	for (var i = 0; i < CHAT_STATE_FIELDS.length; i++) {
		var key = CHAT_STATE_FIELDS[i];
		if (data[key]) fields[key] = data[key];
	}
	this.wiki.addTiddler(new $tw.Tiddler(fields));
	// Refresh UI
	this.renderMessages(this.messagesDiv);
	this.updateModelDisplay();
	this.updateTokenDisplay();
	if (this.isPinned()) {
		this.syncPinnedSave(data.messages);
	}
	this.setStatus("Chat imported (" + data.messages.length + " messages)");
	setTimeout(function() { self.setStatus(""); }, 3000);
};

LlmChatWidget.prototype.restoreChat = function() {
	var saveTitle = this.getSaveTitle();
	if (!saveTitle) return;
	var savedTid = this.wiki.getTiddler(saveTitle);
	if (!savedTid) return;

	// Restore widget instance state
	this.contextInjected = savedTid.fields["llm-context-injected"] === "yes";
	this.attachmentsInjected = savedTid.fields["llm-attachments-injected"] === "yes";
	this.systemPromptOverride = savedTid.fields["llm-system-prompt-override"] || null;

	// Copy fields to chat tiddler
	var fields = { title: this.chatTiddler, tags: "$:/tags/rimir/llm-connect/chat", "llm-pinned-save": "yes" };
	var restoreKeys = ["llm-messages"].concat(CHAT_STATE_FIELDS);
	for (var i = 0; i < restoreKeys.length; i++) {
		if (savedTid.fields[restoreKeys[i]]) fields[restoreKeys[i]] = savedTid.fields[restoreKeys[i]];
	}
	this.wiki.addTiddler(new $tw.Tiddler(fields));

	// Restore provider/model on widget
	this.provider = savedTid.fields["llm-provider"] || this.provider;
	this.model = savedTid.fields["llm-model"] || this.model;

	// Refresh UI
	this.renderMessages(this.messagesDiv);
	this.updateModelDisplay();
	this.updateTokenDisplay();
	this.updatePinDisplay();
	this.loadProtectionInput();
	this.updateProtectionLabels();
	this.refreshAccessPanel();
	this.refreshDebugPanel();
};

LlmChatWidget.prototype.handlePinClick = function() {
	var messages = this.getMessages();
	var hasMessages = messages.length > 0;
	var hasSave = this.hasSavedChat();
	var pinned = this.isPinned();

	if (pinned) {
		// Currently pinned → unpin
		this.unpin();
		return;
	}

	if (!hasSave) {
		// No save → pin (works for both empty and non-empty chat)
		this.pin();
		return;
	}

	if (hasSave && !hasMessages) {
		// Has save, empty chat → restore
		this.restoreChat();
		return;
	}

	// Has save AND has messages → show context menu
	this.showPinMenu();
};

LlmChatWidget.prototype.showPinMenu = function() {
	var self = this;
	var menu = this.pinMenu;
	menu.innerHTML = "";

	var saveItem = this.document.createElement("div");
	saveItem.className = "llm-chat-pin-menu-item";
	saveItem.textContent = "Save current";
	saveItem.addEventListener("click", function() {
		menu.style.display = "none";
		self.pin();
	});
	menu.appendChild(saveItem);

	var restoreItem = this.document.createElement("div");
	restoreItem.className = "llm-chat-pin-menu-item";
	restoreItem.textContent = "Restore saved";
	restoreItem.addEventListener("click", function() {
		menu.style.display = "none";
		if (confirm("Restore saved chat? This will replace the current conversation.")) {
			self.restoreChat();
		}
	});
	menu.appendChild(restoreItem);

	var clearItem = this.document.createElement("div");
	clearItem.className = "llm-chat-pin-menu-item llm-chat-pin-menu-item-danger";
	clearItem.textContent = "Clear all";
	clearItem.addEventListener("click", function() {
		menu.style.display = "none";
		if (confirm("Clear chat and delete saved chat? This cannot be undone.")) {
			// Delete saved tiddler
			var saveTitle = self.getSaveTitle();
			if (saveTitle && self.wiki.tiddlerExists(saveTitle)) {
				self.wiki.deleteTiddler(saveTitle);
			}
			self.clearChat();
		}
	});
	menu.appendChild(clearItem);

	menu.style.display = "block";

	// Close on outside click
	var closeHandler = function(ev) {
		if (!menu.contains(ev.target) && ev.target !== self.pinBtn) {
			menu.style.display = "none";
			self.document.removeEventListener("mousedown", closeHandler, true);
		}
	};
	setTimeout(function() {
		self.document.addEventListener("mousedown", closeHandler, true);
	}, 0);
};

LlmChatWidget.prototype.updatePinDisplay = function() {
	if (!this.pinBtn) return;
	var pinned = this.isPinned();
	var hasSave = this.hasSavedChat();

	this.pinBtn.textContent = pinned ? this.pinIconActive : this.pinIconDefault;
	this.pinBtn.classList.toggle("llm-chat-btn-pin-active", pinned);
	this.pinBtn.classList.toggle("llm-chat-btn-pin-has-save", hasSave && !pinned);

	if (pinned) {
		this.pinBtn.title = "Chat is pinned (click to unpin)";
	} else if (hasSave) {
		this.pinBtn.title = "Saved chat available (click to restore)";
	} else {
		this.pinBtn.title = "Pin chat to save it";
	}
};

LlmChatWidget.prototype.persistProtectionUpdate = function(protection) {
	if (!this.chatTiddler) return;
	var field = protection.mode === "allow" ? "llm-allow-filter" : "llm-deny-filter";
	var fields = { title: this.chatTiddler };
	fields[field] = protection.filter;
	var existing = this.wiki.getTiddler(this.chatTiddler);
	if (existing) fields = $tw.utils.extend({}, existing.fields, fields);
	this.wiki.addTiddler(new $tw.Tiddler(fields));
	this.loadProtectionInput();
	this.refreshAccessPanel();
	this.syncIfPinned();
};

LlmChatWidget.prototype.buildAttachmentParts = function(attachments) {
	var parts = [];
	for (var ti = 0; ti < attachments.textTitles.length; ti++) {
		parts.push({ type: "text", text: attachments.renderText(attachments.textTitles[ti]) });
	}
	for (var fi = 0; fi < attachments.fileParts.length; fi++) {
		var fp = attachments.fileParts[fi];
		parts.push({ type: "file_ref", uri: fp.uri, mediaType: fp.mediaType, category: fp.category, filename: fp.filename, title: fp.title });
	}
	return parts;
};

LlmChatWidget.prototype.getChatContextFilter = function() {
	if (!this.chatTiddler) return "";
	var tid = this.wiki.getTiddler(this.chatTiddler);
	return tid ? (tid.fields["llm-context-filter"] || "") : "";
};

LlmChatWidget.prototype.injectContextOnFirstMessage = function(messages) {
	var contextResolver = this.getContextResolverModule();
	var templateTitle = contextResolver.resolveTemplate({
		sourceTiddler: this.sourceTiddler,
		contextTemplate: this.contextTemplateAttr
	});
	var rendered = contextResolver.renderContext({
		templateTitle: templateTitle,
		sourceTiddler: this.sourceTiddler
	});

	var attachments = contextResolver.resolveContextAttachments({
		sourceTiddler: this.sourceTiddler,
		chatFilter: this.getChatContextFilter(),
		templateTitle: templateTitle
	});

	if (attachments.error) {
		return "Context filter error: " + attachments.error;
	}

	var hasFiles = attachments.fileParts.length > 0;
	var hasTextAttachments = attachments.textTitles.length > 0;

	if (rendered.text || hasFiles || hasTextAttachments) {
		if (rendered.injectAs === "system-prompt") {
			this.systemPromptOverride = (this.systemPromptAttr ? this.systemPromptAttr + "\n\n" : "") + rendered.text;
			if (hasFiles || hasTextAttachments) {
				var parts = this.buildAttachmentParts(attachments);
				if (parts.length > 0) {
					messages.push({ role: "user", content: parts, _context: true });
				}
			}
		} else {
			var contentParts = [];
			if (rendered.text) {
				contentParts.push({ type: "text", text: rendered.text });
			}
			contentParts = contentParts.concat(this.buildAttachmentParts(attachments));
			if (contentParts.length === 1 && contentParts[0].type === "text") {
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
	return null;
};

LlmChatWidget.prototype.injectLateAttachments = function(messages) {
	var lateCtxFilter = this.getChatContextFilter();
	if (!lateCtxFilter) return null;

	var contextResolver = this.getContextResolverModule();
	var attachments = contextResolver.resolveContextAttachments({
		sourceTiddler: this.sourceTiddler,
		chatFilter: lateCtxFilter,
		templateTitle: null
	});

	if (attachments.error) {
		return "Context filter error: " + attachments.error;
	}

	if (attachments.fileParts.length > 0 || attachments.textTitles.length > 0) {
		var parts = this.buildAttachmentParts(attachments);
		if (parts.length > 0) {
			messages.push({ role: "user", content: parts, _context: true });
		}
		this.attachmentsInjected = true;
	}
	return null;
};

LlmChatWidget.prototype.refreshAccessPanel = function() {
	if (!this.accessList || this.accessPanel.style.display === "none") return;
	var helpers = this.getWidgetHelpersModule();
	var protection = this.resolveProtectionForChat(helpers);
	var self = this;

	this.accessList.innerHTML = "";

	var allTitles = this.wiki.filterTiddlers("[all[tiddlers+shadows]sort[title]]");
	var accessible = [];

	if (protection.mode === "allow") {
		if (protection.filter) {
			var allowed = Object.create(null);
			var allowList = this.wiki.filterTiddlers(protection.filter);
			for (var i = 0; i < allowList.length; i++) allowed[allowList[i]] = true;
			for (var j = 0; j < allTitles.length; j++) {
				if (allowed[allTitles[j]]) accessible.push(allTitles[j]);
			}
		}
		// allow mode with empty filter = nothing accessible
	} else {
		if (protection.filter) {
			var denied = Object.create(null);
			var denyList = this.wiki.filterTiddlers(protection.filter);
			for (var i2 = 0; i2 < denyList.length; i2++) denied[denyList[i2]] = true;
			for (var j2 = 0; j2 < allTitles.length; j2++) {
				if (!denied[allTitles[j2]]) accessible.push(allTitles[j2]);
			}
		} else {
			accessible = allTitles;
		}
	}

	this.accessTitle.textContent = "Accessible tiddlers (" + accessible.length + ")";

	for (var k = 0; k < accessible.length; k++) {
		var link = this.document.createElement("a");
		link.className = "llm-chat-access-link tc-tiddlylink";
		link.textContent = accessible[k];
		link.setAttribute("data-title", accessible[k]);
		link.addEventListener("click", function(e) {
			e.preventDefault();
			var t = this.getAttribute("data-title");
			var bounds = { left: 0, top: 0, width: 0, height: 0 };
			self.dispatchEvent({ type: "tm-navigate", navigateTo: t, navigateFromTitle: self.chatTiddler, navigateFromClientRect: bounds });
		});
		this.accessList.appendChild(link);
	}
};

LlmChatWidget.prototype.handleAccessDrop = function(title) {
	var mode = this.getActiveProtectionMode();
	var field = mode === "allow" ? "llm-allow-filter" : "llm-deny-filter";
	// Note: [[title]] notation breaks if title contains "]]" — extremely rare in TiddlyWiki
	var escaped = "[[" + title + "]]";
	var negated = "-[[" + title + "]]";

	// Get current per-chat filter value
	var currentFilter = "";
	if (this.chatTiddler) {
		var tid = this.wiki.getTiddler(this.chatTiddler);
		if (tid) currentFilter = tid.fields[field] || "";
	}

	if (mode === "allow") {
		// Allow mode: add tiddler to the whitelist (if not already there)
		if (currentFilter.indexOf(escaped) === -1) {
			currentFilter = (currentFilter + " " + escaped).trim();
		}
	} else {
		// Deny mode: add -[[title]] to exclude it from the blacklist (make it accessible)
		if (currentFilter.indexOf(negated) === -1) {
			currentFilter = (currentFilter + " " + negated).trim();
		}
	}

	// Save back
	this.saveChatField(field, currentFilter);

	// Update the protection input to reflect the change
	this.loadProtectionInput();
	this.refreshAccessPanel();
	this.refreshDebugPanel();
	this.syncIfPinned();
};

LlmChatWidget.prototype.resolveProtectionForChat = function(helpers) {
	var denyFilter = this.denyFilterAttr || "";
	var allowFilter = this.allowFilterAttr || "";
	var protMode = this.protectionModeAttr || "";
	if (this.chatTiddler) {
		var tid = this.wiki.getTiddler(this.chatTiddler);
		if (tid) {
			var chatDeny = tid.fields["llm-deny-filter"] || "";
			var chatAllow = tid.fields["llm-allow-filter"] || "";
			if (chatDeny) denyFilter = (denyFilter + " " + chatDeny).trim();
			if (chatAllow) allowFilter = (allowFilter + " " + chatAllow).trim();
			if (!protMode) protMode = tid.fields["llm-protection-mode"] || "";
		}
	}
	// Always grant access to the source tiddler (e.g. pair-edit target)
	if (this.sourceTiddler) {
		var escaped = "[[" + this.sourceTiddler + "]]";
		var protection = helpers.resolveProtectionFilter({ denyFilter: denyFilter, allowFilter: allowFilter, mode: protMode });
		if (protection.mode === "allow") {
			protection.filter = (protection.filter + " " + escaped).trim();
		} else {
			protection.filter = (protection.filter + " -" + escaped).trim();
		}
		return protection;
	}
	return helpers.resolveProtectionFilter({ denyFilter: denyFilter, allowFilter: allowFilter, mode: protMode });
};

LlmChatWidget.prototype.getModule = function(name) {
	return require("$:/plugins/rimir/llm-connect/" + name);
};

LlmChatWidget.prototype.getOrchestratorModule = function() {
	return this.getModule("orchestrator");
};

LlmChatWidget.prototype.getToolExecutorModule = function() {
	return this.getModule("tool-executor");
};

LlmChatWidget.prototype.getContextResolverModule = function() {
	return this.getModule("context-resolver");
};

LlmChatWidget.prototype.getWidgetHelpersModule = function() {
	return this.getModule("widget-helpers");
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

LlmChatWidget.prototype.getActiveProtectionMode = function() {
	return this.protectionModeSelect ? this.protectionModeSelect.value : "allow";
};

LlmChatWidget.prototype.loadProtectionInput = function() {
	if (!this.protectionInput) return;
	var mode = this.getActiveProtectionMode();
	var field = mode === "allow" ? "llm-allow-filter" : "llm-deny-filter";
	var widgetDefault = mode === "allow" ? (this.allowFilterAttr || "") : (this.denyFilterAttr || "");
	var value = widgetDefault;
	if (this.chatTiddler) {
		var tid = this.wiki.getTiddler(this.chatTiddler);
		if (tid && tid.fields[field]) value = tid.fields[field];
	}
	this.protectionInput.value = value;
};

LlmChatWidget.prototype.saveChatField = function(fieldName, value) {
	if (!this.chatTiddler) return;
	var fields = { title: this.chatTiddler };
	fields[fieldName] = value;
	var existing = this.wiki.getTiddler(this.chatTiddler);
	if (existing) fields = $tw.utils.extend({}, existing.fields, fields);
	this.wiki.addTiddler(new $tw.Tiddler(fields));
};

LlmChatWidget.prototype.saveProtectionInput = function() {
	if (!this.protectionInput || !this.chatTiddler) return;
	var mode = this.getActiveProtectionMode();
	var field = mode === "allow" ? "llm-allow-filter" : "llm-deny-filter";
	this.saveChatField(field, this.protectionInput.value);
	this.syncIfPinned();
};

LlmChatWidget.prototype.updateProtectionLabels = function() {
	var mode = this.getActiveProtectionMode();
	if (this.protectionFilterLabel) {
		this.protectionFilterLabel.textContent = mode === "allow" ? "Allow:" : "Deny:";
	}
	if (this.protectionModeHint) {
		this.protectionModeHint.textContent = mode === "allow"
			? " — only matching tiddlers are accessible"
			: " — matching tiddlers are hidden from LLM";
	}
	// Update base filter display for the active mode
	if (this.protectionBaseFilterSpan && this.protectionBaseRow) {
		var baseConfigTiddler = mode === "allow"
			? "$:/config/rimir/llm-connect/allow-filter"
			: "$:/config/rimir/llm-connect/protection-filter";
		var baseFilter = this.wiki.getTiddlerText(baseConfigTiddler) || "";
		this.protectionBaseFilterSpan.textContent = baseFilter;
		this.protectionBaseRow.style.display = baseFilter ? "" : "none";
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
		this.syncIfPinned();
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
	// Refresh accessible panel when protection-related config changes
	if (changedTiddlers["$:/config/rimir/llm-connect/excluded-plugins"] ||
		changedTiddlers["$:/config/rimir/llm-connect/protection-mode"] ||
		changedTiddlers["$:/config/rimir/llm-connect/protection-filter"] ||
		changedTiddlers["$:/config/rimir/llm-connect/allow-filter"]) {
		this.updateProtectionLabels();
		this.refreshAccessPanel();
	}
	return false;
};

function chatContextSlug(chatTiddler) {
	return chatTiddler.replace(/^\$:\/temp\/rimir\//, "").replace(/[^a-zA-Z0-9-]/g, "-");
}

function negateFilter(filter) {
	if (!filter) return "";
	// Parse filter into runs by tracking bracket depth
	var runs = [];
	var i = 0;
	while (i < filter.length) {
		// Skip whitespace
		if (filter[i] === " ") { i++; continue; }
		// Detect optional - prefix
		var start = i;
		if (filter[i] === "-" && i + 1 < filter.length && filter[i + 1] === "[") i++;
		// Must start with [
		if (filter[i] !== "[") { i++; continue; }
		// Track bracket depth to find balanced end
		var depth = 0;
		var j = i;
		while (j < filter.length) {
			if (filter[j] === "[") depth++;
			else if (filter[j] === "]") { depth--; if (depth === 0) break; }
			j++;
		}
		runs.push(filter.substring(start, j + 1));
		i = j + 1;
	}
	if (runs.length === 0) return filter;
	var negated = [];
	for (var k = 0; k < runs.length; k++) {
		var run = runs[k];
		if (run.charAt(0) === "-") {
			negated.push(run.substring(1));
		} else {
			negated.push("-" + run);
		}
	}
	return negated.join(" ");
}

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
