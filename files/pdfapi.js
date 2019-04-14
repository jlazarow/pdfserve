/*\
  title: $:/plugins/jlazarow/pdfserve/pdfapi.js
  type: application/javascript
  module-type: library

  \*/
(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var pdfjs, Canvas, assert;
if ($tw.node) {
    pdfjs = require("pdfjs-dist");
    Canvas = require("canvas");
    assert = require('assert');    
}
    
// All PDFs should be backed by a tiddler. If we're on the server
// having a document backed by Hummus is possible. If we're on the
// client, theoretically this could be PDFJS backed, but that is
// unlikely to be too useful.

function PDF(tiddler, document) {
    this.tiddler = tiddler;
    this.document = document || null;

    this.data = $tw.wiki.getTiddlerAsJson(this.tiddler.title);
    console.log(this.data);
}

function NodeCanvasFactory() {}

NodeCanvasFactory.prototype = {
  create: function NodeCanvasFactory_create(width, height) {
    assert(width > 0 && height > 0, 'Invalid canvas size');
    var canvas = Canvas.createCanvas(width, height);
    var context = canvas.getContext('2d');
    return {
      canvas: canvas,
      context: context,
    };
  },

  reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');
    assert(width > 0 && height > 0, 'Invalid canvas size');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },

  destroy: function NodeCanvasFactory_destroy(canvasAndContext) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');

    // Zeroing the width and height cause Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  },
};    

function convertPDFToPNG(bytes, pageNumber) {
    // use pdfjs to convert to a canvas.
    var source = {
        data: bytes,
        nativeImageDecoderSupport: "none",
        disableFontFace: true,
        stopAtErrors: false,
    };

    // load the PDF file.
    return pdfjs.getDocument(source).then(function (document) {
        return document.getPage(pageNumber).then(function (page) {
            var viewport = page.getViewport(1.0);
            var canvasFactory = new NodeCanvasFactory();
            var canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
            var renderContext = {
                canvasContext: canvasAndContext.context,
                viewport: viewport,
                canvasFactory: canvasFactory
            };
            
            return page.render(renderContext).then(function () {
                var image = canvasAndContext.canvas.toBuffer();
                return image;
            });
        });
    }).catch(function(reason) {
        console.log(reason);
        return null;
    });
}
    
exports.PDF = PDF;
exports.convertPDFToPNG = convertPDFToPNG;

})();
