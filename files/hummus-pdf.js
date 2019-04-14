/*\
  title: $:/plugins/jlazarow/pdfserve/hummus-pdf.js
  type: application/javascript
  module-type: library

  HummusJS PDF implementation.

\*/
(function(){
    /*jslint node: true, browser: true */
    /*global $tw: false */
    "use strict";

var fs = require("fs");
var path = require("path");
var pdf = require("hummus");
var png = require("pngjs");
var zlib = require("zlib");
var streams = require("memory-streams");
var PDFTokenizer = require("$:/plugins/jlazarow/pdfserve/tokenizer.js").PDFTokenizer;

var PDFDestinationKind = {
    OffsetAndZoom: 0,
    EntirePage: 1,
    VerticalPosition: 2,
    HorizontalPosition: 3,
    Rectangle: 4,
    PageBoundingBox: 5,
    VerticalPositionBoundingBoxWidth: 6, // What.
    HorizontalPositionBoundingBoxHeight: 7 // What.
};

var PDFDestinationKindMapping = {
    "XYZ": PDFDestinationKind.OffsetAndZoom,
    "Fit": PDFDestinationKind.EntirePage,
    "FitH": PDFDestinationKind.VerticalPosition, // Fit is named to the coordinate that is not specified.
    "FitV": PDFDestinationKind.HorizontalPosition,
};
    
function PDFDestination(document, page) {
}

function PDFColorSpace(document, root, kind, bitsPerComponent) {
    this.document = document;
    this.root = root;
    this.kind = kind;
    this.bitsPerComponent = bitsPerComponent;
};


PDFColorSpace.DeviceGrayColorSpace = "DeviceGray";
PDFColorSpace.DeviceRGBColorSpace = "DeviceRGB";
PDFColorSpace.IndexedColorSpace = "Indexed";    
PDFColorSpace.ICCBasedColorSpace = "ICCBased";
    
PDFColorSpace.ColorSpaces = {
    [PDFColorSpace.DeviceGrayColorSpace]: 0,
    [PDFColorSpace.DeviceRGBColorSpace]: 1,
    [PDFColorSpace.IndexedColorSpace]: 2
}

PDFColorSpace.DeviceColorSpaces = [
    PDFColorSpace.DeviceGrayColorSpace,
    PDFColorSpace.DeviceRGBColorSpace
];

PDFColorSpace.ComponentsPerColorSpace =  {
    [PDFColorSpace.ColorSpaces[PDFColorSpace.DeviceGrayColorSpace]]: 1,
    [PDFColorSpace.ColorSpaces[PDFColorSpace.DeviceRGBColorSpace]]: 3
}

PDFColorSpace.PNGColorTypeMap = {
    [PDFColorSpace.ColorSpaces[PDFColorSpace.DeviceGrayColorSpace]]: 0,
    [PDFColorSpace.ColorSpaces[PDFColorSpace.DeviceRGBColorSpace]]: 2
};

// basically Adobe's "I upgraded your color space".
PDFColorSpace.PNGColorTypeAlphaMap = {
    [PDFColorSpace.ColorSpaces[PDFColorSpace.DeviceGrayColorSpace]]: 4,
    [PDFColorSpace.ColorSpaces[PDFColorSpace.DeviceRGBColorSpace]]: 6
};

function PDFIndexedColorSpace(document, root, bitsPerComponent) {
    PDFColorSpace.call(
        this,
        document,
        root,
        PDFColorSpace.ColorSpaces[PDFColorSpace.IndexedColorSpace],
        bitsPerComponent);

    this.read();
}

PDFIndexedColorSpace.prototype = Object.create(PDFColorSpace.prototype);
PDFIndexedColorSpace.prototype.constructor = PDFIndexedColorSpace;

PDFIndexedColorSpace.prototype.read = function() {
    var base = this.document.reader.queryArrayObject(this.root, 1);
    if (PDFColorSpace.DeviceColorSpaces.indexOf(base.value) < 0) {
        // HACK.
        return;
       //$tw.util.error("expected base color space to be DeviceN: " + base.value);
    }

    this.base = new PDFColorSpace(
        this.document.reader,
        base,
        PDFColorSpace.ColorSpaces[base.value],
        this.bitsPerComponent);
    this.maxIndex = this.document.reader.queryArrayObject(this.root, 2).value;

    // read the table.
    var numberComponents = PDFColorSpace.ComponentsPerColorSpace[this.base.kind];
    var numberBytes = (this.maxIndex + 1) * numberComponents;

    var possibleStream = this.document.reader.queryArrayObject(this.root, 3);

    // HACK: getting out of hand.
    if (possibleStream.getType() == pdf.ePDFObjectStream) {
        var stream = this.document.reader.startReadingFromStream(
            this.document.reader.queryArrayObject(this.root, 3));
        var data = stream.read(numberBytes);

        this.table = [];
        for (var colorIndex = 0; colorIndex <= this.maxIndex; colorIndex++) {
            var startByte = colorIndex * numberComponents;
            var endByte = (colorIndex + 1) * numberComponents;
            
            var colorValue = data.slice(startByte, endByte);
            this.table.push(colorValue);
        }
    }
}

function PDFICCBasedColorSpace(document, root, bitsPerComponent) {
    PDFColorSpace.call(
        this,
        document,
        root,
        null,
        bitsPerComponent);

    this.read();
}

PDFICCBasedColorSpace.prototype = Object.create(PDFColorSpace.prototype);
PDFICCBasedColorSpace.prototype.constructor = PDFICCBasedColorSpace;

PDFICCBasedColorSpace.prototype.read = function() {
    var rootDictionary = this.root.getDictionary();
    var alternateName = this.document.reader.queryDictionaryObject(
        rootDictionary, "Alternate");
    this.alternate = PDFColorSpace.ColorSpaces[alternateName];
}
        
function PDFForm(document, root, objectID) {
    this.document = document;
    this.root = root;
    this.attributes = root.getDictionary();
    this.objectID = objectID; // need for copying.
    this.data = null;

    // figure out how big this should be.
    var bbox = this.attributes.queryObject(PDFForm.BBoxKey);
    this.x = bbox.queryObject(0).value;
    this.y = bbox.queryObject(1).value;
    this.width = bbox.queryObject(2).value;
    this.height = bbox.queryObject(3).value;
}

PDFForm.BBoxKey = "BBox";
PDFForm.prototype.read = function() {
    if (this.data != null ) {
        return this.data;
    }
        
    // create an in-memory PDF of the given object.
    var stream = new streams.WritableStream();
    var result = pdf.createWriter(
        new pdf.PDFStreamForResponse(stream));

    // maybe can optimize this to use existing stream - didn't seem obvious.
    var copy = result.createPDFCopyingContext(this.document.path);
    var destID = copy.copyObject(this.objectID);

    // create a page with just enough room.
    var page = result.createPage(this.x, this.y, this.width, this.height);
    var pageContent = result.startPageContentContext(page).q().cm(1.0, 0, 0, 1.0, 0, 0);
    pageContent.Q()
        .q()
        .cm(1.0, 0, 0, 1.0, 0.0, 0.0)
        .doXObject(page.getResourcesDictionary().addFormXObjectMapping(destID))
        .Q();
    result.writePage(page).end();
    stream.end();

    this.data = stream.toBuffer();

    return this.data;
}
    
function PDFImage(document, parent, image) {
    this.document = document;
    this.parent = parent;
    this.image = image;

    this.attributes = image.getDictionary();
    this.filter = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.FilterKey);
    this.width = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.WidthKey);
    this.height = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.HeightKey);
    this.length = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.LengthKey).value;
        
    this.softMask = null;
    var softMaskValue = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.SoftMaskKey);

    this.decodeParameters = null;
    var decodeParametersValue = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.DecodeParametersKey);

    if (decodeParametersValue != undefined) {
        console.log("decode parameters present");
        this.decodeParameters = decodeParametersValue;
    }

    if (softMaskValue != undefined) {
        console.log("found soft mask. exciting");
        console.log(softMaskValue);
        this.softMask = new PDFImage(this.document, null, softMaskValue);
    }
    
    var colorValue = this.document.reader.queryDictionaryObject(
        this.attributes, PDFImage.ColorSpaceKey);

    if (colorValue === undefined) {
        return;
    }

    if (colorValue.getType() == pdf.ePDFObjectArray) {
        // may or may not actually be indexed.
        var specialName = this.document.reader.queryArrayObject(colorValue, 0).value;
        if (specialName == PDFColorSpace.IndexedColorSpace) {
            this.color = new PDFIndexedColorSpace(
                this.document,
                colorValue,
                this.document.reader.queryDictionaryObject(this.attributes, PDFImage.BitsPerComponentKey).value);
        }
        else if (specialName == PDFColorSpace.ICCBasedColorSpace) {
            console.log("encountered ICC-based color");
            var ignore = new PDFICCBasedColorSpace(
                this.document,
                this.document.reader.queryArrayObject(colorValue, 1),
                this.document.reader.queryDictionaryObject(this.attributes, PDFImage.BitsPerComponentKey).value);

            // "use ICC" flag?
            this.color = new PDFColorSpace(
                this.document,
                colorValue,
                ignore.alternate,
                this.document.reader.queryDictionaryObject(
                    this.attributes, PDFImage.BitsPerComponentKey).value);
        }
        else {
            console.log("probably don't read this image for now: " + specialName);
            //$tw.utils.error("unknown \"special\" color space value: " + specialName);
        }
    }
    else if (PDFColorSpace.DeviceColorSpaces.indexOf(colorValue.value) >= 0) {
        this.color = new PDFColorSpace(
            this.document,
            colorValue,
            PDFColorSpace.ColorSpaces[colorValue.value],
            this.document.reader.queryDictionaryObject(
                this.attributes, PDFImage.BitsPerComponentKey).value);
    }
    else {
        // HACK.
        console.log("unknown color space value: " + colorValue);        
    }
}

