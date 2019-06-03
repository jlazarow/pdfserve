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
    console.log("pdfserve: Starting up");
    $tw.pdfs = new PDFStore($tw.wiki, DEBUG);

    // taking a dependency on this for now.
    $tw.papers = new PaperStore($tw.wiki, DEBUG);

    // start the initial synchronization.
    var referencingTiddlers = [];
    $tw.pdfs.sync().then(function(addedTiddlers) {
        let paperPromises = [];

        for (let addedIndex = 0; addedIndex < addedTiddlers.length; addedIndex++) {
            let addedTiddler = addedTiddlers[addedIndex];
            let referencingTiddler = $tw.pdfs.getReferencingTiddler(addedTiddler);
            referencingTiddlers.push(referencingTiddler);

            paperPromises.push(
                $tw.papers.syncTiddler(referencingTiddler).catch(function(err) {
                    console.log("Failed to sync paper: " + referencingTiddler.fields.title + "\n" + err);
                }));
        }

        return Promise.all(paperPromises);
    }).catch(function(err) {
        console.log("Paper syncing encountered error!\n" + err);
    }).then(function(papers) {
        console.log("PDF synchronization returned " + papers.length + " papers");

        for (var paperIndex = 0; paperIndex < papers.length; paperIndex++) {
            let paper = papers[paperIndex];
            if (paper == null) {
                console.log("Some paper was not retrieved. Skipping.");
                continue;
            }
            
            let referencingTiddler = referencingTiddlers[paperIndex];
            if (!referencingTiddler) {
                console.log("Failed to find referencing tiddler for paper " + paper.title);
            }

            try {
                $tw.papers.addPaper(paper, referencingTiddler.fields.title);
            } catch (err) {
                console.log("Failed to add paper: " + referencingTiddler.fields.title + "\n" + err);
            }
        }

        // Also sync all under $:/papers.
        try {
            console.log("saving paper database");
            $tw.papers.save();
        } catch (err) {
            console.log("Failed to save paper database!\n" + err);
        }

        console.log("starting to watch for PDFs");
        $tw.pdfs.syncer.startWatching();

        if ($tw.node) {
            $tw.wiki.addEventListener("change", function(changes) {
                console.log("pdfserve got changes!");

                let titleNames = Object.keys(changes);
                console.log(titleNames);

                titleNames.forEach(function(titleName) {
                    // Ignore drafts.
                    if (titleName.startsWith("Draft of")) {
                        return;
                    }
                
                    let change = changes[titleName];
                
                    if (change.modified) {
                        // OK, modified. pull the tiddler to see if we're interested in it.
                        let changedTiddler = $tw.wiki.getTiddler(titleName);
                        
                        if ("pdf" in changedTiddler.fields) {
                            console.log("Syncing changed tiddler with PDF: " + titleName);
                            $tw.pdfs.syncer.syncTiddler(changedTiddler).catch(function(err) {
                                console.log("Failed to sync pdf: " + changedTiddler.fields["pdf"] + "\n" + err);
                            }).then(function(dataTiddler) {
                                console.log("Successfully created data tiddler. Syncing paper now.");
                                return $tw.papers.syncTiddler(changedTiddler);
                            }).catch(function(err) {
                                console.log("Failed to sync paper: " + titleName + "\n" + err);
                            }).then(function(paper) {
                                console.log("Successfully retrieved paper. Adding it to the database");
                                return $tw.papers.addPaper(paper, titleName);                            
                            }).catch(function(err) {
                                console.log("Failed to sync paper: " + titleName + "\n" + err);
                            }).then(function() {
                                return $tw.papers.save();
                            });
                        }
                    }
                }.bind(this))
            
                console.log(changes);
            });
        }
    });
}
    
})();
