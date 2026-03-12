/*\
title: $:/plugins/rimir/llm-connect/action-widget
type: application/javascript
module-type: widget

<$llm-action> widget — one-shot LLM invocation (action mode)

\*/
(function() {

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var LlmActionWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

LlmActionWidget.prototype = new Widget();

LlmActionWidget.prototype.render = function(parent, nextSibling) {
	this.computeAttributes();
	this.execute();
};

LlmActionWidget.prototype.execute = function() {
	this.sourceTiddler = this.getAttribute("tiddler", "");
	this.promptAttr = this.getAttribute("prompt", "");
	this.promptTemplateAttr = this.getAttribute("promptTemplate", "");
	this.contextTemplateAttr = this.getAttribute("contextTemplate", "");
	this.contextFilterAttr = this.getAttribute("context", "");
	this.outputTargetAttr = this.getAttribute("outputTarget", "");
	this.outputModeAttr = this.getAttribute("outputMode", "");
	this.toolsFilter = this.getAttribute("tools", "");
	this.toolGroupAttr = this.getAttribute("toolGroup", "");
	this.systemPromptAttr = this.getAttribute("systemPrompt", "");
	this.providerAttr = this.getAttribute("provider", "");
	this.modelAttr = this.getAttribute("model", "");
	this.protectionFilterAttr = this.getAttribute("protectionFilter", "");
};

LlmActionWidget.prototype.invokeAction = function(triggeringWidget, event) {
	var self = this;
	var contextResolver = require("$:/plugins/rimir/llm-connect/context-resolver");
	var orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");
	var toolExecutor = require("$:/plugins/rimir/llm-connect/tool-executor");

	// Resolve context template
	var templateTitle = contextResolver.resolveTemplate({
		sourceTiddler: this.sourceTiddler,
		promptTemplate: this.promptTemplateAttr,
		contextTemplate: this.contextTemplateAttr
	});

	// Render context
	var rendered = contextResolver.renderContext({
		templateTitle: templateTitle,
		sourceTiddler: this.sourceTiddler,
		outputMode: this.outputModeAttr || undefined,
		outputTarget: this.outputTargetAttr || undefined
	});

	// Resolve context attachments
	var attachments = contextResolver.resolveContextAttachments({
		sourceTiddler: this.sourceTiddler,
		chatFilter: this.contextFilterAttr,
		templateTitle: templateTitle
	});

	// Abort if context filter is broken
	if (attachments.error) {
		this.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/rimir/llm-connect/action-status",
			text: "Context filter error: " + attachments.error
		}));
		return true;
	}

	// Resolve prompt
	var prompt = contextResolver.resolvePrompt({
		prompt: this.promptAttr,
		promptTemplate: this.promptTemplateAttr
	});

	// Get provider config (allow override via attributes)
	var config = orchestrator.getProviderConfig(this.providerAttr || undefined);
	if (this.modelAttr) {
		config.model = this.modelAttr;
	}
	if (this.systemPromptAttr) {
		config.systemPrompt = this.systemPromptAttr;
	}

	var adapter = orchestrator.getAdapter(config.provider);

	// Get tools if specified (toolGroup narrows to group members)
	var tools = [];
	if (this.toolsFilter || this.toolGroupAttr) {
		var activeTitles = this.toolGroupAttr ? toolExecutor.resolveToolGroup(this.toolGroupAttr) : undefined;
		tools = toolExecutor.getToolDefinitions(this.toolsFilter || "[tag[$:/tags/rimir/llm-connect/tool]]", activeTitles || undefined);
	}

	// Set status
	this.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/rimir/llm-connect/action-status",
		text: "Running..."
	}));

	// Build context content (may include file_ref blocks)
	var contextContent = rendered.text;
	var hasAttachments = attachments.fileParts.length > 0 || attachments.textTitles.length > 0;
	if (hasAttachments) {
		var contentParts = [];
		if (rendered.text) {
			contentParts.push({ type: "text", text: rendered.text });
		}
		for (var ti = 0; ti < attachments.textTitles.length; ti++) {
			contentParts.push({ type: "text", text: attachments.renderText(attachments.textTitles[ti]) });
		}
		for (var fi = 0; fi < attachments.fileParts.length; fi++) {
			var fp = attachments.fileParts[fi];
			contentParts.push({ type: "file_ref", uri: fp.uri, mediaType: fp.mediaType, category: fp.category, filename: fp.filename, title: fp.title });
		}
		contextContent = contentParts;
	}

	// Run the action
	var baseProtection = this.wiki.getTiddlerText("$:/config/rimir/llm-connect/protection-filter") || "";
	var protectionFilter = (baseProtection + " " + (this.protectionFilterAttr || "")).trim();

	orchestrator.runAction({
		prompt: prompt,
		contextText: contextContent,
		injectAs: rendered.injectAs,
		tools: tools,
		config: config,
		adapter: adapter,
		toolExecutor: toolExecutor,
		protectionFilter: protectionFilter
	}).then(function(responseText) {
		// Write output
		self.writeOutput(responseText, rendered, templateTitle);
		self.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/rimir/llm-connect/action-status",
			text: ""
		}));
	})["catch"](function(err) {
		self.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/rimir/llm-connect/action-status",
			text: "Error: " + err.message
		}));
	});

	return true;
};

LlmActionWidget.prototype.writeOutput = function(responseText, rendered, templateTitle) {
	var outputTarget = this.outputTargetAttr || rendered.outputTarget || "display";
	var contextResolver = require("$:/plugins/rimir/llm-connect/context-resolver");

	if (outputTarget === "display") {
		// Write to temp tiddler for display
		this.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/rimir/llm-connect/action-result",
			text: responseText,
			source: this.sourceTiddler,
			timestamp: new Date().toISOString()
		}));
		return;
	}

	var target = contextResolver.resolveOutputTarget(outputTarget, this.sourceTiddler);
	if (!target) return;

	if (target.isNewTiddler) {
		contextResolver.createOutputTiddler(templateTitle, this.sourceTiddler, responseText);
		return;
	}

	if (target.title && target.field) {
		var tiddler = this.wiki.getTiddler(target.title);
		var update = { title: target.title };
		update[target.field] = responseText;
		this.wiki.addTiddler(new $tw.Tiddler(tiddler || {}, update));
	}
};

LlmActionWidget.prototype.refresh = function() {
	return false;
};

exports["llm-action"] = LlmActionWidget;

})();
