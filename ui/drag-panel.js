/*\
title: $:/plugins/rimir/llm-connect/ui/drag-panel
type: application/javascript
module-type: startup

Makes the LLM chat panel draggable by its header

\*/
(function() {

"use strict";

exports.name = "llm-connect-drag-panel";
exports.platforms = ["browser"];
exports.after = ["render"];

exports.startup = function() {
	var isDragging = false;
	var offsetX = 0;
	var offsetY = 0;
	var panel = null;

	document.addEventListener("mousedown", function(e) {
		var header = e.target.closest(".llm-chat-panel-header");
		if (!header) return;
		// Don't drag when clicking interactive elements
		if (e.target.closest("button, input, label, select, textarea, .llm-tool-selector-dropdown")) return;

		panel = header.closest(".llm-chat-panel");
		if (!panel) return;

		isDragging = true;
		var rect = panel.getBoundingClientRect();
		offsetX = e.clientX - rect.left;
		offsetY = e.clientY - rect.top;

		// Switch from bottom/right positioning to top/left
		panel.style.left = rect.left + "px";
		panel.style.top = rect.top + "px";
		panel.style.right = "auto";
		panel.style.bottom = "auto";

		e.preventDefault();
	});

	document.addEventListener("mousemove", function(e) {
		if (!isDragging || !panel) return;

		var newLeft = e.clientX - offsetX;
		var newTop = e.clientY - offsetY;

		// Keep within viewport
		newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 100));
		newTop = Math.max(0, Math.min(newTop, window.innerHeight - 50));

		panel.style.left = newLeft + "px";
		panel.style.top = newTop + "px";

		e.preventDefault();
	});

	document.addEventListener("mouseup", function() {
		isDragging = false;
		panel = null;
	});
};

})();