PDFImage.FilterKey = "Filter";    
PDFImage.WidthKey = "Width";
PDFImage.HeightKey = "Height";    
PDFImage.LengthKey = "Length";
PDFImage.ColorSpaceKey = "ColorSpace";
PDFImage.BitsPerComponentKey = "BitsPerComponent";
PDFImage.SoftMaskKey = "SMask";
PDFImage.DecodeParametersKey = "DecodeParms";    

PDFImage.prototype.read = function() {
    console.log("reading image start");
    var softMaskData = null;
    if (this.softMask != null) {
        console.log("reading soft mask first");
        var softMaskStream = this.document.reader.startReadingFromStream(this.softMask.image);

        // this is always "device gray".
        var softMaskData = softMaskStream.read(this.softMask.width * this.softMask.height);
        
        //console.log("soft mask data:");
        //console.log(softMaskData);
    }

    var stream = this.document.reader.startReadingFromStream(this.image);
    var data = null;
    var colorType = null;

    if (this.color instanceof PDFIndexedColorSpace) {
        var numberComponents = PDFColorSpace.ComponentsPerColorSpace[this.color.base.kind];
        var indexedData = stream.read(this.width * this.height * numberComponents);
        colorType = PDFColorSpace.PNGColorTypeMap[this.color.base.kind];

        // how fast does this need to be?
        data = [];
        for (var index = 0; index < indexedData.length; index++) {
            var indexValue = indexedData[index];
            Array.prototype.push.apply(data, this.color.table[indexValue]);
        }
    }
    else {
        var numberComponents = PDFColorSpace.ComponentsPerColorSpace[this.color.kind];
        var expectedLength = this.width * this.height * numberComponents;
        data = stream.read(expectedLength);

        // I don't think hummus handles the PNG predictors properly.
        if (this.decodeParameters != null) {
            // Check if predictor >= 10 in use.
            var predictorValue = this.document.reader.queryDictionaryObject(
                this.decodeParameters, "Predictor");
            if (predictorValue !== undefined) {
                predictorValue = predictorValue.value;

                // only handle 8-bit for now.
                if (predictorValue >= 10 && this.color.bitsPerComponent == 8) {
                    console.log("predictor 10 in use... investigating");
                    var verbatimStream = this.document.reader.startReadingFromStreamForPlainCopying(this.image);
                    var verbatimData = Buffer.from(verbatimStream.read(this.length));
                    var inflatedData = zlib.inflateSync(verbatimData);
                    // console.log("inflated to size " + inflatedData.length);

                    // predict each byte.
                    var unpredictedData = [];
                    for (var rowIndex = 0; rowIndex < this.height; rowIndex++) {
                        var bufferRowStart = (this.width * numberComponents + 1) * rowIndex;
                        var predictorValue = inflatedData[bufferRowStart];
                        // console.log(bufferRowStart);
                        // console.log("predictor for row " + rowIndex + ": " + predictorValue);
                        if (predictorValue == 3 || predictorValue > 4) {
                            console.log("quitting, found something not none, sub, or up");
                            break;
                        }

                        var columnData = [];
                        for (var columnIndex = 0; columnIndex < this.width; columnIndex++) {
                            // extra byte per row.
                            var bufferIndex = (bufferRowStart + 1) + columnIndex * numberComponents;

                            // rgb.
                            for (var componentIndex = 0; componentIndex < numberComponents; componentIndex++) {
                                var givenByte = inflatedData[bufferIndex + componentIndex];

                                // none.
                                if (predictorValue == 0) {
                                    columnData.push(givenByte);
                                }
                                else if (predictorValue == 1) {
                                    // sub.
                                    if (columnIndex == 0) {
                                        // boundary.
                                        columnData.push(givenByte);
                                    }
                                    else {
                                        columnData.push((givenByte + columnData[columnData.length - numberComponents]) % 256);
                                    }
                                }
                                else if (predictorValue == 2) {
                                    // up.
                                    if (rowIndex == 0) {
                                        // boundary.
                                        columnData.push(givenByte);
                                    }
                                    else {
                                        var priorIndex = (rowIndex - 1) * this.width * numberComponents + columnIndex * numberComponents + componentIndex;
                                        columnData.push((givenByte + unpredictedData[priorIndex]) % 256);
                                    }
                                }
                                else if (predictorValue == 4) {
                                    // paeth.
                                    var left = 0;
                                    var up = 0;
                                    var upThenLeft = 0;

                                    // can we get an up?
                                    if (rowIndex > 0) {
                                        var priorIndex = (rowIndex - 1) * this.width * numberComponents + columnIndex * numberComponents + componentIndex;
                                        up = unpredictedData[priorIndex];
                                    }

                                    // can we get a left?
                                    if (columnIndex > 0) {
                                        // left exists.
                                        left = columnData[columnData.length - numberComponents];
                                    }

                                    // can we get an up and then left?
                                    if (rowIndex > 0 && columnIndex > 0) {
                                        var priorIndex = (rowIndex - 1) * this.width * numberComponents + columnIndex * numberComponents + componentIndex;
                                        upThenLeft = unpredictedData[priorIndex - numberComponents];
                                    }

                                    var initial = left + up - upThenLeft;
                                    var pa = Math.abs(initial - left);
                                    var pb = Math.abs(initial - up);
                                    var pc = Math.abs(initial - upThenLeft);

                                    var chosen = null;
                                    if (pa <= pb && pa <= pc) {
                                        chosen = left;
                                    } else if (pb <= pc) {
                                        chosen = up;
                                    }
                                    else {
                                        chosen = upThenLeft;
                                    }

                                    columnData.push((givenByte + chosen) % 256);
                                }
                            }
                        }

                        for (var ci = 0; ci < columnData.length; ci++) {
                            unpredictedData.push(columnData[ci]);
                        }
                    }

                    console.log("unpredicted to size " + unpredictedData.length);
                    data = unpredictedData;
                }
            }
        }

        // todo: generalize this.
        if (this.color.bitsPerComponent == 1) {
            // manually "expand" these sub-byte images.
            console.log("special handling of bpp " + this.color.bitsPerComponent);
            var expandedData = [];
            
            // note that row boundaries don't share bytes.
            var rowLength = 0;
            for (var byteIndex = 0; byteIndex < data.length; byteIndex++) {
                var byteValue = data[byteIndex];
                
                for (var bitIndex = 0; bitIndex < 8; bitIndex++) {
                    // big endian.
                    var mask = 128 >> bitIndex;
                    var masked = byteValue & mask;

                    if (masked != 0) {
                        expandedData.push(255);
                    }
                    else {
                        expandedData.push(0);
                    }

                    rowLength += 1;

                    if (rowLength >= this.width) {
                        rowLength = 0;
                        break;
                    }
                }
            }

            data = expandedData;
        }
        else if (this.color.bitsPerComponent == 4) {
            // manually "expand" these sub-byte images.
            console.log("special handling of bpp " + this.color.bitsPerComponent);
            var expandedData = [];
            
            // note that row boundaries don't share bytes.
            var rowLength = 0;
            for (var byteIndex = 0; byteIndex < data.length; byteIndex++) {
                var byteValue = data[byteIndex];
                
                for (var nibbleIndex = 0; nibbleIndex < 2; nibbleIndex++) {
                    // big endian.
                    var mask = 240 >> (4 * nibbleIndex);
                    var masked = (byteValue & mask) >> (4 * (1 - nibbleIndex));

                    expandedData.push(masked * 17)
                    rowLength += 1;

                    if (rowLength >= this.width) {
                        rowLength = 0;
                        break;
                    }
                }
            }

            data = expandedData;
            
        }
        
        colorType = PDFColorSpace.PNGColorTypeMap[this.color.kind];

        // but if the softmask is present, we get an upgrade.
        if (softMaskData != null) {
            console.log("applying softmask with number components: " + numberComponents);
            colorType = PDFColorSpace.PNGColorTypeAlphaMap[this.color.kind];
            console.log("upgraded color type to " + colorType);

            // fix up data. this is slow. make it better.
            var mergedData = [];
            for (var i = 0; i < (data.length / numberComponents); i++) {
                for (var c = 0; c < numberComponents; c++) {
                    mergedData.push(data[numberComponents * i + c]);
                }

                mergedData.push(softMaskData[i]);
            }

            data = mergedData;
        }
    }

    var result = new png.PNG({
        "width": this.width,
        "height": this.height,
        "inputColorType": colorType,
        "colorType": colorType,
    });

    // console.log("read buffer");
    // console.log(data.length);

    result.data = Buffer.from(data);
    // var stringData = result.data.toString("hex");
    // var ptr = 0;
    // while (ptr < 2000) { //stringData.length) {
    //     var rowString = "";
    //     for (var nibbleIndex = 0; (nibbleIndex < 16) && (ptr < stringData.length); nibbleIndex++) {
    //         // byte aligned worst case?
    //         rowString += (stringData[ptr] + stringData[ptr + 1] + " ");
    //         ptr += 2;
    //     }

    //     console.log(rowString);
    // }

    // this is lame!    
    // for (var y = 0; y < this.height; y++) {
    //     for (var x = 0; x < this.width; x++) {
    //         // assuming scan lines are rows.
    //         var fromBufferIndex = (this.width * y + x) * 3;
    //         var toBufferIndex = (this.width * y + x) * 3; //4; // PNG always uses RGBA internally annoyingly.
    //         console.log("blah");

    //         // // unsure how PDF even uses alpha.
    //         // if (this.colorSpace == "DeviceGray") {
    //         //     result.data[toBufferIndex + 0] = data[fromBufferIndex];
    //         //     result.data[toBufferIndex + 1] = data[fromBufferIndex];
    //         //     result.data[toBufferIndex + 2] = data[fromBufferIndex];
    //         // }
    //         // else if (this.colorSpace == "DeviceRGB") {
    //         result.data[toBufferIndex + 0] = data[fromBufferIndex];
    //         result.data[toBufferIndex + 1] = data[fromBufferIndex + 1];
    //         result.data[toBufferIndex + 2] = data[fromBufferIndex + 2];
    //         //result.data[toBufferIndex + 3] = 255;
    //         //}
    //         //result.data[toBufferIndex + 3] = 255;
    //     }
    // }

    return result;
}
    
