/*\
title: $:/plugins/jlazarow/pdfserve/syncer.js
type: application/javascript
module-type: library

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var REBUILD = true;
var DEBUG = true;
    
var PDF_FIELD_NAME = "pdf";    
var FILTER_WITH_PDF = "[!has[draft.of]has[" + PDF_FIELD_NAME + "]]";
var JSON_EXTENSION = "json";
var HIDDEN_TITLE_PREFIX = "$:/pdf/";    

var fs = null;
var path = null;    
var hummuspdf = null;

if ($tw.node) {
    fs = require("fs");
    path = require("path");
    hummuspdf = require("$:/plugins/jlazarow/pdfserve/hummus-pdf.js");
}

function PDFSyncer(wiki, debug) {
    this.wiki = wiki;
    this.debug = debug || false;
    this.root = null;

    if ($tw.node) {
        this.root = path.resolve($tw.boot.wikiPath, $tw.config.wikiDocumentsSubDir);
        if (this.debug) {
            console.log("looking for PDFs at location " + this.root);
        }
    }
}
    
PDFSyncer.prototype.syncTiddlers = function() {
    console.log("PDFSyncer: starting synchronization of store");
    
    // find those Tiddlers with a "pdf" associated.
    var matchingTitles = this.wiki.filterTiddlers(FILTER_WITH_PDF);
    console.log("found " + matchingTitles.length + " tiddlers with associated PDFs");
    
    for (var matchingIndex = 0; matchingIndex < matchingTitles.length; matchingIndex++) {
        var matchingTitle = matchingTitles[matchingIndex];
        var matchingTiddler = this.wiki.getTiddler(matchingTitle);

        this.syncTiddler(matchingTiddler);
    }
}

    // var ext = path.extname(filepath),
    //     extensionInfo = $tw.utils.getFileExtensionInfo(ext),
    //     type = extensionInfo ? extensionInfo.type : null,
    //     typeInfo = type ? $tw.config.contentTypeInfo[type] : null;

    // var caption = document.metadata.title;
    // if (caption != null && caption !== undefined) {
    //     caption = caption + " (PDF)"; // just to be safe.
    // }
    
    // var viewTiddler = {
    //     "title": HIDDEN_title,
    //     "caption": caption,
    //     "author": document.metadata.author || "",
    //     "subject": document.metadata.subject || "",
    //     "tags": "pdf " + (document.metadata.keywords || ""),
    //     "created": $tw.fixupPDFDateStrings(document.metadata.created),
    //     "modified": $tw.fixupPDFDateStrings(document.metadata.modified),
    //     "filename": path.basename(filepath),
    //     "type": "application/pdf",
    //     "text": $tw.generateDocumentText(filepath, document),
    // };

PDFSyncer.prototype.createMetadata = function(document, title) {
    var data = {
        "title": document.metadata.title || "",
        "author": document.metadata.author || "",
        "subject": document.metadata.subject || "",
        "keywords": document.metadata.keywords || "",
    }

    var pagesData = [];
    for (var pageIndex = 0; pageIndex < document.numberPages; pageIndex++) {
        var page = document.pages[pageIndex];
        if (!page.hasRead) {
            page.read();
        }

        var xobjectData = {};
        if (page.resources.xobject != null) {
            var xobject = page.resources.xobject;
            xobjectData["images"]  = Object.keys(xobject.images);
            xobjectData["forms"] = Object.keys(xobject.embedded);
        }

        pagesData.push({
            "index": pageIndex,
            "xobject": xobjectData
        })
    }

    data["pages"] = pagesData;

    // turning off tags, they cause a drop in TW performance.
    return {
        "title": title,
        "type": "application/json",
        "text": JSON.stringify(data, null, 2),
        "retrieved": Date.now()
    };
}
    
PDFSyncer.prototype.addMetadataTiddler = function(document) {
    var filepath = path.resolve(this.root, name);
    if (this.debug) {
        console.log("adding metadata tiddler for " + name);
    }
    
    var document = new hummuspdf.PDFDocument(filepath, this.debug);
    
    var metadataTitle = HIDDEN_TITLE_PREFIX + name;
    var dataTiddler = new $tw.Tiddler(this.createMetadata(document, metadataTitle));
    $tw.wiki.addTiddler(dataTiddler);

    document.close();
    
    return dataTiddler;
}

PDFSyncer.prototype.syncTiddler = function(tiddler) {
    // create "data tiddlers" (JSON) to serialize a PDF data instance.
    var tiddlerTitle = tiddler.fields["title"];
    var pdfName = tiddler.fields[PDF_FIELD_NAME];
    console.log("syncing PDF: " + pdfName + " of tiddler: " + tiddlerTitle);

    // check if we already have data for this.
    // assume not for now.
    var metadataTitle = HIDDEN_TITLE_PREFIX + pdfName;
    var dataTiddler = $tw.wiki.getTiddler(metadataTitle);
    
    if (!dataTiddler) {
        console.log("failed to find " + metadataTitle);
        dataTiddler = this.addMetadataTiddler(pdfName);
    }

    return dataTiddler;
}

exports.PDFSyncer = PDFSyncer;
    
})();
