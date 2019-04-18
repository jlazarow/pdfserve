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

var HIDDEN_TITLE_PREFIX = "$:/pdf/";            

function PDFOutlineItem(title, destination, level, items) {
    this.title = title;
    this.destination = destination;
    this.level = level;
    this.items = items;
}

PDFOutlineItem.parse = function(item, level) {
    var childItems = [];
    if ("children" in item) {
        for (var childIndex = 0; childIndex < item.children.length; childIndex++) {
            let childItem = PDFOutlineItem.parse(item.children[childIndex], level + 1);
            childItems.push(childItem);
        }
    }

    if ("items" in item) {
        item = item.items[0];
    }

    var title = item.title.value;
    var destination = item.destination.value;

    return new PDFOutlineItem(title, destination, level, childItems);
}

PDFOutlineItem.prototype.getFlattened = function() {
    var flattened = [ this ];

    for (var itemIndex = 0; itemIndex < this.items.length; itemIndex++) {
        var item = this.items[itemIndex];

        flattened = flattened.concat(item.getFlattened());
    }

    return flattened;
}
    
function PDFOutline(rootItems) {
    console.log(rootItems);
    // recursively read the top level items.
    this.items = [];

    for (var rootItemIndex = 0; rootItemIndex < rootItems.length; rootItemIndex++) {
        var item = PDFOutlineItem.parse(rootItems[rootItemIndex], 0);
        this.items.push(item);
    }
}

PDFOutline.prototype.getFlattened = function() {
    var flattened = [];

    for (var itemIndex = 0; itemIndex < this.items.length; itemIndex++) {
        var item = this.items[itemIndex];
        
        flattened = flattened.concat(item.getFlattened());
    }

    return flattened;
}        

var OUTLINE_NAME = "outline";
    
function PDF(tiddler, document) {
    this.tiddler = tiddler;
    this.name = this.tiddler.fields.title.substring(HIDDEN_TITLE_PREFIX.length);
    this.document = document || null;

    console.log(this.tiddler.fields.text);
    this.metadata = JSON.parse(this.tiddler.fields.text);

    // check if an outline exists.
    this.outline = this.readOutline();
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

PDF.prototype.readOutline = function() {
    var outlineTitle = this.tiddler.fields.title + "/" + OUTLINE_NAME;
    var outlineTiddler = $tw.wiki.getTiddler(outlineTitle);

    if (outlineTiddler == undefined) {
        return null;
    }

    var outlineData = JSON.parse(outlineTiddler.fields.text);
    return new PDFOutline(outlineData["children"]);
}
    
PDF.prototype.getThumbnails = function(pageIndex) {
    // look for certain tiddlers.
    var pageThumbnailsTitle = this.tiddler.fields.title + "/" + "page" + "/" + pageIndex + "/" + "thumbnails";
    var pageThumbnailTiddler = $tw.wiki.getTiddler(pageThumbnailsTitle);

    if (!pageThumbnailTiddler) {
        return {};
    }

    return JSON.parse(pageThumbnailTiddler.fields.text);
}
    
// returns a promise after attempting to write the requested resource
// to the stream "output". Requires Node.js.
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
