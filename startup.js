/*\
title: $:/plugins/rimir/llm-connect/startup
type: application/javascript
module-type: startup

Browser startup — initialize provider and verify configuration

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
	} catch(e) {
		console.error("llm-connect: Failed to load modules:", e);
	}
};

})();
