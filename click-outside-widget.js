/*\
title: $:/plugins/rimir/llm-connect/click-outside-widget
type: application/javascript
module-type: widget

<$click-outside> widget — sets a state tiddler when clicking outside its DOM subtree

\*/
(function() {

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var ClickOutsideWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

ClickOutsideWidget.prototype = new Widget();

ClickOutsideWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();

	var wrapper = this.document.createElement("div");
	this.renderChildren(wrapper, null);

	var self = this;

	if (this.stateTitle && this.document.addEventListener) {
		this._handler = function(e) {
			// Walk up from click target to see if it's inside any tool-selector-wrapper
			var node = e.target;
			while (node && node !== self.document) {
				if (node.classList && node.classList.contains("llm-tool-selector-wrapper")) {
					return;
				}
				node = node.parentNode;
			}
			self.wiki.setText(self.stateTitle, "text", null, self.closedValue);
		};
		// Defer so the opening click doesn't immediately close
		setTimeout(function() {
			self.document.addEventListener("mousedown", self._handler, true);
		}, 0);
	}

	parent.insertBefore(wrapper, nextSibling);
	this.domNodes.push(wrapper);
};

ClickOutsideWidget.prototype.execute = function() {
	this.stateTitle = this.getAttribute("state", "");
	this.closedValue = this.getAttribute("closedValue", "closed");
	this.makeChildWidgets();
};

ClickOutsideWidget.prototype.refresh = function(changedTiddlers) {
	return this.refreshChildren(changedTiddlers);
};

ClickOutsideWidget.prototype.removeChildDomNodes = function() {
	if (this._handler && this.document.removeEventListener) {
		this.document.removeEventListener("mousedown", this._handler, true);
	}
	Widget.prototype.removeChildDomNodes.call(this);
};

exports["click-outside"] = ClickOutsideWidget;

})();
