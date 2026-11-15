/*\
title: $:/plugins/rimir/llm-connect/message-render
type: application/javascript
module-type: library

Shared message renderer — turns stored llm-messages entries into DOM elements.
Used by <$llm-chat> and <$llm-messages>.

\*/
(function() {

"use strict";

var TOOL_CALL_PREVIEW = 100;
var TOOL_RESULT_PREVIEW = 300;

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

/*
Tool message element with a preview span (cut text) and a full span (complete text).
CSS decides which one is visible.
*/
function createToolElement(doc, previewText, fullText) {
	var el = doc.createElement("div");
	el.className = "llm-chat-message llm-chat-message-tool";
	var preview = doc.createElement("span");
	preview.className = "llm-chat-tool-preview";
	preview.textContent = previewText;
	var full = doc.createElement("span");
	full.className = "llm-chat-tool-full";
	full.textContent = fullText;
	el.appendChild(preview);
	el.appendChild(full);
	return el;
}

/*
Tool call element: "🔧 name(args)" — preview with args cut to TOOL_CALL_PREVIEW chars,
full with the complete (pretty-printed) args.
*/
function createToolCallElement(doc, name, previewArgs, fullArgs) {
	if (previewArgs.length > TOOL_CALL_PREVIEW) previewArgs = previewArgs.substring(0, TOOL_CALL_PREVIEW) + "...";
	return createToolElement(doc,
		"\u{1F527} " + name + "(" + previewArgs + ")",
		"\u{1F527} " + name + "(" + fullArgs + ")");
}

/*
OpenAI-family tool call ({function: {name, arguments}}, arguments a JSON string):
full args pretty-printed when they parse, else the raw string.
*/
function createOpenAIToolCallElement(doc, call) {
	var fn = (call && call["function"]) || {};
	var args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {});
	var full = args;
	try {
		full = JSON.stringify(JSON.parse(args), null, 2);
	} catch(e) {}
	return createToolCallElement(doc, fn.name, args, full);
}

function createToolResultElement(doc, text) {
	var preview = text.length > TOOL_RESULT_PREVIEW ? text.substring(0, TOOL_RESULT_PREVIEW) + "..." : text;
	return createToolElement(doc, preview, text);
}

/*
Tool result content as text: a string as-is, an array of blocks as its joined text blocks
(other content as JSON).
*/
function toolResultText(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content) && content.every(function(b) { return b && b.type === "text" && typeof b.text === "string"; })) {
		return content.map(function(b) { return b.text; }).join("\n");
	}
	var json = JSON.stringify(content);
	return json === undefined ? "" : json;
}

function createMarkdownElement(doc, text) {
	var el = doc.createElement("div");
	el.className = "llm-chat-message llm-chat-message-assistant llm-chat-md";
	el.innerHTML = markdownToHtml(text);
	return el;
}

function renderContextMessage(doc, msg) {
	var userDiv = doc.createElement("div");
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
	return userDiv;
}

/*
Render one stored message to an array of DOM elements (possibly empty).
*/
function renderMessage(doc, msg) {
	var elements = [];

	// User message with tool_result content (Claude format)
	if (msg.role === "user" && Array.isArray(msg.content)) {
		for (var i = 0; i < msg.content.length; i++) {
			var block = msg.content[i];
			if (block.type === "tool_result") {
				elements.push(createToolResultElement(doc, toolResultText(block.content)));
			} else if (typeof block === "string") {
				var blockDiv = doc.createElement("div");
				blockDiv.className = "llm-chat-message llm-chat-message-user";
				blockDiv.textContent = block;
				elements.push(blockDiv);
			}
		}
		return elements;
	}

	// Plain user message
	if (msg.role === "user") {
		if (msg._context) {
			elements.push(renderContextMessage(doc, msg));
		} else {
			var userDiv = doc.createElement("div");
			userDiv.className = "llm-chat-message llm-chat-message-user";
			userDiv.textContent = typeof msg.content === "string" ? msg.content : "";
			elements.push(userDiv);
		}
		return elements;
	}

	// Assistant message — may contain text + tool_use blocks (Claude) or tool_calls (OpenAI)
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
						elements.push(createMarkdownElement(doc, textParts.join("\n")));
						textParts = [];
					}
					var input = aBlock.input || {};
					elements.push(createToolCallElement(doc, aBlock.name,
						JSON.stringify(input), JSON.stringify(input, null, 2)));
				}
			}
			if (textParts.length > 0) {
				elements.push(createMarkdownElement(doc, textParts.join("\n")));
			}
		} else if (typeof msg.content === "string" && msg.content) {
			elements.push(createMarkdownElement(doc, msg.content));
		}
		// OpenAI/Azure tool calls (content may be null)
		if (Array.isArray(msg.tool_calls)) {
			for (var k = 0; k < msg.tool_calls.length; k++) {
				elements.push(createOpenAIToolCallElement(doc, msg.tool_calls[k]));
			}
		}
		return elements;
	}

	// OpenAI tool result
	if (msg.role === "tool") {
		elements.push(createToolResultElement(doc, toolResultText(msg.content)));
	}

	return elements;
}

/*
Click-to-toggle individual tool messages (delegated, attached once per container).
*/
function bindToolToggle(container) {
	if (container._toolClickBound) return;
	container.addEventListener("click", function(e) {
		var el = e.target.closest(".llm-chat-message-tool");
		if (el) el.classList.toggle("llm-chat-tool-expanded");
	});
	container._toolClickBound = true;
}

exports.markdownToHtml = markdownToHtml;
exports.renderMessage = renderMessage;
exports.bindToolToggle = bindToolToggle;

})();
