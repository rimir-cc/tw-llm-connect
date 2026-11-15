/*\
title: $:/plugins/rimir/llm-connect/ask-attention
type: application/javascript
module-type: startup

Getting the user's attention for pending ask_user questions: "(?) " tab-title marker,
keyboard focus moved into the modal, and an optional desktop notification when the tab
is hidden or unfocused. Notification permission is only requested from a user gesture
(message tm-rimir-llm-connect-ask-permission, sent by the settings' Test button and
Notifications checkbox).

\*/
(function() {

"use strict";

exports.name = "llm-connect-ask-attention";
exports.platforms = ["browser"];
exports.after = ["render"];

var ASK_PREFIX = "$:/temp/rimir/llm-connect/ask/";
var NOTIFY_CFG = "$:/config/rimir/llm-connect/ask-notify";
// Shared with ui/ask-overlay (via ui/ask-functions): pending questions, oldest first
var PENDING_FILTER_TIDDLER = "$:/plugins/rimir/llm-connect/ui/ask-pending-filter";
var PERMISSION_MESSAGE = "tm-rimir-llm-connect-ask-permission";
var MARKER = "(?) ";

function titleWithMarker(title, pending) {
	var bare = title.indexOf(MARKER) === 0 ? title.substr(MARKER.length) : title;
	return pending ? MARKER + bare : bare;
}

function shouldNotify(doc) {
	return !!doc.hidden || !doc.hasFocus();
}

/*
Move keyboard focus into the ask dialog (unless it is already there): first text field,
else first option/button, else the dialog itself (tabindex -1). Returns the focused element or null.
*/
function focusDialog(doc) {
	var dialog = doc.querySelector(".llm-ask-dialog");
	if(!dialog) {
		return null;
	}
	if(doc.activeElement && dialog.contains(doc.activeElement)) {
		return doc.activeElement;
	}
	var target = dialog.querySelector(".llm-ask-body textarea, .llm-ask-body input") ||
		dialog.querySelector(".llm-ask-body button") || dialog;
	target.focus();
	return target;
}

// Notification title (heading, else "<source> asks") and body (first prompt) for a question tiddler's fields
function notificationContent(fields) {
	var prompt = "";
	try {
		var questions = JSON.parse(fields.text || "[]");
		prompt = (questions && questions[0] && questions[0].prompt) || "";
	} catch(e) {}
	return {
		title: fields["ask.title"] || ((fields["ask.source-label"] || "LLM") + " asks"),
		body: prompt || "The LLM has a question for you"
	};
}

// Ask for notification permission (call from a user gesture only). True when a request was made.
function requestPermission(N) {
	if(N && N.permission === "default" && N.requestPermission) {
		N.requestPermission();
		return true;
	}
	return false;
}

exports.titleWithMarker = titleWithMarker;
exports.shouldNotify = shouldNotify;
exports.focusDialog = focusDialog;
exports.notificationContent = notificationContent;
exports.requestPermission = requestPermission;
exports.PERMISSION_MESSAGE = PERMISSION_MESSAGE;

/*
Build the wiki change listener. deps: { wiki, doc, notify(title), focus() (optional) }.
The pending filter only runs when the change set touches ASK_PREFIX; between such
changes the cached pending list drives re-applying the marker after TW's own title refresh.
focus() runs when a new question becomes the one shown (oldest pending).
*/
function createChangeListener(deps) {
	var pending = [];
	var notified = {};
	var shown = null;
	return function(changes) {
		var relevant = false;
		for(var t in changes) {
			if(t.indexOf(ASK_PREFIX) === 0) { relevant = true; break; }
		}
		if(relevant) {
			pending = deps.wiki.filterTiddlers((deps.wiki.getTiddlerText(PENDING_FILTER_TIDDLER) || "").trim());
			Object.keys(notified).forEach(function(k) {
				if(pending.indexOf(k) === -1) { delete notified[k]; }
			});
		}
		// Runs after the core title refresh (registered later): re-apply while pending
		var next = titleWithMarker(deps.doc.title, pending.length > 0);
		if(next !== deps.doc.title) {
			deps.doc.title = next;
		}
		if(relevant) {
			var oldest = pending[0] || null;
			if(oldest !== shown) {
				shown = oldest;
				// Runs after the page refresh, so the dialog for `oldest` is in the DOM
				if(oldest && deps.focus) { deps.focus(); }
			}
			pending.forEach(function(t) {
				if(!notified[t]) {
					notified[t] = true;
					deps.notify(t);
				}
			});
		}
	};
}

exports.createChangeListener = createChangeListener;

exports.startup = function() {
	function notify(title) {
		var enabled = ($tw.wiki.getTiddlerText(NOTIFY_CFG, "yes") || "").trim() === "yes";
		var tiddler = $tw.wiki.getTiddler(title);
		if(!enabled || !tiddler || typeof Notification === "undefined" || Notification.permission !== "granted" || !shouldNotify(document)) {
			return;
		}
		try {
			var content = notificationContent(tiddler.fields);
			var n = new Notification(content.title, { body: content.body });
			n.onclick = function() { window.focus(); n.close(); };
		} catch(e) {}
	}
	$tw.rootWidget.addEventListener(PERMISSION_MESSAGE, function() {
		requestPermission(typeof Notification === "undefined" ? null : Notification);
		return false;
	});
	$tw.wiki.addEventListener("change", createChangeListener({
		wiki: $tw.wiki,
		doc: document,
		notify: notify,
		focus: function() { focusDialog(document); }
	}));
};

})();