function PDFDocumentOutlineItem(document, item) {
    this.document = document;
    this.item = item;
}

PDFDocumentOutlineItem.TitleKey = "Title";

// Optional (mutually exclusive with "Actions");
PDFDocumentOutlineItem.DestKey = "Dest";    

PDFDocumentOutlineItem.prototype.read = function() {
    this.title = this.document.reader.queryDictionaryObject(
        this.item, PDFDocumentOutlineItem.TitleKey);
    // holds named destination.
    this.name = null;
    
    var dest = this.document.reader.queryDictionaryObject(
        this.item, PDFDocumentOutlineItem.DestKey);
    if (dest !== undefined) {
        this.name = dest.value;
    }
}
    
function PDFDocumentOutline(document, outline, level) {
    this.document = document;
    this.outline = outline;
    this.level = level;
    this.indent = new Array(this.level * 2).join(" ");
    this.items = [];
    this.children = []
}

PDFDocumentOutline.OutlinesKey = "Outlines";
PDFDocumentOutline.CountKey = "Count";

PDFDocumentOutline.prototype.read = function() {
    // sign of values imply "visibility".
    this.count = Math.abs(
        this.document.reader.queryDictionaryObject(
            this.outline, PDFDocumentOutline.CountKey));
    console.log(this.indent + "outline count: " + this.count);

    var current = this.document.reader.queryDictionaryObject(this.outline, "First");
    for (var index = 0; index < this.count; index++) {
        var currentItem = new PDFDocumentOutlineItem(this.document, current);
        this.children.push(currentItem);
        
        currentItem.read();
        
        if (currentItem.name != null) {
            console.log(this.indent + currentItem.title + " (" + currentItem.name + ")");
        }
        
        // check if it has any children.
        var childCount = this.document.reader.queryDictionaryObject(
            current, PDFDocumentOutline.CountKey);
        if (childCount !== undefined && (Math.abs(childCount) > 0)) {
            var childOutline = new PDFDocumentOutline(
                this.document, current, this.level + 1);
            this.children.push(childOutline);

            childOutline.read();            
        }
        
        current = this.document.reader.queryDictionaryObject(current, "Next");
    }
}

