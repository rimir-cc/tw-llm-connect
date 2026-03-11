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
	this.outputTargetAttr = this.getAttribute("outputTarget", "");
	this.outputModeAttr = this.getAttribute("outputMode", "");
	this.toolsFilter = this.getAttribute("tools", "");
	this.systemPromptAttr = this.getAttribute("systemPrompt", "");
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

	// Resolve prompt
	var prompt = contextResolver.resolvePrompt({
		prompt: this.promptAttr,
		promptTemplate: this.promptTemplateAttr
	});

	// Get provider config
	var config = orchestrator.getProviderConfig();
	if (this.systemPromptAttr) {
		config.systemPrompt = this.systemPromptAttr;
	}

	var adapter = orchestrator.getAdapter(config.provider);

	// Get tools if specified
	var tools = [];
	if (this.toolsFilter) {
		tools = toolExecutor.getToolDefinitions(this.toolsFilter);
	}

	// Set status
	this.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/rimir/llm-connect/action-status",
		text: "Running..."
	}));

	// Run the action
	var baseProtection = this.wiki.getTiddlerText("$:/config/rimir/llm-connect/protection-filter") || "";

	orchestrator.runAction({
		prompt: prompt,
		contextText: rendered.text,
		injectAs: rendered.injectAs,
		tools: tools,
		config: config,
		adapter: adapter,
		toolExecutor: toolExecutor,
		protectionFilter: baseProtection
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
