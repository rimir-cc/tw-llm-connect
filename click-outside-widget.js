/*\
title: $:/plugins/rimir/llm-connect/click-outside-widget
type: application/javascript
module-type: widget

<$click-outside> widget — sets a state tiddler when clicking outside its DOM subtree

\*/
(function() {

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

// One active handler per state tiddler — prevents duplicates from stale widget instances
var activeHandlers = {};

var ClickOutsideWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

ClickOutsideWidget.prototype = new Widget();

ClickOutsideWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	this._removeHandler();

	var wrapper = this.document.createElement("div");
	this.domWrapper = wrapper;
	this.renderChildren(wrapper, null);

	var self = this;

	if (this.stateTitle && this.document.addEventListener) {
		if (activeHandlers[this.stateTitle]) {
			activeHandlers[this.stateTitle]._removeHandler();
		}
		activeHandlers[this.stateTitle] = this;

		this._handler = function(e) {
			if (!self.domWrapper || !self.domWrapper.ownerDocument.contains(self.domWrapper)) {
				self._removeHandler();
				return;
			}
			if (self.domWrapper.contains(e.target)) {
				return;
			}
			self.wiki.setText(self.stateTitle, "text", null, self.closedValue);
		};
		// Defer so the opening click doesn't immediately close
		setTimeout(function() {
			if (activeHandlers[self.stateTitle] !== self) return;
			if (self.domWrapper && self.domWrapper.ownerDocument.contains(self.domWrapper)) {
				self.document.addEventListener("mousedown", self._handler, true);
			}
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

ClickOutsideWidget.prototype._removeHandler = function() {
	if (this._handler && this.document.removeEventListener) {
		this.document.removeEventListener("mousedown", this._handler, true);
		this._handler = null;
	}
	if (activeHandlers[this.stateTitle] === this) {
		delete activeHandlers[this.stateTitle];
	}
};

ClickOutsideWidget.prototype.removeChildDomNodes = function() {
	this._removeHandler();
	this.domWrapper = null;
	Widget.prototype.removeChildDomNodes.call(this);
};

exports["click-outside"] = ClickOutsideWidget;

})();
