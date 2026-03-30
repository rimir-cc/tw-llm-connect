/*\
title: $:/plugins/rimir/llm-connect/context-resolver
type: application/javascript
module-type: library

Context template resolution — precedence chain, rendering (text/markup), output target resolution

\*/
(function() {

"use strict";

/*
Resolve which context template to use.
Precedence: tiddler field > prompt template > widget attribute > global default > built-in
*/
exports.resolveTemplate = function(options) {
	var sourceTiddler = options.sourceTiddler;
	var promptTemplateTiddler = options.promptTemplate;
	var widgetContextTemplate = options.contextTemplate;

	// 1. Tiddler field
	if (sourceTiddler) {
		var tiddler = $tw.wiki.getTiddler(sourceTiddler);
		if (tiddler && tiddler.fields["llm-context-template"]) {
			return tiddler.fields["llm-context-template"];
		}
	}

	// 2. Prompt template
	if (promptTemplateTiddler) {
		var promptTiddler = $tw.wiki.getTiddler(promptTemplateTiddler);
		if (promptTiddler && promptTiddler.fields["context-template"]) {
			return promptTiddler.fields["context-template"];
		}
	}

	// 3. Widget attribute
	if (widgetContextTemplate) {
		return widgetContextTemplate;
	}

	// 4. Global default
	var globalDefault = $tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/default-context-template");
	if (globalDefault && globalDefault.trim()) {
		return globalDefault.trim();
	}

	// 5. Built-in default (null means use built-in behavior)
	return null;
};

/*
Render a context template with the given source tiddler as currentTiddler.
Returns { text: string, outputMode: string, outputTarget: string, injectAs: string }
*/
exports.renderContext = function(options) {
	var templateTitle = options.templateTitle;
	var sourceTiddler = options.sourceTiddler;
	var outputModeOverride = options.outputMode;
	var outputTargetOverride = options.outputTarget;

	// Built-in default: render source tiddler text
	if (!templateTitle) {
		if (!sourceTiddler) {
			return {
				text: null,
				outputMode: "text",
				outputTarget: "display",
				injectAs: "user-message"
			};
		}
		var sourceText = $tw.wiki.getTiddlerText(sourceTiddler) || "";
		return {
			text: wikifyText(sourceText, sourceTiddler),
			outputMode: "text",
			outputTarget: "display",
			injectAs: "user-message"
		};
	}

	var templateTiddler = $tw.wiki.getTiddler(templateTitle);
	if (!templateTiddler) {
		return {
			text: null,
			outputMode: "text",
			outputTarget: "display",
			injectAs: "user-message"
		};
	}

	var outputMode = outputModeOverride || templateTiddler.fields["output-mode"] || "text";
	var outputTarget = outputTargetOverride || templateTiddler.fields["output-target"] || "display";
	var injectAs = templateTiddler.fields["inject-as"] || "user-message";
	var wikitext = templateTiddler.fields.text || "";

	var renderedText;
	if (outputMode === "markup") {
		renderedText = renderWikitext(wikitext, sourceTiddler);
	} else {
		renderedText = wikifyText(wikitext, sourceTiddler);
	}

	return {
		text: renderedText,
		outputMode: outputMode,
		outputTarget: outputTarget,
		injectAs: injectAs
	};
};

/*
Resolve the output target to a concrete tiddler title and field.
Returns { title: string|null, field: string|null } or null for display-only.
*/
exports.resolveOutputTarget = function(outputTarget, sourceTiddler) {
	if (!outputTarget || outputTarget === "display") {
		return null;
	}

	if (outputTarget.indexOf("field:") === 0) {
		var fieldName = outputTarget.substring(6);
		return {
			title: sourceTiddler,
			field: fieldName
		};
	}

	if (outputTarget === "new-tiddler") {
		return { title: null, field: "text", isNewTiddler: true };
	}

	// Filter expression — evaluate to get target title
	try {
		var titles = $tw.wiki.filterTiddlers(outputTarget);
		if (titles.length > 0) {
			return { title: titles[0], field: "text" };
		}
	} catch(e) {
		// Fall through
	}

	return null;
};

/*
Create a new tiddler for output based on template fields.
Returns the title of the created tiddler.
*/
exports.createOutputTiddler = function(templateTitle, sourceTiddler, content) {
	var templateTiddler = templateTitle ? $tw.wiki.getTiddler(templateTitle) : null;
	var titleTemplate = templateTiddler ? (templateTiddler.fields["output-title-template"] || "") : "";
	var tagsStr = templateTiddler ? (templateTiddler.fields["output-tags"] || "") : "";
	var fieldsJson = templateTiddler ? (templateTiddler.fields["output-fields"] || "{}") : "{}";

	var title = substituteVars(titleTemplate, sourceTiddler) ||
		(sourceTiddler + "/LLM Response — " + $tw.utils.formatDateString(new Date(), "YYYY-0MM-0DD 0hh:0mm"));
	var tags = substituteVars(tagsStr, sourceTiddler);

	var extraFields = {};
	try {
		var parsed = JSON.parse(substituteVars(fieldsJson, sourceTiddler));
		extraFields = parsed;
	} catch(e) {
		console.warn("llm-connect: Failed to parse output-fields JSON:", e);
	}

	var tiddlerFields = $tw.utils.extend({}, extraFields, {
		title: title,
		text: content,
		tags: tags,
		created: new Date(),
		modified: new Date()
	});

	$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
	return title;
};

/*
Resolve the prompt text from either inline prompt or prompt template.
*/
exports.resolvePrompt = function(options) {
	if (options.prompt) {
		return options.prompt;
	}
	if (options.promptTemplate) {
		var tiddler = $tw.wiki.getTiddler(options.promptTemplate);
		if (tiddler && tiddler.fields["prompt-template"]) {
			return tiddler.fields["prompt-template"];
		}
	}
	return "";
};

/*
Resolve context attachments from a filter.
Merges llm-context field on sourceTiddler + chatFilter (per-chat).
Returns { textTitles: string[], fileParts: fileInfo[], renderText: function(title) }
where fileInfo = { title, uri, mediaType, category, filename }
*/
exports.resolveContextAttachments = function(options) {
	var sourceTiddler = options.sourceTiddler;
	var chatFilter = options.chatFilter;
	var templateTitle = options.templateTitle;

	// Merge filters from tiddler field + per-chat input
	var filters = [];
	if (sourceTiddler) {
		var tiddler = $tw.wiki.getTiddler(sourceTiddler);
		if (tiddler && tiddler.fields["llm-context"]) {
			filters.push(tiddler.fields["llm-context"]);
		}
	}
	if (chatFilter && chatFilter.trim()) {
		filters.push(chatFilter.trim());
	}

	if (filters.length === 0) {
		return { textTitles: [], fileParts: [], renderText: renderTextForTitle };
	}

	var combined = filters.join(" ");
	var titles = $tw.wiki.filterTiddlers(combined);

	// Detect filter errors (TW returns error strings as result items)
	var filterErrors = [];
	var validTitles = [];
	for (var i = 0; i < titles.length; i++) {
		if (/^Filter error:/.test(titles[i])) {
			filterErrors.push(titles[i]);
		} else {
			validTitles.push(titles[i]);
		}
	}

	if (filterErrors.length > 0) {
		return {
			textTitles: [],
			fileParts: [],
			renderText: renderTextForTitle,
			error: filterErrors.join("; ")
		};
	}

	var fileResolver = require("$:/plugins/rimir/llm-connect/file-resolver");
	var classified = fileResolver.classifyTitles(validTitles);

	return {
		textTitles: classified.textTitles,
		fileParts: classified.fileParts,
		renderText: renderTextForTitle
	};
};

function renderTextForTitle(title) {
	var text = $tw.wiki.getTiddlerText(title) || "";
	return "=== " + title + " ===\n" + wikifyText(text, title);
}

function wikifyText(wikitext, currentTiddler) {
	var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", wikitext);
	var variables = {};
	if (currentTiddler) {
		variables.currentTiddler = currentTiddler;
	}
	var widgetNode = $tw.wiki.makeWidget(parser, {
		document: $tw.fakeDocument,
		variables: variables
	});
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);
	return container.textContent || "";
}

function renderWikitext(wikitext, currentTiddler) {
	var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", wikitext);
	var variables = {};
	if (currentTiddler) {
		variables.currentTiddler = currentTiddler;
	}
	var widgetNode = $tw.wiki.makeWidget(parser, {
		document: $tw.fakeDocument,
		variables: variables
	});
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);
	return container.innerHTML || "";
}

function substituteVars(template, sourceTiddler) {
	if (!template) return "";
	return template.replace(/\$\(currentTiddler\)\$/g, sourceTiddler || "");
}

})();
