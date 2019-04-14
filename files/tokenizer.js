/*\
  title: $:/plugins/jlazarow/pdfserve/tokenizer.js
  type: application/javascript
  module-type: library

  tokenizing things
  \*/
(function(){

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

// probably only care about these for now.    
var OP_BEGIN_INLINE_IMAGE_DATA = "ID";
var OP_BEGIN_INLINE_IMAGE = "BI";
var OP_END_INLINE_IMAGE = "EI";
var OP_INVOKE_XOBJECT = "Do";

function PDFTokenizer(document, input) {
    this.document = document;
    this.input = input;    
}

PDFTokenizer.prototype.tokenize = function() {
    // lazy route is to read it all at once.
    var stream = this.document.reader.startReadingFromStream(this.input);
    var inputDictionary = this.input.getDictionary();

    var length = this.document.reader.queryDictionaryObject(inputDictionary, "Length").value;
    var bytes = stream.read(length);
    var string = Buffer.from(bytes).toString();

    // I guess we can split this by newlines.
    var operators = string.split("\n");
    console.log(operators);
}
    
exports.PDFTokenizer = PDFTokenizer;
})();
