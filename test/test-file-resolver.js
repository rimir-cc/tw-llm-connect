/*\
title: $:/plugins/rimir/llm-connect/test/test-file-resolver.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for llm-connect file-resolver: detectFile, classifyTitles, isSupported, isExtractable, getExtractedText.

\*/
"use strict";

describe("llm-connect: file-resolver", function() {

	var fileResolver = require("$:/plugins/rimir/llm-connect/file-resolver");

	var addedTitles;
	beforeEach(function() {
		addedTitles = [];
	});
	afterEach(function() {
		for (var i = 0; i < addedTitles.length; i++) {
			$tw.wiki.deleteTiddler(addedTitles[i]);
		}
	});

	function addTiddler(title, fields) {
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.utils.extend({ title: title }, fields)));
		addedTitles.push(title);
	}

	describe("isSupported", function() {
		it("should recognize image types", function() {
			expect(fileResolver.isSupported("image/jpeg")).toBe(true);
			expect(fileResolver.isSupported("image/png")).toBe(true);
			expect(fileResolver.isSupported("image/gif")).toBe(true);
			expect(fileResolver.isSupported("image/webp")).toBe(true);
		});

		it("should recognize document types", function() {
			expect(fileResolver.isSupported("application/pdf")).toBe(true);
			expect(fileResolver.isSupported("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
			expect(fileResolver.isSupported("application/msword")).toBe(true);
		});

		it("should reject unsupported types", function() {
			expect(fileResolver.isSupported("text/plain")).toBe(false);
			expect(fileResolver.isSupported("application/zip")).toBe(false);
			expect(fileResolver.isSupported("video/mp4")).toBe(false);
			expect(fileResolver.isSupported("")).toBe(false);
		});
	});

	describe("isExtractable", function() {
		it("should recognize extractable types", function() {
			expect(fileResolver.isExtractable("application/pdf")).toBe(true);
			expect(fileResolver.isExtractable("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
			expect(fileResolver.isExtractable("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
		});

		it("should reject non-extractable types", function() {
			expect(fileResolver.isExtractable("image/jpeg")).toBe(false);
			expect(fileResolver.isExtractable("application/msword")).toBe(false);
			expect(fileResolver.isExtractable("text/plain")).toBe(false);
		});
	});

	describe("detectFile", function() {
		it("should return null for non-existent tiddler", function() {
			expect(fileResolver.detectFile("$:/nonexistent-xyz")).toBeNull();
		});

		it("should return null for tiddler without _canonical_uri", function() {
			addTiddler("$:/test/no-uri", { text: "just text" });
			expect(fileResolver.detectFile("$:/test/no-uri")).toBeNull();
		});

		it("should detect image file by type field", function() {
			addTiddler("$:/test/photo", {
				type: "image/jpeg",
				_canonical_uri: "/files/photo.jpg"
			});
			var result = fileResolver.detectFile("$:/test/photo");
			expect(result).not.toBeNull();
			expect(result.category).toBe("image");
			expect(result.mediaType).toBe("image/jpeg");
			expect(result.uri).toBe("/files/photo.jpg");
			expect(result.filename).toBe("photo.jpg");
			expect(result.title).toBe("$:/test/photo");
		});

		it("should detect document file by type field", function() {
			addTiddler("$:/test/doc", {
				type: "application/pdf",
				_canonical_uri: "/files/doc.pdf"
			});
			var result = fileResolver.detectFile("$:/test/doc");
			expect(result.category).toBe("document");
			expect(result.mediaType).toBe("application/pdf");
		});

		it("should infer media type from URI extension when type is missing", function() {
			addTiddler("$:/test/inferred-png", {
				_canonical_uri: "/files/image.png"
			});
			var result = fileResolver.detectFile("$:/test/inferred-png");
			expect(result).not.toBeNull();
			expect(result.mediaType).toBe("image/png");
			expect(result.category).toBe("image");
		});

		it("should infer various extensions", function() {
			var tests = [
				[".jpg", "image/jpeg"],
				[".jpeg", "image/jpeg"],
				[".gif", "image/gif"],
				[".webp", "image/webp"],
				[".pdf", "application/pdf"],
				[".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
				[".doc", "application/msword"],
				[".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
				[".xls", "application/vnd.ms-excel"],
				[".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
				[".ppt", "application/vnd.ms-powerpoint"]
			];
			for (var i = 0; i < tests.length; i++) {
				var ext = tests[i][0];
				var expected = tests[i][1];
				addTiddler("$:/test/ext-" + i, { _canonical_uri: "/files/test" + ext });
				var result = fileResolver.detectFile("$:/test/ext-" + i);
				expect(result).not.toBeNull();
				expect(result.mediaType).toBe(expected);
			}
		});

		it("should return null when URI has no recognized extension and no type", function() {
			addTiddler("$:/test/unknown-ext", {
				_canonical_uri: "/files/data.xyz"
			});
			expect(fileResolver.detectFile("$:/test/unknown-ext")).toBeNull();
		});

		it("should mark unsupported media types", function() {
			addTiddler("$:/test/pptx", {
				type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
				_canonical_uri: "/files/slides.pptx"
			});
			var result = fileResolver.detectFile("$:/test/pptx");
			expect(result.category).toBe("unsupported");
		});

		it("should extract filename from URI path", function() {
			addTiddler("$:/test/deep-path", {
				type: "image/png",
				_canonical_uri: "/files/subdir/deep/image.png"
			});
			var result = fileResolver.detectFile("$:/test/deep-path");
			expect(result.filename).toBe("image.png");
		});
	});

	describe("classifyTitles", function() {
		it("should separate file tiddlers from text tiddlers", function() {
			addTiddler("$:/test/text-tid", { text: "plain text" });
			addTiddler("$:/test/image-tid", {
				type: "image/png",
				_canonical_uri: "/files/img.png"
			});
			var result = fileResolver.classifyTitles(["$:/test/text-tid", "$:/test/image-tid"]);
			expect(result.textTitles.length).toBe(1);
			expect(result.textTitles[0]).toBe("$:/test/text-tid");
			expect(result.fileParts.length).toBe(1);
			expect(result.fileParts[0].title).toBe("$:/test/image-tid");
		});

		it("should handle empty array", function() {
			var result = fileResolver.classifyTitles([]);
			expect(result.textTitles.length).toBe(0);
			expect(result.fileParts.length).toBe(0);
		});

		it("should handle all-text tiddlers", function() {
			addTiddler("$:/test/t1", { text: "a" });
			addTiddler("$:/test/t2", { text: "b" });
			var result = fileResolver.classifyTitles(["$:/test/t1", "$:/test/t2"]);
			expect(result.textTitles.length).toBe(2);
			expect(result.fileParts.length).toBe(0);
		});

		it("should handle all-file tiddlers", function() {
			addTiddler("$:/test/f1", { type: "image/jpeg", _canonical_uri: "/files/a.jpg" });
			addTiddler("$:/test/f2", { type: "application/pdf", _canonical_uri: "/files/b.pdf" });
			var result = fileResolver.classifyTitles(["$:/test/f1", "$:/test/f2"]);
			expect(result.textTitles.length).toBe(0);
			expect(result.fileParts.length).toBe(2);
		});

		it("should put non-existent titles in textTitles", function() {
			var result = fileResolver.classifyTitles(["$:/nonexistent-xyz"]);
			expect(result.textTitles.length).toBe(1);
			expect(result.fileParts.length).toBe(0);
		});
	});

	describe("getExtractedText", function() {
		it("should return cached extraction text", function() {
			addTiddler("MyDoc.extracted", { text: "Extracted markdown content" });
			var result = fileResolver.getExtractedText("MyDoc");
			expect(result).toBe("Extracted markdown content");
		});

		it("should return null when no cache exists", function() {
			expect(fileResolver.getExtractedText("$:/nonexistent-xyz")).toBeNull();
		});

		it("should return null when cache tiddler has empty text", function() {
			addTiddler("EmptyDoc.extracted", { text: "" });
			expect(fileResolver.getExtractedText("EmptyDoc")).toBeNull();
		});
	});
});
