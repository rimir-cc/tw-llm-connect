/*\
title: $:/plugins/rimir/llm-connect/startup
type: application/javascript
module-type: startup

Browser startup — initialize provider, verify configuration, register message handlers

\*/
(function() {

"use strict";

exports.name = "llm-connect-startup";
exports.platforms = ["browser"];
exports.after = ["startup"];

exports.startup = function() {
	// Verify modules are loadable
	var modules = [
		"orchestrator", "tool-executor", "context-resolver",
		"adapter-claude", "adapter-openai-base", "adapter-openai",
		"adapter-azure", "widget-helpers"
	];
	for (var i = 0; i < modules.length; i++) {
		try {
			require("$:/plugins/rimir/llm-connect/" + modules[i]);
		} catch(e) {
			console.error("llm-connect: Failed to load " + modules[i] + ":", e);
		}
	}

	// Handle tm-llm-fetch-models message
	$tw.rootWidget.addEventListener("tm-llm-fetch-models", function(event) {
		var provider = event.paramObject && event.paramObject.provider;
		if (!provider) return;
		var orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");
		var statusTiddler = "$:/temp/rimir/llm-connect/fetch-status/" + provider;
		$tw.wiki.setText(statusTiddler, "text", null, "Fetching...");
		orchestrator.fetchModels(provider).then(function(models) {
			$tw.wiki.setText(statusTiddler, "text", null, models.length + " models loaded");
		})["catch"](function(err) {
			$tw.wiki.setText(statusTiddler, "text", null, "Error: " + err.message);
		});
	});
};

})();