function PDFDocumentCatalog(document) {
    this.document = document;
    this.trailer = this.document.reader.getTrailer();
    this.root = this.document.reader.queryDictionaryObject(
        this.trailer, PDFDocumentCatalog.RootKey);
    this.outline = null;

    var outlines = this.document.reader.queryDictionaryObject(
        this.root, PDFDocumentOutline.OutlinesKey);    
    if (outlines !== undefined) {
        //this.outline = new $tw.PDFDocumentOutline(this.reader, outlines, 0);
        console.log("document does have outline!");
    }
    else {
        console.log("document has no outline!");
    }

    this.hasOutline = this.outline != null;
}

PDFDocumentCatalog.RootKey = "Root";
    
PDFDocumentCatalog.prototype.read = function() {
    if (this.outline != null) {
        this.outline.read();
    }
}
    
function PDFDocumentMetadata(document) {
    this.document = document;
    this.trailer = this.document.reader.getTrailer();
}

PDFDocumentMetadata.InfoKey = "Info";
PDFDocumentMetadata.AuthorKey = "Author";
PDFDocumentMetadata.KeywordsKey = "Keywords";
PDFDocumentMetadata.SubjectKey = "Subject";
PDFDocumentMetadata.TitleKey = "Title";
PDFDocumentMetadata.CreationDateKey = "CreationDate";
PDFDocumentMetadata.ModDateKey = "ModDate";
    
