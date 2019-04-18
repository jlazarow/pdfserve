/*\
  title: $:/plugins/jlazarow/pdfserve/pdf-graphic-picker.js
type: application/javascript
module-type: widget

Provides an "overview" widget.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var PDFGraphicPickerWidget = function(parseTreeNode, options) {
    this.initialise(parseTreeNode, options);
};

/*
Inherit from the base widget class
*/
PDFGraphicPickerWidget.prototype = new Widget();

/*
Render this widget into the DOM
*/

var PREFIX = "Draft of ";
var THUMBS_LIST_PREFIX = "thumbs-page-";
    
PDFGraphicPickerWidget.prototype.render = function(parent, nextSibling) {
    this.parentDomNode = parent;
    this.computeAttributes();
    this.execute();

    console.log("PDFGraphicPickerWidget running");
    
    // Render it into a span
    var outer = this.document.createElement("div");
    var target = this.getVariable("targetTiddler");
    // OK, this is super hacky.
    // remove the "Draft of ''".
    var tiddlerName = target.substring(PREFIX.length + 1, target.length - 1);        
    console.log("running picker on tiddler " + tiddlerName);

    var targetTiddler = this.wiki.getTiddler(tiddlerName);
    if (!("pdf" in targetTiddler.fields)) {
        
        outer.innerHTML = "No PDF associated";
        parent.insertBefore(outer, nextSibling);
        this.domNodes.push(outer);
        return;
    }

    // Ask the PDF store for this tiddler.
    var pdfName = targetTiddler.fields["pdf"];
    var pdf = $tw.pdfs.getPDF(pdfName);

    var pageLabel = this.document.createElement("span");
    pageLabel.innerHTML = "Page: "; // todo: margin this.
    outer.appendChild(pageLabel);
    
    var selectPage = this.document.createElement("select");
    var thumbnailLists = [];
    for (let pageIndex = 0; pageIndex < pdf.metadata.pages; pageIndex++) {
        let pageOption = this.document.createElement("option");
        pageOption.value = pageIndex;
        pageOption.innerHTML = (pageIndex + 1).toString();

        selectPage.appendChild(pageOption);

        // list-style: none
        // selectPageParts.push("<option value=\"" + pageIndex + "\">" +  + "</option>");
        // let bodyParts = ["<ul>"];
        let thumbnailList = this.document.createElement("ul");
        thumbnailList.style.listStyle = "none";

        // show these as needed.
        if (pageIndex > 0) {
            thumbnailList.style.display = "none";
        }
        
        thumbnailList.id = THUMBS_LIST_PREFIX + pageIndex;
        
        let pageThumbnails = pdf.getThumbnails(pageIndex);
        let thumbnailKeys = Object.keys(pageThumbnails);
        for (let thumbnailIndex = 0; thumbnailIndex < thumbnailKeys.length; thumbnailIndex++) {
            let thumbnailKey = thumbnailKeys[thumbnailIndex];
            let thumbnailValue = pageThumbnails[thumbnailKey];

            let thumbnailImage = this.document.createElement("input");
            thumbnailImage.style.height = "auto";
            thumbnailImage.style.width = "auto";
            thumbnailImage.type = "image";
            thumbnailImage.src = thumbnailValue;
            thumbnailImage.addEventListener("click", function(event) {                
	        this.dispatchEvent({
		    type: "tm-edit-text-operation",
		    param: "replace-selection",
		    paramObject: {
                        "text": ":[](pdf://" + pdfName + "/" + "page" + "/" + pageIndex + "/" + "resource" + "/" + thumbnailKey + ")",
                    },
		    tiddlerTitle: target,
		    navigateFromTitle: this.getVariable("storyTiddler"),
		    event: event
	        });

                // now we want to close the dropdown.
	        this.dispatchEvent({
		    type: "delete-tiddler",
                    param: null,
		    paramObject: {
                        "tiddler": this.getVariable("dropdown-state"),
                    },
		    tiddlerTitle: target,
		    navigateFromTitle: this.getVariable("storyTiddler"),
		    event: event
	        });
                
            }.bind(this));

            var thumbnailItem = this.document.createElement("li");
            thumbnailItem.appendChild(thumbnailImage);
            thumbnailList.appendChild(thumbnailItem);
        }

        thumbnailLists.push(thumbnailList);
    }

    this.selectedPageIndex = 0;

    selectPage.addEventListener("change", function(event) {
        let nextPageIndex = event.target.value;
        console.log("selected page " + nextPageIndex);

        let currentThumbnailsElement = this.document.getElementById(THUMBS_LIST_PREFIX + this.selectedPageIndex);
        currentThumbnailsElement.style.display = "none";
        let nextThumbnailsElement = this.document.getElementById(THUMBS_LIST_PREFIX + nextPageIndex);
        nextThumbnailsElement.style.display = "inherit";
        
        this.selectedPageIndex = nextPageIndex;
    }.bind(this));    

    outer.appendChild(selectPage);
    for (let thumbnailListIndex = 0; thumbnailListIndex < thumbnailLists.length; thumbnailListIndex++) {
        outer.appendChild(thumbnailLists[thumbnailListIndex]);
    }
    
    parent.insertBefore(outer, nextSibling);
    this.domNodes.push(outer);    
};

/*
Compute the internal state of the widget
*/
PDFGraphicPickerWidget.prototype.execute = function() {
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/

PDFGraphicPickerWidget.prototype.refresh = function(changedTiddlers) {
    this.execute();

    return true;
};

exports["pdf-graphic-picker"] = PDFGraphicPickerWidget;
    
})();
