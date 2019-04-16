/*\
  title: $:/plugins/jlazarow/pdfserve/tokenizer.js
  type: application/javascript
  module-type: library

  tokenizing things
  \*/
(function(){
"use strict";

var pdf = require("hummus");

// Table 57.
var OP_SAVE_GRAPHHICS_STATE = "q";
var OP_RESTORE_GRAPHICS_STATE= "Q";
var OP_SET_GRAPHICS_STATE = "gs";
var OP_SET_CTM = "cm";

// Table 107.
var OP_BEGIN_TEXT_OBJECT = "BT";
var OP_END_TEXT_OBJECT = "ET";

var OP_SET_TEXT_FONT = "Tf";
var OP_SHOW_TEXT = "Tj";
var OP_SHOW_TEXT_ALLOW_GLYPH = "TJ";

function PDFTokenizer(document, input) {
    this.document = document;
    this.input = input;    
}

PDFTokenizer.OP_BEGIN_INLINE_IMAGE_DATA = "ID";
PDFTokenizer.OP_BEGIN_INLINE_IMAGE = "BI";
PDFTokenizer.OP_END_INLINE_IMAGE = "EI";
PDFTokenizer.OP_INVOKE_XOBJECT = "Do";

function PDFCommand(op) {
    this.op = op;
}

function InvokeXObject(name) {
    this.name = name;
    PDFCommand.call(this, PDFTokenizer.OP_INVOKE_XOBJECT);
}

InvokeXObject.prototype = Object.create(PDFCommand.prototype);
InvokeXObject.prototype.constructor = InvokeXObject;
    
PDFTokenizer.prototype.tokenize = function() {
    var tokens = [];

    var inputs = [];
    if (this.input.getType() == pdf.ePDFObjectStream) {
        // only a single stream.
        inputs = [this.input];
    } else if (this.input.getType() == pdf.ePDFObjectArray) {
        // read each stream from the array.
        var arrayLength = this.input.getLength();
        for (var index = 0; index < arrayLength; index++) {
            var valueAtIndex = this.document.reader.queryArrayObject(this.input, index);
            if (valueAtIndex.getType() == pdf.ePDFObjectStream) {
                inputs.push(valueAtIndex);
            }
            else {
                console.log("weird, array has type " + valueAtIndex.getType());
            }
        }
    }
    else {
        console.log("unknown input type " + this.input.getType());
        return tokens;
    }

    var string = "";
    for (var inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        var inputAtIndex = inputs[inputIndex];
        var stream = this.document.reader.startReadingFromStream(inputAtIndex);

        var inputDictionary = inputAtIndex.getDictionary();
        var length = this.document.reader.queryDictionaryObject(inputDictionary, "Length").value;
        var bytes = stream.read(length);
        var stringAtIndex = Buffer.from(bytes).toString();

        string += stringAtIndex;
    }

    // I guess we can split this by newlines. TODO: just throw in PDF.js's parser/lexer somehow.
    var commands = string.split("\n");
    //console.log(commands);
    for (var commandIndex = 0; commandIndex < commands.length; commandIndex++) {
        var command = commands[commandIndex];
        var parts = command.split(" ")

        var operatorName = parts[parts.length - 1];
        if (operatorName.length == 0) {
            continue;
        }
        
        switch (operatorName) {
        case PDFTokenizer.OP_INVOKE_XOBJECT:
            // general way to parse these?
            var referenceName = parts[0].substring(1);
            tokens.push(new InvokeXObject(referenceName));
            break;
        default:
            break;
        }
    }

    return tokens;
}
    
exports.PDFTokenizer = PDFTokenizer;
})();
