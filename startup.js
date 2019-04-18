/*\
  title: $:/plugins/jlazarow/pdfserve/startup.js
  type: application/javascript
  module-type: startup

  Sync PDFs associated with tiddlers.

\*/
(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.name = "load-pdfserve";
exports.synchronous = true;    

var DEBUG = true;
var PDFStore = require("$:/plugins/jlazarow/pdfserve/store.js").PDFStore;
// taking a dependency on this for now.
var PaperStore = require("$:/plugins/jlazarow/paperstore/paperstore.js").PaperStore;    
    
exports.startup = function() {
    console.log("pdfserve: starting up");
    $tw.pdfs = new PDFStore($tw.wiki, DEBUG);

    // taking a dependency on this for now.
    $tw.papers = new PaperStore($tw.wiki, DEBUG);

    // start the initial synchronization.
    var referencingTiddlers = [];
    $tw.pdfs.sync().then(function(addedTiddlers) {
        let paperPromises = [];

        console.log("getting referencing tiddlers");
        for (let addedIndex = 0; addedIndex < addedTiddlers.length; addedIndex++) {
            let addedTiddler = addedTiddlers[addedIndex];
            let referencingTiddler = $tw.pdfs.getReferencingTiddler(addedTiddler);
            console.log("referencing tiddler:");
            console.log(referencingTiddler);
            
            referencingTiddlers.push(referencingTiddler);

            paperPromises.push(
                $tw.papers.syncTiddler(referencingTiddler));
        }

        return Promise.all(paperPromises);
    }).then(function(papers) {
        console.log("sync returned " + papers.length + " papers");

        for (var paperIndex = 0; paperIndex < papers.length; paperIndex++) {
            var paper = papers[paperIndex];
            var referencingTiddler = referencingTiddlers[paperIndex];

            $tw.papers[referencingTiddler.fields.title] = paper;
        }
    });
}
    
})();