PDFDocumentMetadata.prototype.read = function() {
    this.info = this.document.reader.queryDictionaryObject(
        this.trailer, PDFDocumentMetadata.InfoKey);

    this.author = this.document.reader.queryDictionaryObject(
        this.info, PDFDocumentMetadata.AuthorKey);
    if (this.author != undefined) {
        this.author = this.author.value;
    }
    
    this.keywords = this.document.reader.queryDictionaryObject(
        this.info, PDFDocumentMetadata.KeywordsKey);
    if (this.keywords != undefined) {
        this.keywords = this.keywords.value;
    }
    
    this.subject = this.document.reader.queryDictionaryObject(
        this.info, PDFDocumentMetadata.SubjectKey);
    if (this.subject != undefined) {
        this.subject = this.subject.value;
    }
    
    this.title = this.document.reader.queryDictionaryObject(
        this.info, PDFDocumentMetadata.TitleKey);
    if (this.title != undefined) {
        this.title = this.title.value;
    }

    this.created = this.document.reader.queryDictionaryObject(
        this.info, PDFDocumentMetadata.CreationDateKey);
    if (this.created != undefined) {
        this.created = this.created.value;
    }
    
    this.modified = this.document.reader.queryDictionaryObject(
        this.info, PDFDocumentMetadata.ModDateKey);
    if (this.modified != undefined) {
        this.modified = this.modified.value;
    }
    
    console.log("author: " + this.author + "\n" + "keywords: " + this.keywords + "\n" + "subject: " + this.subject + "\n" + "title: " + this.title);
}

