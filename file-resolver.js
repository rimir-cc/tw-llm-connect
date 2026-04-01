/*\
title: $:/plugins/rimir/llm-connect/file-resolver
type: application/javascript
module-type: library

File detection, fetching, and base64 encoding for multimodal context

\*/
(function() {

"use strict";

var SUPPORTED_MEDIA = {
	"image/jpeg": "image",
	"image/png": "image",
	"image/gif": "image",
	"image/webp": "image",
	"application/pdf": "document",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
	"application/msword": "document",
	"application/vnd.ms-excel": "document"
};

// Document types that can be extracted to markdown text via runner
var EXTRACTABLE_TYPES = {
	"application/pdf": "extract-pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "extract-docx",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "extract-xlsx"
};

var EXT_TO_MEDIA = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".pdf": "application/pdf",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xls": "application/vnd.ms-excel",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".ppt": "application/vnd.ms-powerpoint",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".doc": "application/msword"
};

/*
Detect whether a tiddler references a binary file via _canonical_uri.
Returns null if not a file tiddler, or:
{ category: "image"|"document"|"unsupported", mediaType: "image/png", uri: "/files/...", filename: "...", title: "..." }
*/
exports.detectFile = function(title) {
	var tiddler = $tw.wiki.getTiddler(title);
	if (!tiddler) return null;
	var uri = tiddler.fields._canonical_uri;
	if (!uri) return null;

	var mediaType = tiddler.fields.type || inferMediaType(uri);
	if (!mediaType) return null;

	var category = SUPPORTED_MEDIA[mediaType] || "unsupported";
	var filename = uri.split("/").pop() || title;

	return {
		title: title,
		uri: uri,
		mediaType: mediaType,
		category: category,
		filename: filename
	};
};

/*
Fetch a file from the server and return base64-encoded data.
Returns Promise<{ base64: string, mediaType: string, category: string, filename: string, title: string }>
*/
exports.fetchAsBase64 = function(fileInfo) {
	return new Promise(function(resolve, reject) {
		var maxSize = parseInt($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/max-file-size")) || 20971520;
		var xhr = new XMLHttpRequest();
		xhr.open("GET", fileInfo.uri, true);
		xhr.responseType = "arraybuffer";
		xhr.onload = function() {
			if (xhr.status >= 200 && xhr.status < 300) {
				var buffer = xhr.response;
				if (buffer.byteLength > maxSize) {
					reject(new Error("File too large: " + fileInfo.filename + " (" + Math.round(buffer.byteLength / 1048576) + "MB, max " + Math.round(maxSize / 1048576) + "MB)"));
					return;
				}
				var base64 = arrayBufferToBase64(buffer);
				resolve({
					base64: base64,
					mediaType: fileInfo.mediaType,
					category: fileInfo.category,
					filename: fileInfo.filename,
					title: fileInfo.title
				});
			} else {
				reject(new Error("Failed to fetch file: " + fileInfo.uri + " (HTTP " + xhr.status + ")"));
			}
		};
		xhr.onerror = function() {
			reject(new Error("Network error fetching: " + fileInfo.uri));
		};
		xhr.send();
	});
};

/*
Classify a list of tiddler titles into text parts and file parts.
Returns { textTitles: string[], fileParts: fileInfo[] }
*/
exports.classifyTitles = function(titles) {
	var textTitles = [];
	var fileParts = [];
	for (var i = 0; i < titles.length; i++) {
		var fileInfo = exports.detectFile(titles[i]);
		if (fileInfo) {
			fileParts.push(fileInfo);
		} else {
			textTitles.push(titles[i]);
		}
	}
	return { textTitles: textTitles, fileParts: fileParts };
};

/*
Check if a media type is natively supported by LLM APIs.
*/
exports.isSupported = function(mediaType) {
	return !!SUPPORTED_MEDIA[mediaType];
};

/*
Check if a media type can be extracted to text via runner.
*/
exports.isExtractable = function(mediaType) {
	return !!EXTRACTABLE_TYPES[mediaType];
};

/*
Get cached extracted text for a tiddler title.
Returns the text string or null if no cache exists.
*/
exports.getExtractedText = function(title) {
	var cacheTitle = title + ".extracted";
	var tiddler = $tw.wiki.getTiddler(cacheTitle);
	if (!tiddler) return null;
	return tiddler.fields.text || null;
};

/*
Extract document text via the server-side extraction route and cache the result.
The route handles download, temp file management, and pandoc/python execution.
fileInfo: { title, uri, mediaType, filename }
Returns Promise<string> with extracted markdown text.
*/
exports.extractDocument = function(fileInfo) {
	if (!EXTRACTABLE_TYPES[fileInfo.mediaType]) {
		return Promise.reject(new Error("Unsupported type for extraction: " + fileInfo.mediaType));
	}

	var maxOutput = parseInt($tw.wiki.getTiddlerText("$:/config/rimir/llm-connect/max-extraction-size")) || 500000;

	return new Promise(function(resolve, reject) {
		var xhr = new XMLHttpRequest();
		var url = "/api/extract?uri=" + encodeURIComponent(fileInfo.uri);
		xhr.open("GET", url, true);
		xhr.onload = function() {
			if (xhr.status >= 200 && xhr.status < 300) {
				var result;
				try { result = JSON.parse(xhr.responseText); } catch(e) {
					reject(new Error("Invalid extraction response"));
					return;
				}
				if (result.status === "ok" && result.output) {
					var text = result.output;
					if (text.length > maxOutput) {
						text = text.substring(0, maxOutput) + "\n\n... [extraction truncated at " + maxOutput + " chars]";
					}
					// Cache the extraction as a tiddler
					var cacheTitle = fileInfo.title + ".extracted";
					$tw.wiki.addTiddler(new $tw.Tiddler({
						title: cacheTitle,
						text: text,
						type: "text/x-markdown",
						"extraction-source": fileInfo.title,
						"extraction-date": new Date().toISOString(),
						"extraction-media-type": fileInfo.mediaType
					}));
					resolve(text);
				} else {
					reject(new Error("Extraction failed: " + (result.error || result.output || "unknown error")));
				}
			} else {
				reject(new Error("Extraction request failed: HTTP " + xhr.status));
			}
		};
		xhr.onerror = function() { reject(new Error("Network error calling extraction route")); };
		xhr.send();
	});
};

function inferMediaType(uri) {
	var lower = uri.toLowerCase();
	var keys = Object.keys(EXT_TO_MEDIA);
	for (var i = 0; i < keys.length; i++) {
		if (lower.endsWith(keys[i])) {
			return EXT_TO_MEDIA[keys[i]];
		}
	}
	return null;
}

function arrayBufferToBase64(buffer) {
	var bytes = new Uint8Array(buffer);
	var chunks = [];
	var chunkSize = 8192;
	for (var i = 0; i < bytes.length; i += chunkSize) {
		var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
		chunks.push(String.fromCharCode.apply(null, chunk));
	}
	return btoa(chunks.join(""));
}

})();
