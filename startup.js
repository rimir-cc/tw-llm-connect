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
	try {
		require("$:/plugins/rimir/llm-connect/orchestrator");
		require("$:/plugins/rimir/llm-connect/tool-executor");
		require("$:/plugins/rimir/llm-connect/context-resolver");
		require("$:/plugins/rimir/llm-connect/adapter-claude");
		require("$:/plugins/rimir/llm-connect/adapter-openai");
		require("$:/plugins/rimir/llm-connect/adapter-azure");
	} catch(e) {
		console.error("llm-connect: Failed to load modules:", e);
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