function PDFExternalObject(document, root) {
    this.document = document;
    this.root = root;
}

PDFExternalObject.ImageSubtype = "Image";
PDFExternalObject.FormSubtype = "Form";

// Note: CCITTFaxDecode seems to cause a segmentation fault.
PDFExternalObject.SupportedFilters = ["DCTDecode", "FlateDecode"];

PDFExternalObject.prototype.read = function() {
    this.names = Object.keys(this.root.toJSObject());
    // console.log("found some XObject names:");
    this.images = {};
    this.embedded = {};
    console.log("PDFExternalObject.read()");

    for (var nameIndex = 0; nameIndex < this.names.length; nameIndex++) {        
        var name = this.names[nameIndex];
        if (this.document.debug) {
            console.log("xobject name: " + name);
        }
        
        // ask about it.
        var object = this.document.reader.queryDictionaryObject(this.root, name);
        var objectMetadata = object.getDictionary().toJSObject();
        if (objectMetadata.Subtype.value == PDFExternalObject.ImageSubtype) {
            if (this.document.debug) {
                console.log("found image subtype");
            }
            
            // Ignore Flate for now.
            if ((objectMetadata.Filter === undefined) || PDFExternalObject.SupportedFilters.indexOf(objectMetadata.Filter.value) < 0) {
                console.log("skipping unsupported " + (objectMetadata.Filter === undefined) ? "undefined" : objectMetadata.Filter.value);
                continue;
            }
            
            // an image!
            var image = new PDFImage(this.document, null, object);
            this.images[name] = image;
        }
        else if (objectMetadata.Subtype.value == PDFExternalObject.FormSubtype) {
            if (this.document.debug) {
                console.log("found form subtype: " + objectMetadata.Type);
            }
            
            // pull it out the hard way.
            // I don't think it can be anything else.
            if (objectMetadata.Type === undefined) {
                if (this.document.debug) {
                    console.log("UNDEFINED FORM TYPE");
                }
                
                continue;
            }
            
            if (objectMetadata.Type.value == "XObject") {
                if (this.document.debug) {
                    console.log("form has embedded xobject");
                }
                
                var indirect = this.root.queryObject(name);
                var objectID = indirect.getObjectID();
                //console.log("using object ID " + objectID);

                // expose the "entire" embedded xobject.
                var form = new PDFForm(
                    this.document,
                    object,
                    objectID);

                this.embedded[name] = form;

                // expose the individual objects too: TODO. harder than it appears.
                var resourceObject = this.document.reader.queryDictionaryObject(
                    object.getDictionary(),
                    "Resources");
                if (resourceObject !== undefined && resourceObject != null && (resourceObject.getType() == pdf.ePDFObjectDictionary)) {
                    var embeddedResources = new PDFPageResources(
                        this.document,
                        resourceObject);

                    if (embeddedResources.xobject != null) {
                        if (this.document.debug) {
                            console.log("embedded xobject has resources");
                        }                    
                        
                        embeddedResources.read();

                        // NOTE: these only go 1 level deep for now.
                        // promote the embeds.
                        var embeddedEmbeddedNames = Object.keys(embeddedResources.xobject.embedded);
                        for (var embeddedNameIndex = 0; embeddedNameIndex < embeddedEmbeddedNames.length; embeddedNameIndex++) {
                            var embeddedName = embeddedEmbeddedNames[embeddedNameIndex];

                            var qualifiedName = name + "/" + embeddedName;
                            if (qualifiedName in this.embedded) {
                                console.log("WARN WARN: embededd name " + qualifiedName + " does not seem global. skipping.");
                                continue;
                            }

                            this.embedded[qualifiedName] = embeddedResources.xobject.embedded[embeddedName];
                        }

                        // promote this images.
                        var embeddedImageNames = Object.keys(embeddedResources.xobject.images);
                        for (var embeddedNameIndex = 0; embeddedNameIndex < embeddedImageNames.length; embeddedNameIndex++) {
                            var embeddedName = embeddedImageNames[embeddedNameIndex];

                            var qualifiedName = name + "/" + embeddedName;
                            if (qualifiedName in this.images) {
                                console.log("WARN WARN: embededd name " + qualifiedName + " does not seem global. skipping.");
                                continue;
                            }

                            this.images[qualifiedName] = embeddedResources.xobject.images[embeddedName];
                        }
                    }
                }
            }
        }
        else {
            if (this.document.debug) {
                console.log("unknown subtype: " + objectMetadata.Subtype.value);
            }
        }
    }

    //console.log("found " + this.images.length + " images");
}

