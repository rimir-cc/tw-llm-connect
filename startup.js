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
		"adapter-openai-base", "widget-helpers"
	];
	var types = require("$:/plugins/rimir/llm-connect/connection-types").listTypes();
	for (var t = 0; t < types.length; t++) {
		modules.push("adapter-" + types[t].type);
	}
	for (var i = 0; i < modules.length; i++) {
		try {
			require("$:/plugins/rimir/llm-connect/" + modules[i]);
		} catch(e) {
			console.error("llm-connect: Failed to load " + modules[i] + ":", e);
		}
	}

	// Handle tm-llm-fetch-models message
	$tw.rootWidget.addEventListener("tm-llm-fetch-models", function(event) {
		var p = event.paramObject || {};
		var connections = require("$:/plugins/rimir/llm-connect/connections");
		var id = p.connection || (p.provider && connections.resolveConnectionId(p.provider));
		if (!id) return;
		var orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");
		var statusTiddler = "$:/temp/rimir/llm-connect/fetch-status/" + id;
		$tw.wiki.setText(statusTiddler, "text", null, "Fetching...");
		orchestrator.fetchModels(id).then(function(models) {
			$tw.wiki.setText(statusTiddler, "text", null, models.length + " models loaded");
		})["catch"](function(err) {
			$tw.wiki.setText(statusTiddler, "text", null, "Error: " + err.message);
		});
	});
};

})();
