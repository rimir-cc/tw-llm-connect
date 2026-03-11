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
	textarea.placeholder = "Type your message... (Enter to send, Ctrl+Enter for newline)";
	textarea.rows = 3;
	this.textarea = textarea;

	var self = this;
	textarea.addEventListener("keydown", function(e) {
		if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
			e.preventDefault();
			self.sendMessage();
		}
	});
	inputArea.appendChild(textarea);

	var buttonRow = this.document.createElement("div");
	buttonRow.className = "llm-chat-button-row";

	var providerInfo = this.document.createElement("span");
	providerInfo.className = "llm-chat-provider-info";
	providerInfo.textContent = this.provider + " / " + this.model;
	buttonRow.appendChild(providerInfo);

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

	var sendBtn = this.document.createElement("button");
	sendBtn.className = "llm-chat-btn llm-chat-btn-send";
	sendBtn.textContent = "Send";
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
	this.contextTemplateAttr = this.getAttribute("contextTemplate", "");
	this.sourceTiddler = this.getAttribute("tiddler", "");

	var config = this.getOrchestratorModule().getProviderConfig();
	this.provider = config.provider;
	this.model = config.model;
	this.contextInjected = false;
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
			userDiv.textContent = "\u{1F4CB} Context injected (click to expand)";
			userDiv.title = typeof msg.content === "string" ? msg.content.substring(0, 500) : "";
			userDiv.addEventListener("click", function() {
				if (userDiv.classList.contains("llm-chat-context-expanded")) {
					userDiv.classList.remove("llm-chat-context-expanded");
					userDiv.textContent = "\u{1F4CB} Context injected (click to expand)";
				} else {
					userDiv.classList.add("llm-chat-context-expanded");
					userDiv.textContent = typeof msg.content === "string" ? msg.content : "";
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
	if (!text) return;
	this.textarea.value = "";

	var messages = this.getMessages();
	var self = this;

	// Inject context on first message if configured
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

		if (rendered.text) {
			if (rendered.injectAs === "system-prompt") {
				this.systemPromptOverride = (this.systemPromptAttr ? this.systemPromptAttr + "\n\n" : "") + rendered.text;
			} else {
				messages.push({ role: "user", content: rendered.text, _context: true });
			}
		}
		this.contextInjected = true;
	}

	messages.push({ role: "user", content: text });
	this.saveMessages(messages);
	this.renderMessages(this.messagesDiv);

	this.setStatus("Thinking...");
	this.stopBtn.style.display = "inline-block";
	this.abortController = new AbortController();

	var orchestrator = this.getOrchestratorModule();
	var toolExecutor = this.getToolExecutorModule();
	var config = orchestrator.getProviderConfig();

	if (this.systemPromptOverride) {
		config.systemPrompt = this.systemPromptOverride;
	} else if (this.systemPromptAttr) {
		config.systemPrompt = this.systemPromptAttr;
	}

	var adapter = orchestrator.getAdapter(config.provider);
	var tools = [];
	if (this.toolsFilter) {
		var chatTid = this.wiki.getTiddler(this.chatTiddler);
		var activeTitles;
		if (chatTid && chatTid.fields["llm-tools-init"] === "yes") {
			activeTitles = $tw.utils.parseStringArray(chatTid.fields["llm-active-tools"] || "");
		} else {
			activeTitles = $tw.wiki.filterTiddlers("[all[shadows]tag[$:/tags/rimir/llm-connect/tool]]");
		}
		tools = toolExecutor.getToolDefinitions(this.toolsFilter, activeTitles);
	}

	orchestrator.runConversation({
		messages: messages,
		tools: tools,
		config: config,
		adapter: adapter,
		toolExecutor: toolExecutor,
		signal: this.abortController.signal,
		onUpdate: function(msgs) {
			self.saveMessages(msgs);
			self.renderMessages(self.messagesDiv);
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

LlmChatWidget.prototype.getOrchestratorModule = function() {
	return require("$:/plugins/rimir/llm-connect/orchestrator");
};

LlmChatWidget.prototype.getToolExecutorModule = function() {
	return require("$:/plugins/rimir/llm-connect/tool-executor");
};

LlmChatWidget.prototype.getContextResolverModule = function() {
	return require("$:/plugins/rimir/llm-connect/context-resolver");
};

LlmChatWidget.prototype.refresh = function(changedTiddlers) {
	if (changedTiddlers[this.chatTiddler]) {
		this.renderMessages(this.messagesDiv);
	}
	return false;
};

exports["llm-chat"] = LlmChatWidget;

})();
