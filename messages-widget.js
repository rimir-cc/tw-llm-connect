/*\
title: $:/plugins/rimir/llm-connect/messages-widget
type: application/javascript
module-type: widget

<$llm-messages> widget — read-only display of a stored llm-messages field.

Attributes: tiddler (default currentTiddler), field (default "llm-messages"),
tool-display ("brief" | "details" | "none", default "brief"), class.

\*/
(function() {

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;
var messageRender = require("$:/plugins/rimir/llm-connect/message-render");

var EXPANDED = "llm-chat-tool-expanded";

function hasClass(el, cls) {
	return (" " + el.className + " ").indexOf(" " + cls + " ") !== -1;
}

var LlmMessagesWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

LlmMessagesWidget.prototype = new Widget();

LlmMessagesWidget.prototype.toolElements = function() {
	return Array.prototype.filter.call(this.container.children, function(c) {
		return hasClass(c, "llm-chat-message-tool");
	});
};

LlmMessagesWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();

	var div = this.document.createElement("div");
	div.className = "llm-chat-messages llm-chat-tools-" + this.toolDisplay + (this.extraClass ? " " + this.extraClass : "");
	this.container = div;

	var messages = this.getMessages();
	for (var i = 0; i < messages.length; i++) {
		var els = messageRender.renderMessage(this.document, messages[i]);
		for (var j = 0; els && j < els.length; j++) {
			div.appendChild(els[j]);
		}
	}
	messageRender.bindToolToggle(div);

	// Restore expanded tool messages (indices captured before a re-render)
	if (this.expandedIndices) {
		var tools = this.toolElements();
		this.expandedIndices.forEach(function(idx) {
			if (tools[idx]) tools[idx].className += " " + EXPANDED;
		});
		this.expandedIndices = null;
	}

	parent.insertBefore(div, nextSibling);
	this.domNodes.push(div);

	// Restore the scroll position captured before a re-render: stick to the bottom
	// when the user was there, else keep scrollTop
	if (this.scrollState) {
		div.scrollTop = this.scrollState.atBottom ? div.scrollHeight : this.scrollState.top;
		this.scrollState = null;
	}
};

LlmMessagesWidget.prototype.execute = function() {
	this.tiddlerTitle = this.getAttribute("tiddler", this.getVariable("currentTiddler"));
	this.fieldName = this.getAttribute("field", "llm-messages");
	var mode = this.getAttribute("tool-display", "brief");
	this.toolDisplay = (mode === "details" || mode === "none") ? mode : "brief";
	this.extraClass = this.getAttribute("class", "");
};

LlmMessagesWidget.prototype.getRaw = function() {
	var tiddler = this.tiddlerTitle && this.wiki.getTiddler(this.tiddlerTitle);
	return (tiddler && tiddler.fields[this.fieldName]) || "";
};

LlmMessagesWidget.prototype.getMessages = function() {
	var raw = this.getRaw();
	this.renderedRaw = raw;
	if (!raw) return [];
	try {
		var parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch(e) {
		return [];
	}
};

LlmMessagesWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	var attrsChanged = changedAttributes.tiddler || changedAttributes.field ||
		changedAttributes["tool-display"] || changedAttributes["class"];
	// A change to another field of the tiddler (e.g. a log write) leaves the display as is
	var contentChanged = this.tiddlerTitle && changedTiddlers[this.tiddlerTitle] &&
		this.getRaw() !== this.renderedRaw;
	if (attrsChanged || contentChanged) {
		var expanded = [];
		if (this.container) {
			this.toolElements().forEach(function(el, idx) {
				if (hasClass(el, EXPANDED)) expanded.push(idx);
			});
			var c = this.container;
			this.scrollState = {
				top: c.scrollTop || 0,
				atBottom: (c.scrollHeight || 0) - (c.scrollTop || 0) - (c.clientHeight || 0) <= 2
			};
		}
		this.expandedIndices = expanded;
		this.refreshSelf();
		return true;
	}
	return false;
};

exports["llm-messages"] = LlmMessagesWidget;

})();