function PDFPageResources(document, root) {
    this.document = document;
    this.root = root;
    this.xobject = null;

    var xobjectValue = this.document.reader.queryDictionaryObject(
        this.root, PDFPageResources.XObjectKey);
    if (xobjectValue !== undefined) {
        this.xobject = new PDFExternalObject(this.document, xobjectValue);
    }
}

PDFPageResources.XObjectKey = "XObject";

PDFPageResources.prototype.read = function() {
    if (this.xobject != null) {
        this.xobject.read();
    } else {
        ;//console.log("no page resources xobject??");
    }
}

// really, a better name for this is "tokenizer".
function PDFPageParser(document, index, input) {
    this.document = document;
    this.index = index;
    this.input = input;
    this.tokenizer = new PDFTokenizer(
        this.document, this.document.reader.queryDictionaryObject(this.input.getDictionary(), "Contents"));
}

PDFPageParser.prototype.tokenizeFigures = function() {
    // search through the stream to references to graphics.
    var tokens = this.tokenizer.tokenize();
}
    
function PDFPage(document, index, metadata, input) {
    this.document = document;
    this.index = index;
    this.metadata = metadata;
    this.input = input;

    this.parser = new PDFPageParser(
        this.document,
        this.index,
        this.input);
        
    this.resources = new PDFPageResources(
        this.document,
        this.document.reader.queryDictionaryObject(this.metadata, PDFPage.ResourcesKey));

    this.hasRead = false;
}

