/*\
title: $:/plugins/jlazarow/pdfserve/syncer.js
type: application/javascript
module-type: library

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var REBUILD = false;
var DEBUG = true;
    
var PDF_FIELD_NAME = "pdf";    
var FILTER_WITH_PDF = "[!has[draft.of]has[" + PDF_FIELD_NAME + "]]";
var JSON_EXTENSION = "json";
var HIDDEN_TITLE_PREFIX = "$:/pdf/";    

var fs = null;
var path = null;    
var hummuspdf = null;
var pdfapi;
var Jimp = null;
    
if ($tw.node) {
    fs = require("fs");
    path = require("path");
    hummuspdf = require("$:/plugins/jlazarow/pdfserve/hummus-pdf.js");
    pdfapi = require("$:/plugins/jlazarow/pdfserve/pdfapi.js");
    Jimp = require("jimp");
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

    var syncPromises = [];
    for (var matchingIndex = 0; matchingIndex < matchingTitles.length; matchingIndex++) {
        var matchingTitle = matchingTitles[matchingIndex];
        var matchingTiddler = this.wiki.getTiddler(matchingTitle);

        syncPromises.push(this.syncTiddler(matchingTiddler));
    }

    return Promise.all(syncPromises);
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

PDFSyncer.MAX_THUMBNAIL_HEIGHT = 128;

PDFSyncer.prototype.createMetadata = function(document, title) {
    // "true" metadata, store in the main tiddler.
    var metadata = {
        "title": document.metadata.title || "",
        "author": document.metadata.author || "",
        "subject": document.metadata.subject || "",
        "keywords": document.metadata.keywords || "",
        "pages": document.numberPages
    }

    var metadataTiddlers = [];
    // Add a tiddler at $:/pdf/blah.pdf/outline.
    if (document.catalog.hasOutline) {
        var outlineData = document.catalog.outline.toJSON();
        var outlineTiddler = {
            "title": title + "/" + "outline",
            "type": "application/json",
            "tags": [title],
            "text": JSON.stringify(outlineData, null, 2),
            "retrieved": Date.now()
        }

        metadataTiddlers.push(outlineTiddler);
    } else {
        console.log("no outline!");
    }

    var allPromises = [];
    var pagesData = [];
    for (var pageIndex = 0; pageIndex < document.numberPages; pageIndex++) {
        var page = document.pages[pageIndex];
        if (!page.hasRead) {
            page.read();
        }

        var objectData = {};
        if (page.resources.xobject != null) {
            var xobject = page.resources.xobject;
            objectData["images"]  = Object.keys(xobject.images);
            objectData["forms"] = Object.keys(xobject.embedded);
        }

        // also include what names are actually referenced on the page.
        var referencedNames = page.parser.tokenizeFigures();
        objectData["referenced"] = referencedNames;

        // this will be really exciting.
        console.log("generating thumbnails for: ");
        console.log(referencedNames);
        var pagePromises = [];
        for (var referencedNameIndex = 0; referencedNameIndex < referencedNames.length; referencedNameIndex++) {
            let referencedName = referencedNames[referencedNameIndex];

            // try to read this image and generate a thumbnail.
            pagePromises.push(pdfapi.PDF.getResource(document, pageIndex, referencedName).then(function(data) {
                // call Jimp.
                return Jimp.read(data).then(function(image) {
                    return new Promise((resolve, reject) => {
                        let currentHeight = image.bitmap.height;
                        var resizedImage = image;
                        
                        if (currentHeight > PDFSyncer.MAX_THUMBNAIL_HEIGHT) {
                            resizedImage = resizedImage.resize(PDFSyncer.MAX_THUMBNAIL_HEIGHT, Jimp.AUTO);
                        }
                        else {
                            ; // already pretty small, ignore.
                        }
                        
                        resizedImage.getBase64(Jimp.MIME_PNG, (err, src)  => {
                            resolve({
                                "key": referencedName,
                                "value": src
                            });
                        });
                    });
                }).catch(function(err) {
                    console.log("thumbnail error: " + referencedName);
                    console.log(err);
                });
            }));
        }

        let pageData = {
            "index": pageIndex,
            "object": objectData,
        }        

        metadataTiddlers.push({
            "title": title + "/" + "page" + "/" + pageIndex,
            "type": "application/json",
            "tags": [title],
            "text": JSON.stringify(pageData, null, 2),
            "retrieved": Date.now()            
        });

        allPromises.push(Promise.all(pagePromises));
    }
        
    // turning off tags, they cause a drop in TW performance.
    return Promise.all(allPromises).then(function(thumbnailsPerPage) {
        for (let pageIndex = 0; pageIndex < document.numberPages; pageIndex++) {
            let thumbnails = thumbnailsPerPage[pageIndex];
            let thumbnailData = {};
            for (let thumbnailIndex = 0; thumbnailIndex < thumbnails.length; thumbnailIndex++) {
                let thumbnail = thumbnails[thumbnailIndex];
                thumbnailData[thumbnail.key] = thumbnail.value;
            }
            
            // add the tiddler.
            metadataTiddlers.push({
                "title": title + "/" + "page" + "/" + pageIndex + "/" + "thumbnails",
                "type": "application/json",
                "tags": [title + "/" + "page" + "/" + pageIndex],
                "text": JSON.stringify(thumbnailData, null, 2),
                "retrieved": Date.now()            
            });
        }

        metadataTiddlers.splice(0, 0, {
            "title": title,
            "type": "application/json",
            "text": JSON.stringify(metadata, null, 2),
            "retrieved": Date.now()
        });

        return metadataTiddlers;
    });
}
    
PDFSyncer.prototype.addMetadataTiddler = function(name) {
    var filepath = path.resolve(this.root, name);
    if (this.debug) {
        console.log("adding metadata tiddler for " + name);
    }
    
    var document = new hummuspdf.PDFDocument(filepath, this.debug);
    
    var metadataTitle = HIDDEN_TITLE_PREFIX + name;
    var metadataTiddlers = [];
    this.createMetadata(document, metadataTitle).then(function(tiddlers) {
        for (let tiddlerIndex = 0; tiddlerIndex < tiddlers.length; tiddlerIndex++) {
            let tiddlerData = tiddlers[tiddlerIndex];
            let newTiddler = new $tw.Tiddler(tiddlerData);
            $tw.wiki.addTiddler(newTiddler);

            metadataTiddlers.push(newTiddler);
        }

        document.close();
        return metadataTiddlers;
    });
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

    if (!$tw.node) {
        return Promise.resolve(dataTiddler);
    }

    // only can do this on the server.
    if (!dataTiddler || REBUILD) {
        console.log("failed to find " + metadataTitle);
        //if (pdfName == "1611.08974.pdf") {
        return this.addMetadataTiddler(pdfName);
        //}
    }

    return Promise.resolve(dataTiddler);
}

exports.PDFSyncer = PDFSyncer;
    
})();
