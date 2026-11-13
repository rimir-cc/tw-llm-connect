/*\
title: $:/plugins/rimir/llm-connect/connection-types
type: application/javascript
module-type: library

Connection-type registry: data-driven list of provider types (shadow or user tiddlers).

\*/
(function() {

"use strict";

var TAG = "$:/tags/rimir/llm-connect/connection-type";

function readType(title) {
	var t = $tw.wiki.getTiddler(title);
	if(!t || !t.fields["connection-type"]) return null;
	return {
		type: t.fields["connection-type"],
		caption: t.fields.caption || t.fields["connection-type"],
		fields: $tw.utils.parseStringArray(t.fields["connection-fields"] || "") || [],
		required: t.fields["required-field"] || ""
	};
}

exports.listTypes = function() {
	var titles = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + TAG + "]]");
	var out = [];
	for(var i = 0; i < titles.length; i++) {
		var entry = readType(titles[i]);
		if(entry) out.push(entry);
	}
	out.sort(function(a, b) { return a.caption.localeCompare(b.caption); });
	return out;
};

exports.getType = function(type) {
	var all = exports.listTypes();
	for(var i = 0; i < all.length; i++) {
		if(all[i].type === type) return all[i];
	}
	return null;
};

})();