PDFPage.ResourcesKey = "Resources";

PDFPage.prototype.read = function() {
    this.resources.read();
    this.hasRead = true;
}
    
function PDFDocument(path, debug) {
    this.path = path;
    this.debug = debug || false;
    this.reader = pdf.createReader(path);
    this.numberPages = this.reader.getPagesCount();

    this.metadata = new PDFDocumentMetadata(this);
    this.metadata.read();

    this.catalog = new PDFDocumentCatalog(this);
    this.catalog.read();

    this.pages = [];

    for (var pageNumber = 0; pageNumber < this.numberPages; pageNumber++) {
        if (this.debug) {
            console.log("reading page: " + pageNumber);
        }
        
        var pageMetadata = this.reader.parsePageDictionary(pageNumber);
        var pageInput = this.reader.parsePage(pageNumber);
        var page = new PDFPage(this, pageNumber, pageMetadata, pageInput);

        if (pageNumber == 0) {
            page.parser.tokenizeFigures();
        }
        
        this.pages.push(page);
    }
}

PDFDocument.prototype.close = function() {
    this.reader.end();
}

PDFDocument.prototype.saveAllImages = function(basePath) {
    var savePath = path.resolve(basePath, path.basename(this.path));
    if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath);
    }

    for (var pageNumber = 0; pageNumber < this.pages.length; pageNumber++) {        
        var page = this.pages[pageNumber];
        var pageXObject = page.resources.xobject;
        if (pageXObject != null) {
            var pagePath = path.resolve(savePath, pageNumber.toString());
            if (!fs.existsSync(pagePath)) {
                fs.mkdirSync(pagePath);
            }

            var pageImages = pageXObject.images;
            for (var imageIndex = 0; imageIndex < pageImages.length; imageIndex++) {
                var pageImage = pageImages[imageIndex];
                var imageData = pageImage.read();
                var imagePath = path.resolve(pagePath, imageIndex + ".png");

                imageData.pack().pipe(fs.createWriteStream(imagePath));
            }
        }
    }
}

// $tw.convertPDFToPNG = function(bytes, pageNumber) {
//     // use pdfjs to convert to a canvas.
//     var source = {
//         data: bytes,
//         nativeImageDecoderSupport: 'none',
//         disableFontFace: true,
//         stopAtErrors: false,
//     };

//     // load the PDF file.
//     return pdfjs.getDocument(source).then(function (document) {
//         return document.getPage(pageNumber).then(function (page) {
//             var viewport = page.getViewport(1.0);
//             var canvasFactory = new NodeCanvasFactory();
//             var canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
//             var renderContext = {
//                 canvasContext: canvasAndContext.context,
//                 viewport: viewport,
//                 canvasFactory: canvasFactory
//             };
            
//             return page.render(renderContext).then(function () {
//                 var image = canvasAndContext.canvas.toBuffer();
//                 return image;
//             });
//         });
//     }).catch(function(reason) {
//         console.log(reason);
//         return null;
//     });
// }

exports.PDFDocumentCatalog = PDFDocumentCatalog;
exports.PDFDocumentOutline = PDFDocumentOutline;
exports.PDFImage = PDFImage;
exports.PDFPage = PDFPage;
exports.PDFDocument = PDFDocument;
    
})();    
