/*\
  title: $:/plugins/jlazarow/pdfserve/store.js
  type: application/javascript
  module-type: library

  \*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var fs, path, hummuspdf;
    
if ($tw.node) {
    fs = require("fs");
    path = require("path");
    hummuspdf = require("$:/plugins/jlazarow/pdfserve/hummus-pdf.js");
}
        
var HIDDEN_TITLE_PREFIX = "$:/pdf/";        
var PDFSyncer = require("$:/plugins/jlazarow/pdfserve/syncer.js").PDFSyncer;        
var API = require("$:/plugins/jlazarow/pdfserve/pdfapi.js");        
    
function PDFStore(wiki, debug) {
    // store by name.
    this.wiki = wiki;
    this.debug = debug;
    
    this.pdfs = {};
    this.open = {};
    this.syncer = new PDFSyncer(this.wiki, this.debug);
}

PDFStore.prototype.getTiddler = function(pdfName) {
    var dataTitle = HIDDEN_TITLE_PREFIX + pdfName;
    return this.wiki.getTiddler(dataTitle);
}    

PDFStore.prototype.getPDF = function(name) {
    console.log("PDFStore retrieving " + name);
    if (name in this.open) {
        return this.open[name];
    }

    var dataTiddler = this.getTiddler(name);
    if (!dataTiddler) {
        // must not exist in the wiki.
        return null;
    }
    
    var document = null;
    if ($tw.node) {
        var filepath = path.resolve(this.syncer.root, name);
        document = new hummuspdf.PDFDocument(filepath, this.debug);
    }

    var result = new API.PDF(dataTiddler, document);
    this.open[name] = result;

    return result;
}

PDFStore.prototype.sync = function() {
    return this.syncer.syncTiddlers().then(function(dataTiddlers) {
        console.log("sync completed: " + dataTiddlers.length + " PDFs");

        for (let tiddlerIndex = 0; tiddlerIndex < dataTiddlers.length; tiddlerIndex++) {
            let tiddlerAtIndex = dataTiddlers[tiddlerIndex];
            if (Array.isArray(tiddlerAtIndex)) {
                tiddlerAtIndex = tiddletAtIndex[0];
            }

            this.pdfs[tiddlerAtIndex.fields.title] = tiddlerAtIndex;
        }
    }.bind(this));
}
    
exports.PDFStore = PDFStore;
})();
