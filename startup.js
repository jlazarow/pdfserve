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
   
exports.startup = function() {
    console.log("pdfserve: starting up");
    $tw.pdfs = new PDFStore($tw.wiki, DEBUG);

    // start the initial synchronization.
    $tw.pdfs.sync();
}
    
})();
