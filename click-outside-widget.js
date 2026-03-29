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

	// Clean up any previous handler before re-registering
	this._removeHandler();

	var wrapper = this.document.createElement("div");
	this.domWrapper = wrapper;
	this.renderChildren(wrapper, null);

	var self = this;

	if (this.stateTitle && this.document.addEventListener) {
		this._handler = function(e) {
			// If wrapper is no longer in the document, clean up and bail
			if (!self.domWrapper || !self.domWrapper.ownerDocument.contains(self.domWrapper)) {
				self._removeHandler();
				return;
			}
			// If click is inside our wrapper, ignore
			if (self.domWrapper.contains(e.target)) {
				return;
			}
			// Also ignore if click is on the toggle button that opens this dropdown
			// (the button is a sibling, not inside wrapper — let the button's own toggle handle it)
			var btn = e.target.closest && e.target.closest(".llm-tool-selector-btn");
			if (btn) {
				return;
			}
			self.wiki.setText(self.stateTitle, "text", null, self.closedValue);
		};
		// Defer so the opening click doesn't immediately close
		setTimeout(function() {
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
};

ClickOutsideWidget.prototype.removeChildDomNodes = function() {
	this._removeHandler();
	this.domWrapper = null;
	Widget.prototype.removeChildDomNodes.call(this);
};

exports["click-outside"] = ClickOutsideWidget;

})();
