/*\
  title: $:/plugins/jlazarow/pdfserve/pdfapi.js
  type: application/javascript
  module-type: library

  \*/
(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var pdfjs, Canvas, assert, hummuspdf, fs, png;
if ($tw.node) {
    pdfjs = require("pdfjs-dist");
    Canvas = require("canvas");
    assert = require('assert');    
    hummuspdf = require("$:/plugins/jlazarow/pdfserve/hummus-pdf.js");
    fs = require('fs');
    png = require("pngjs");
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

PDF.getResource = function(document, pageIndex, resourceName) {
    if (pageIndex < 0 || pageIndex >= document.pages.length) {
        console.log("bad page index " + pageIndex);
        return Promise.resolve(null);
    }
        
    var page = document.pages[pageIndex];
    if (!page.hasRead) {
        console.log("reading page at index: " + pageIndex);
        page.read();
    }

    var foundImages = {};
    var foundEmbeds = {};
    var foundXObject = page.resources.xobject;
    if (foundXObject) {
        foundImages = page.resources.xobject.images;
        foundEmbeds = page.resources.xobject.embedded;
    }
    
    if (resourceName in foundImages) {
        console.log("reading image resource");
        var foundImage = foundImages[resourceName];
        while (!(foundImage instanceof hummuspdf.PDFImage)) {
            foundImage = foundImage[Object.keys(foundImage)[0]];
        }

        var imageData = foundImage.read();
        //stream.end();
        
        //console.log("getting image:");
        //console.log(foundImage);
        return Promise.resolve(png.PNG.sync.write(imageData));
    }
    else if (resourceName in foundEmbeds) {
        console.log("reading embed resource");
        var foundEmbed = foundEmbeds[resourceName];
        var embeddedData = foundEmbed.read();

        //console.log("embddded data");
        //console.log(Buffer.from(embeddedData).toString());        

        console.log("getting embed: " + resourceName);

        // convert to PNG.
        return convertPDFToPNG(embeddedData, 1).then(function(pngData) {
            return pngData;
        });
    }

    console.log("failed to find anything: " + resourceName);

    return Promise.resolve(null);
}    
// returns a promise after attempting to write the requested resource
// to the stream "output".    
PDF.prototype.writeResource = function(pageIndex, resourceName, output, beforeWrite) {
    if (pageIndex < 0 || pageIndex >= this.document.pages.length) {
        console.log("bad page index " + pageIndex);
        beforeWrite(false);
        output.end();
    }
        
    var page = this.document.pages[pageIndex];
    if (!page.hasRead) {
        console.log("reading page at index: " + pageIndex);
        page.read();
    }

    var foundImages = {};
    var foundEmbeds = {};
    var foundXObject = page.resources.xobject;
    if (foundXObject) {
        foundImages = page.resources.xobject.images;
        foundEmbeds = page.resources.xobject.embedded;
    }
    
    if (resourceName in foundImages) {
        console.log("reading image resource");
        var foundImage = foundImages[resourceName];
        while (!(foundImage instanceof hummuspdf.PDFImage)) {
            foundImage = foundImage[Object.keys(foundImage)[0]];
        }

        var imageData = foundImage.read();

        // awkward, but not sure how to anticipate this.
        if (beforeWrite) {
            beforeWrite(true);
        }

        // note: pipe calls end().
        imageData.pack().pipe(output);

        return Promise.resolve(true);
    }
    else if (resourceName in foundEmbeds) {
        console.log("reading embed resource");
        var foundEmbed = foundEmbeds[resourceName];
        var embeddedData = foundEmbed.read();
        
        if (beforeWrite) {
            beforeWrite(true);
        }
        
        // convert to PNG.
        return convertPDFToPNG(embeddedData, 1).then(function(pngData) {
            output.write(pngData);
            output.end();

            return true;
        });
    }

    if (beforeWrite) {
        beforeWrite(false);
    }

    // not good.
    console.log("bad resource name: " + resourceName);
    console.log("valid names are:");
    console.log("images:");
    console.log(Object.keys(foundImages));
    console.log("embeds:");
    console.log(Object.keys(foundEmbeds));
    output.end();

    return Promise.resolve(false);
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
    //var debugFile = fs.createWriteStream("/Users/jlazarow/De/conv.pdf");
    //debugFile.write(bytes);
    //debugFile.end()
    // console.log("reading " + path);
    // var bytes = fs.readFileSync(path);
    // console.log(bytes);
        
    // use pdfjs to convert to a canvas.
    var source = {
        data: new Uint8Array(bytes), // this somehow changes everything.
        nativeImageDecoderSupport: "none",
        disableFontFace: true,
        stopAtErrors: false,
    };

    // load the PDF file.
    var loadingTask = pdfjs.getDocument(source);
    return loadingTask.promise.then(function (document) {
        //console.log("successfully read " + path);
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

    return Promise.resolve(null);
}
    
exports.PDF = PDF;
exports.convertPDFToPNG = convertPDFToPNG;

})();
