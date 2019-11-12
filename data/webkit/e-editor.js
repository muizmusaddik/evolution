/* -*- Mode: C; tab-width: 8; indent-tabs-mode: t; c-basic-offset: 8 -*- */
/*
 * Copyright (C) 2019 Red Hat (www.redhat.com)
 *
 * This library is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation.
 *
 * This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this library. If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

/* semi-convention: private functions start with lower-case letter,
   public functions start with upper-case letter. */

var EvoEditor = {
	E_CONTENT_EDITOR_ALIGNMENT_NONE : -1,
	E_CONTENT_EDITOR_ALIGNMENT_LEFT : 0,
	E_CONTENT_EDITOR_ALIGNMENT_CENTER : 1,
	E_CONTENT_EDITOR_ALIGNMENT_RIGHT : 2,
	E_CONTENT_EDITOR_ALIGNMENT_JUSTIFY : 3,

	E_CONTENT_EDITOR_BLOCK_FORMAT_NONE : 0,
	E_CONTENT_EDITOR_BLOCK_FORMAT_PARAGRAPH : 1,
	E_CONTENT_EDITOR_BLOCK_FORMAT_PRE : 2,
	E_CONTENT_EDITOR_BLOCK_FORMAT_ADDRESS : 3,
	E_CONTENT_EDITOR_BLOCK_FORMAT_H1 : 4,
	E_CONTENT_EDITOR_BLOCK_FORMAT_H2 : 5,
	E_CONTENT_EDITOR_BLOCK_FORMAT_H3 : 6,
	E_CONTENT_EDITOR_BLOCK_FORMAT_H4 : 7,
	E_CONTENT_EDITOR_BLOCK_FORMAT_H5 : 8,
	E_CONTENT_EDITOR_BLOCK_FORMAT_H6 : 9,
	E_CONTENT_EDITOR_BLOCK_FORMAT_UNORDERED_LIST : 10,
	E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST : 11,
	E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST_ROMAN : 12,
	E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST_ALPHA : 13,

	/* Flags for ClaimAffectedContent() */
	CLAIM_CONTENT_FLAG_NONE : 0,
	CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE : 1 << 0,
	CLAIM_CONTENT_FLAG_SAVE_HTML : 1 << 1,

	TEXT_INDENT_SIZE : 3, /* in characters */

	FORCE_NO : 0,
	FORCE_YES : 1,
	FORCE_MAYBE : 2,

	htmlFormat : false,
	storedSelection : null,
	forceFormatStateUpdate : false,
	formattingState : {
		baseElement : null, // to avoid often notifications when just moving within the same node
		bold : false,
		italic : false,
		underline : false,
		strikethrough : false,
		script : 0, // -1..subscript, 0..normal, +1..superscript
		blockFormat : -1,
		alignment : -1,
		fgColor : null,
		bgColor : null,
		fontSize : null,
		fontFamily : null,
		indented : false,
		bodyFgColor : null,
		bodyBgColor : null,
		bodyLinkColor : null,
		bodyVlinkColor : null
	}
};

EvoEditor.maybeUpdateFormattingState = function(force)
{
	var baseElem = null;

	if (!document.getSelection().isCollapsed) {
		var commonParent;

		commonParent = EvoEditor.GetCommonParent(document.getSelection().baseNode, document.getSelection().extentNode, true);
		if (commonParent) {
			var child1, child2;

			child1 = EvoEditor.GetDirectChild(commonParent, document.getSelection().baseNode);
			child2 = EvoEditor.GetDirectChild(commonParent, document.getSelection().extentNode);

			if (child1 && (!child2 || (child2 && EvoEditor.GetChildIndex(commonParent, child1) <= EvoEditor.GetChildIndex(commonParent, child2)))) {
				baseElem = document.getSelection().extentNode;
			}
		}
	}

	if (!baseElem)
		baseElem = document.getSelection().baseNode;
	if (!baseElem)
		baseElem = document.body ? document.body.firstElementChild : null;

	if (baseElem && baseElem.nodeType == baseElem.TEXT_NODE)
		baseElem = baseElem.parentElement;

	if (force == EvoEditor.FORCE_NO && EvoEditor.formattingState.baseElement === baseElem) {
		return;
	}

	force = force == EvoEditor.FORCE_YES;

	EvoEditor.formattingState.baseElement = baseElem;

	var changes = {}, nchanges = 0, value, tmp, computedStyle;

	computedStyle = baseElem ? window.getComputedStyle(baseElem) : null;

	value = (computedStyle ? computedStyle.fontWeight : "") == "bold";
	if (value != EvoEditor.formattingState.bold) {
		EvoEditor.formattingState.bold = value;
		changes["bold"] = value;
		nchanges++;
	}

	tmp = computedStyle ? computedStyle.fontStyle : "";

	value = tmp == "italic" || tmp == "oblique";
	if (force || value != EvoEditor.formattingState.italic) {
		EvoEditor.formattingState.italic = value;
		changes["italic"] = value;
		nchanges++;
	}

	tmp = computedStyle ? computedStyle.webkitTextDecorationsInEffect : "";

	value = tmp.search("underline") >= 0;
	if (force || value != EvoEditor.formattingState.underline) {
		EvoEditor.formattingState.underline = value;
		changes["underline"] = value;
		nchanges++;
	}

	value = tmp.search("line-through") >= 0;
	if (force || value != EvoEditor.formattingState.strikethrough) {
		EvoEditor.formattingState.strikethrough = value;
		changes["strikethrough"] = value;
		nchanges++;
	}

	value = computedStyle ? computedStyle.fontFamily : "";
	if (force || value != EvoEditor.formattingState.fontFamily) {
		EvoEditor.formattingState.fontFamily = value;
		changes["fontFamily"] = value;
		nchanges++;
	}

	value = computedStyle ? computedStyle.color : "";
	if (value == "-webkit-standard")
		value = "";
	if (force || value != EvoEditor.formattingState.fgColor) {
		EvoEditor.formattingState.fgColor = value;
		changes["fgColor"] = value;
		nchanges++;
	}

	tmp = (computedStyle ? computedStyle.textAlign : "").toLowerCase();
	if (tmp == "")
		value = EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_NONE;
	else if (tmp == "left" || tmp == "start")
		value = EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_LEFT;
	else if (tmp == "right")
		value = EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_RIGHT;
	else if (tmp == "center")
		value = EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_CENTER;
	else if (tmp == "justify")
		value = EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_JUSTIFY;
	else
		value = EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_NONE;

	if (force || value != EvoEditor.formattingState.alignment) {
		EvoEditor.formattingState.alignment = value;
		changes["alignment"] = value;
		nchanges++;
	}

	value = document.body.text;
	if (force || value != EvoEditor.formattingState.bodyFgColor) {
		EvoEditor.formattingState.bodyFgColor = value;
		changes["bodyFgColor"] = value;
		nchanges++;
	}

	value = document.body.bgColor;
	if (force || value != EvoEditor.formattingState.bodyBgColor) {
		EvoEditor.formattingState.bodyBgColor = value;
		changes["bodyBgColor"] = value;
		nchanges++;
	}

	value = document.body.link;
	if (force || value != EvoEditor.formattingState.bodyLinkColor) {
		EvoEditor.formattingState.bodyLinkColor = value;
		changes["bodyLinkColor"] = value;
		nchanges++;
	}

	value = document.body.vLink;
	if (force || value != EvoEditor.formattingState.bodyVlinkColor) {
		EvoEditor.formattingState.bodyVlinkColor = value;
		changes["bodyVlinkColor"] = value;
		nchanges++;
	}

	var parent, obj = {
		script : 0,
		blockFormat : null,
		fontSize : null,
		indented : null,
		bgColor : null
	};

	for (parent = baseElem; parent && !(parent == document.body) && (
	     obj.script == 0 || obj.blockFormat == null || obj.fontSize == null || obj.indented == null ||obj.bgColor == null);
	     parent = parent.parentElement) {
		if (obj.script == 0) {
			if (parent.tagName == "SUB")
				obj.script = -1;
			else if (parent.tagName == "SUP")
				obj.script = +1;
		}

		if (obj.blockFormat == null) {
			if (parent.tagName == "DIV")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_PARAGRAPH;
			else if (parent.tagName == "PRE")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_PRE;
			else if (parent.tagName == "ADDRESS")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ADDRESS;
			else if (parent.tagName == "H1")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H1;
			else if (parent.tagName == "H2")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H2;
			else if (parent.tagName == "H3")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H3;
			else if (parent.tagName == "H4")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H4;
			else if (parent.tagName == "H5")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H5;
			else if (parent.tagName == "H6")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H6;
			else if (parent.tagName == "UL")
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_UNORDERED_LIST;
			else if (parent.tagName == "OL") {
				obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST;

				var typeAttr = parent.getAttribute("type");

				if (typeAttr && typeAttr.toUpperCase() == "I")
					obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST_ROMAN;
				else if (typeAttr && typeAttr.toUpperCase() == "A")
					obj.blockFormat = EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST_ALPHA;
			}
		}

		if (obj.fontSize == null && parent.tagName == "FONT" && parent.hasAttribute("size")) {
			value = parent.getAttribute("size");
			value = value ? parseInt(value, 10) : 0;
			if (Number.isInteger(value) && value >= 1 && value <= 7) {
				obj.fontSize = value;
			}
		}

		if (obj.indented == null) {
			var dir = window.getComputedStyle(parent).direction;

			if (dir == "rtl") {
				tmp = parent.style.marginRight;
				if (tmp && tmp.endsWith("ch")) {
					tmp = parseInt(tmp.slice(0, -2));
				} else {
					tmp = "";
				}
			} else { // "ltr" or other
				tmp = parent.style.marginLeft;
				if (tmp && tmp.endsWith("ch")) {
					tmp = parseInt(tmp.slice(0, -2));
				} else {
					tmp = "";
				}
			}

			if (Number.isInteger(tmp)) {
				obj.indented = tmp > 0;
			}
		}

		if (obj.bgColor == null && parent.style.backgroundColor != "") {
			obj.bgColor = parent.style.backgroundColor;
		}
	}

	value = obj.script;
	if (force || value != EvoEditor.formattingState.script) {
		EvoEditor.formattingState.script = value;
		changes["script"] = value;
		nchanges++;
	}

	value = obj.blockFormat == null ? EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_PARAGRAPH : obj.blockFormat;
	if (force || value != EvoEditor.formattingState.blockFormat) {
		EvoEditor.formattingState.blockFormat = value;
		changes["blockFormat"] = value;
		nchanges++;
	}

	value = obj.fontSize;
	if (force || value != EvoEditor.formattingState.fontSize) {
		EvoEditor.formattingState.fontSize = value;
		changes["fontSize"] = value;
		nchanges++;
	}

	value = obj.indented == null ? false : obj.indented;
	if (force || value != EvoEditor.formattingState.indented) {
		EvoEditor.formattingState.indented = value;
		changes["indented"] = value;
		nchanges++;
	}

	value = obj.bgColor ? obj.bgColor : computedStyle.backgroundColor;
	if (force || value != EvoEditor.formattingState.bgColor) {
		EvoEditor.formattingState.bgColor = value;
		changes["bgColor"] = value;
		nchanges++;
	}

	if (force) {
		changes["forced"] = true;
		nchanges++;
	}

	if (nchanges > 0)
		window.webkit.messageHandlers.formattingChanged.postMessage(changes);
}

EvoEditor.IsBlockNode = function(node)
{
	if (!node || !node.tagName) {
		return false;
	}

	return node.tagName == "BLOCKQUOTE" ||
		node.tagName == "DIV" ||
		node.tagName == "P" ||
		node.tagName == "PRE" ||
		node.tagName == "ADDRESS" ||
		node.tagName == "H1" ||
		node.tagName == "H2" ||
		node.tagName == "H3" ||
		node.tagName == "H4" ||
		node.tagName == "H5" ||
		node.tagName == "H6" ||
		node.tagName == "TD" ||
		node.tagName == "TH" ||
		node.tagName == "UL" ||
		node.tagName == "OL";
}

EvoEditor.foreachChildRecur = function(topParent, parent, firstChildIndex, lastChildIndex, traversar)
{
	if (!parent) {
		return false;
	}

	if (firstChildIndex >= parent.children.length) {
		return true;
	}

	var ii, child, next;

	ii = lastChildIndex - firstChildIndex;
	child = parent.children.item(firstChildIndex);

	while (child && ii >= 0) {
		next = child.nextElementSibling;

		if (!traversar.onlyBlockElements || EvoEditor.IsBlockNode(child)) {
			if (!traversar.exec(topParent, child)) {
				return false;
			}
		}

		if (child.children.length > 0 &&
		    !traversar.flat &&
		    !EvoEditor.foreachChildRecur(topParent, child, 0, child.children.length - 1, traversar)) {
			return false;
		}

		child = next;
		ii--;
	}

	return true;
}

/*
   Traverses children of the 'parent', between the 'firstChildIndex' and
   the 'lastChildIndex', where both indexes are meant inclusive.

   The 'traversar' is an object, which should contain at least function:

      bool exec(parent, element);

   which does its work in the 'element' and returns true, when the traversar
   should continue. The 'parent' is the one with which the funcion had been
   called with. The 'traversar' can also contain properties:

      bool flat;
      bool onlyBlockElements;

   the 'flat', if set to true, traverses only direct children of the parent,
   otherwise it dives into the hierarchy;

   the 'onlyBlockElements', if set to true, calls exec() only on elements,
   which are block elements (as of EvoEditor.IsBlockNode()), otherwise it
   is called for each element on the way.
*/
EvoEditor.ForeachChild = function(parent, firstChildIndex, lastChildIndex, traversar)
{
	return EvoEditor.foreachChildRecur(parent, parent, firstChildIndex, lastChildIndex, traversar);
}

EvoEditor.GetCommonParent = function(firstNode, secondNode, longPath)
{
	if (!firstNode || !secondNode) {
		return null;
	}

	if (firstNode.nodeType == firstNode.TEXT_NODE) {
		firstNode = firstNode.parentElement;
	}

	if (secondNode.nodeType == secondNode.TEXT_NODE) {
		secondNode = secondNode.parentElement;
	}

	if (!firstNode || !secondNode) {
		return null;
	}

	if (firstNode === document.body || secondNode === document.body) {
		return document.body;
	}

	var commonParent, secondParent;

	for (commonParent = (longPath ? firstNode : firstNode.parentElement); commonParent; commonParent = commonParent.parentElement) {
		if (commonParent === document.body) {
			break;
		}

		for (secondParent = (longPath ? secondNode : secondNode.parentElement); secondParent; secondParent = secondParent.parentElement) {
			if (secondParent === document.body) {
				break;
			}

			if (secondParent === commonParent) {
				return commonParent;
			}
		}
	}

	return document.body;
}

EvoEditor.GetDirectChild = function(parent, child)
{
	if (!parent || !child || parent === child) {
		return null;
	}

	while (child && !(child.parentElement === parent)) {
		child = child.parentElement;
	}

	return child;
}

EvoEditor.GetChildIndex = function(parent, child)
{
	if (!parent || !child)
		return -1;

	var ii;

	for (ii = 0; ii < parent.children.length; ii++) {
		if (child === parent.children.item(ii))
			return ii;
	}

	return -1;
}

EvoEditor.ClaimAffectedContent = function(startNode, endNode, flags)
{
	var commonParent, startChild, endChild;
	var firstChildIndex = -1, html = "", ii;
	var withHtml = (flags & EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML) != 0;

	if (!startNode) {
		startNode = document.getSelection().baseNode;
		endNode = document.getSelection().extentNode;

		if (!startNode) {
			startNode = document.body;
		}
	}

	if (!endNode) {
		endNode = document.getSelection().extentNode;

		if (!endNode)
			endNode = startNode;
	}

	if ((flags & EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE) != 0) {
		while (startNode && !(startNode === document.body)) {
			if (EvoEditor.IsBlockNode(startNode)) {
				break;
			}

			startNode = startNode.parentElement;
		}
	}

	commonParent = EvoEditor.GetCommonParent(startNode, endNode, false);
	startChild = EvoEditor.GetDirectChild(commonParent, startNode);
	endChild = EvoEditor.GetDirectChild(commonParent, endNode);

	for (ii = 0 ; ii < commonParent.children.length; ii++) {
		var child = commonParent.children.item(ii);

		if (firstChildIndex == -1) {
			/* The selection can be made both from the top to the bottom and
			   from the bottom to the top, thus cover both cases. */
			if (child === startChild) {
				firstChildIndex = ii;
			} else if (child === endChild) {
				endChild = startChild;
				startChild = child;
				firstChildIndex = ii;
			}
		}

		if (firstChildIndex != -1) {
			if (withHtml) {
				html += child.outerHTML;
			}

			if (child === endChild) {
				ii++;
				break;
			}
		}
	}

	var affected = {};

	affected.path = EvoSelection.GetChildPath(document.body, commonParent);
	affected.firstChildIndex = firstChildIndex;
	affected.restChildrenCount = commonParent.children.length - ii;

	if (withHtml) {
		if (firstChildIndex == -1)
			affected.html = commonParent.innerHTML;
		else
			affected.html = html;
	}

	return affected;
}

/* Calls EvoEditor.ForeachChild() on a content described by 'affected',
   which is result of EvoEditor.ClaimAffectedContent(). */
EvoEditor.ForeachChildInAffectedContent = function(affected, traversar)
{
	if (!affected || !traversar) {
		throw "EvoEditor.ForeachChildInAffectedContent: No 'affected' or 'traversar'";
	}

	var parent, firstChildIndex, lastChildIndex;

	parent = EvoSelection.FindElementByPath(document.body, affected.path);
	if (!parent) {
		throw "EvoEditor.ForeachChildInAffectedContent: Cannot find parent";
	}

	firstChildIndex = affected.firstChildIndex;
	/* Cannot subtract one, when none left, because the child index is inclusive */
	lastChildIndex = parent.children.length - affected.restChildrenCount + (affected.restChildrenCount ? -1 : 0);

	return EvoEditor.ForeachChild(parent, firstChildIndex, lastChildIndex, traversar);
}

EvoEditor.EmitContentChanged = function()
{
	if (window.webkit.messageHandlers.contentChanged)
		window.webkit.messageHandlers.contentChanged.postMessage(null);
}

EvoEditor.StoreSelection = function()
{
	EvoEditor.storedSelection = EvoSelection.Store(document);
}

EvoEditor.RestoreSelection = function()
{
	if (EvoEditor.storedSelection) {
		EvoSelection.Restore(document, EvoEditor.storedSelection);
		EvoEditor.storedSelection = null;
	}
}

EvoEditor.applySetAlignment = function(record, isUndo)
{
	if (record.changes) {
		var ii, parent, child;

		parent = EvoSelection.FindElementByPath(document.body, record.path);
		if (!parent) {
			throw "EvoEditor.applySetAlignment: Cannot find parent at path " + record.path;
		}

		for (ii = 0; ii < record.changes.length; ii++) {
			var change = record.changes[ii];

			child = EvoSelection.FindElementByPath(parent, change.path);
			if (!child) {
				throw "EvoEditor.applySetAlignment: Cannot find child";
			}

			child.style.textAlign = isUndo ? change.before : record.applyValueAfter;
		}
	}
}

EvoEditor.SetAlignment = function(alignment)
{
	var traversar = {
		record : null,
		toSet : null,
		anyChanged : false,

		flat : false,
		onlyBlockElements : true,

		exec : function(parent, element) {
			if (window.getComputedStyle(element, null).textAlign != traversar.toSet) {
				if (traversar.record) {
					if (!traversar.record.changes)
						traversar.record.changes = [];

					var change = {};

					change.path = EvoSelection.GetChildPath(parent, element);
					change.before = element.style.textAlign;

					traversar.record.changes[traversar.record.changes.length] = change;
				}

				traversar.anyChanged = true;
				element.style.textAlign = traversar.toSet;
			}

			return true;
		}
	};

	var affected = EvoEditor.ClaimAffectedContent(null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	switch (alignment) {
	case EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_NONE:
		traversar.toSet = "";
		break;
	case EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_LEFT:
		traversar.toSet = "left";
		break;
	case EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_CENTER:
		traversar.toSet = "center";
		break;
	case  EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_RIGHT:
		traversar.toSet = "right";
		break;
	case EvoEditor.E_CONTENT_EDITOR_ALIGNMENT_JUSTIFY:
		traversar.toSet = "justify";
		break;
	default:
		throw "EvoEditor.SetAlignment: Unknown alignment value: '" + alignment + "'";
	}

	traversar.record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setAlignment", null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	try {
		EvoEditor.ForeachChildInAffectedContent(affected, traversar);

		if (traversar.record) {
			traversar.record.applyValueAfter = traversar.toSet;
			traversar.record.apply = EvoEditor.applySetAlignment;
		}
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setAlignment");
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);

		if (traversar.anyChanged)
			EvoEditor.EmitContentChanged();
	}
}

EvoEditor.storeAttributes = function(element)
{
	if (!element || !element.attributes.length)
		return null;

	var attributes = [], ii;

	for (ii = 0; ii < element.attributes.length; ii++) {
		var attr = {
			name : element.attributes.item(ii).name,
			value : element.attributes.item(ii).value
		};

		attributes[attributes.length] = attr;
	}

	return attributes;
}

EvoEditor.restoreAttributes = function(element, attributes)
{
	if (!element)
		return;

	while (element.attributes.length) {
		element.removeAttribute(element.attributes.item(element.attributes.length - 1).name);
	}

	if (!attributes)
		return;

	var ii;

	for (ii = 0; ii < attributes.length; ii++) {
		element.setAttribute(attributes[ii].name, attributes[ii].value);
	}
}

EvoEditor.storeElement = function(element)
{
	if (!element)
		return null;

	var elementRecord = {
		tagName : element.tagName,
		attributes : EvoEditor.storeAttributes(element)
	};

	return elementRecord;
}

EvoEditor.restoreElement = function(parentElement, beforeElement, tagName, attributes)
{
	if (!parentElement)
		throw "EvoEditor.restoreElement: parentElement cannot be null";

	if (!tagName)
		throw "EvoEditor.restoreElement: tagName cannot be null";

	var node;

	node = parentElement.ownerDocument.createElement(tagName);

	EvoEditor.restoreAttributes(node, attributes);

	parentElement.insertBefore(node, beforeElement);

	return node;
}

EvoEditor.moveChildren = function(fromElement, toElement, beforeElement, prepareParent)
{
	if (!fromElement)
		throw "EvoEditor.moveChildren: fromElement cannot be null";

	if (beforeElement && toElement && !(beforeElement.parentElement === toElement))
		throw "EvoEditor.moveChildren: beforeElement is not a direct child of toElement";

	var node;

	for (node = toElement; node; node = node.parentElement) {
		if (node === fromElement)
			throw "EvoEditor.moveChildren: toElement cannot be child of fromElement";
	}

	var firstElement = toElement;

	while (fromElement.firstChild) {
		if (prepareParent && fromElement.firstChild.tagName && fromElement.firstChild.tagName == "LI") {
			var toParent = prepareParent.exec();

			if (toElement) {
				toElement.parentElement.insertBefore(toParent, toElement.nextElementSibling);
			}

			if (!firstElement) {
				firstElement = toParent;
			}

			var li = fromElement.firstChild;

			while (li.firstChild) {
				toParent.append(li.firstChild);
			}

			fromElement.removeChild(fromElement.firstChild);
		} else {
			if (!toElement && prepareParent) {
				toElement = prepareParent.exec();
			}

			if (!firstElement) {
				firstElement = toElement;
			}

			toElement.insertBefore(fromElement.firstChild, beforeElement);
		}
	}

	return firstElement;
}

EvoEditor.renameElement = function(element, tagName, attributes, targetElement)
{
	var prepareParent = {
		element : element,
		tagName : tagName,
		attributes : attributes,
		targetElement : targetElement,

		exec : function() {
			if (targetElement)
				return EvoEditor.restoreElement(prepareParent.targetElement, null, prepareParent.tagName, prepareParent.attributes);
			else
				return EvoEditor.restoreElement(prepareParent.element.parentElement, prepareParent.element, prepareParent.tagName, prepareParent.attributes);
		}
	};
	var newElement;

	newElement = EvoEditor.moveChildren(element, null, null, prepareParent);

	element.parentElement.removeChild(element);

	return newElement;
}

EvoEditor.SetBlockFormat = function(format)
{
	var traversar = {
		toSet : null,
		createParent : null,
		firstLI : true,
		targetElement : null,
		selectionBaseNode : null,
		selectionBaseOffset : -1,
		selectionExtentNode : null,
		selectionExtentOffset : -1,

		flat : true,
		onlyBlockElements : true,

		exec : function(parent, element) {
			var newElement, changeBase = false, changeExtent = false;

			if (traversar.selectionBaseNode) {
				changeBase = element === traversar.selectionBaseNode ||
					(traversar.selectionBaseNode.noteType == traversar.selectionBaseNode.TEXT_NODE &&
					 traversar.selectionBaseNode.parentElement === element);
			}

			if (traversar.selectionExtentNode) {
				changeExtent = element === traversar.selectionExtentNode ||
					(traversar.selectionExtentNode.noteType == traversar.selectionExtentNode.TEXT_NODE &&
					 traversar.selectionExtentNode.parentElement === element);
			}

			if (traversar.firstLI) {
				if (traversar.createParent) {
					traversar.targetElement = EvoEditor.restoreElement(parent, element, traversar.createParent.tagName, traversar.createParent.attributes);
				}

				traversar.firstLI = false;
			}

			newElement = EvoEditor.renameElement(element, traversar.toSet.tagName, traversar.toSet.attributes, traversar.targetElement);

			if (changeBase)
				traversar.selectionBaseNode = newElement;

			if (changeExtent)
				traversar.selectionExtentNode = newElement;

			return true;
		}
	};

	var affected = EvoEditor.ClaimAffectedContent(null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	switch (format) {
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_PARAGRAPH:
		traversar.toSet = { tagName : "DIV" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_PRE:
		traversar.toSet = { tagName : "PRE" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ADDRESS:
		traversar.toSet = { tagName : "ADDRESS" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H1:
		traversar.toSet = { tagName : "H1" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H2:
		traversar.toSet = { tagName : "H2" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H3:
		traversar.toSet = { tagName : "H3" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H4:
		traversar.toSet = { tagName : "H4" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H5:
		traversar.toSet = { tagName : "H5" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_H6:
		traversar.toSet = { tagName : "H6" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_UNORDERED_LIST:
		traversar.toSet = { tagName : "LI" };
		traversar.createParent = { tagName : "UL" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST:
		traversar.toSet = { tagName : "LI" };
		traversar.createParent = { tagName : "OL" };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST_ROMAN:
		traversar.toSet = { tagName : "LI" };
		traversar.createParent = { tagName : "OL", attributes : [ { name : "type", value : "I" } ] };
		break;
	case EvoEditor.E_CONTENT_EDITOR_BLOCK_FORMAT_ORDERED_LIST_ALPHA:
		traversar.toSet = { tagName : "LI" };
		traversar.createParent = { tagName : "OL", attributes : [ { name : "type", value : "A" } ] };
		break;
	default:
		throw "EvoEditor.SetBlockFormat: Unknown block format value: '" + format + "'";
	}

	var selectionBefore = EvoSelection.Store(document);

	EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBlockFormat", null, null,
		EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE | EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML);

	traversar.selectionBaseNode = document.getSelection().baseNode;
	traversar.selectionBaseOffset = document.getSelection().baseOffset;
	if (!document.getSelection().isCollapsed) {
		traversar.selectionExtentNode = document.getSelection().extentNode;
		traversar.selectionExtentOffset = document.getSelection().extentOffset;
	}

	try {
		EvoEditor.ForeachChildInAffectedContent(affected, traversar);

		if (traversar.selectionBaseNode && traversar.selectionBaseNode.parentElement) {
			var selection = {
				baseElem : EvoSelection.GetChildPath(document.body, traversar.selectionBaseNode),
				baseOffset : traversar.selectionBaseOffset
			};

			if (traversar.selectionExtentNode) {
				selection.extentElem = EvoSelection.GetChildPath(document.body, traversar.selectionExtentNode);
				selection.extentOffset = traversar.selectionExtentOffset;
			}

			EvoSelection.Restore(document, selection);
		} else {
			EvoSelection.Restore(document, selectionBefore);
		}
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBlockFormat");
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
		EvoEditor.EmitContentChanged();
	}
}

EvoEditor.applyIndent = function(record, isUndo)
{
	if (record.changes) {
		var ii, parent, child;

		parent = EvoSelection.FindElementByPath(document.body, record.path);
		if (!parent) {
			throw "EvoEditor.applyIndent: Cannot find parent at path " + record.path;
		}

		for (ii = 0; ii < record.changes.length; ii++) {
			var change = record.changes[ii];

			child = EvoSelection.FindElementByPath(parent, change.path);
			if (!child) {
				throw "EvoEditor.applyIndent: Cannot find child";
			}

			if (isUndo) {
				child.style.marginLeft = change.beforeMarginLeft;
				child.style.marginRight = change.beforeMarginRight;
			} else {
				child.style.marginLeft = change.afterMarginLeft;
				child.style.marginRight = change.afterMarginRight;
			}
		}
	}
}

EvoEditor.Indent = function(increment)
{
	var traversar = {
		record : null,
		increment : increment,

		flat : false,
		onlyBlockElements : true,

		exec : function(parent, element) {
			var change = null;

			if (traversar.record) {
				if (!traversar.record.changes)
					traversar.record.changes = [];

				change = {};
				change.path = EvoSelection.GetChildPath(parent, element);
				change.beforeMarginLeft = element.style.marginLeft;
				change.beforeMarginRight = element.style.marginRight;

				traversar.record.changes[traversar.record.changes.length] = change;
			}

			var currValue = null, dir;

			dir = window.getComputedStyle(element).direction;

			if (dir == "rtl") {
				if (element.style.marginRight.endsWith("ch"))
					currValue = element.style.marginRight;
			} else { // "ltr" or other
				if (element.style.marginLeft.endsWith("ch"))
					currValue = element.style.marginLeft;
			}

			if (!currValue) {
				currValue = 0;
			} else {
				currValue = parseInt(currValue.slice(0, -2));
				if (!Number.isInteger(currValue))
					currValue = 0;
			}

			if (traversar.increment) {
				currValue = (currValue + EvoEditor.TEXT_INDENT_SIZE) + "ch";
			} else if (currValue > EvoEditor.TEXT_INDENT_SIZE) {
				currValue = (currValue - EvoEditor.TEXT_INDENT_SIZE) + "ch";
			} else if (currValue > 0) {
				currValue = "";
			}

			if (dir == "rtl") {
				element.style.marginRight = currValue;
			} else { // "ltr" or other
				element.style.marginLeft = currValue;
			}

			if (change) {
				change.afterMarginLeft = element.style.marginLeft;
				change.afterMarginRight = element.style.marginRight;
			}

			return true;
		}
	};

	var affected = EvoEditor.ClaimAffectedContent(null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	traversar.record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, increment ? "Indent" : "Outdent", null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	try {
		EvoEditor.ForeachChildInAffectedContent(affected, traversar);

		if (traversar.record) {
			traversar.record.applyIncrement = increment;
			traversar.record.apply = EvoEditor.applyIndent;
		}
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, increment ? "Indent" : "Outdent");
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
		EvoEditor.EmitContentChanged();
	}
}

EvoEditor.InsertHTML = function(opType, html)
{
	EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_GROUP, opType, null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE | EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML);
	try {
		document.execCommand("insertHTML", false, html);
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_GROUP, opType);
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
		EvoEditor.EmitContentChanged();
	}
}

EvoEditor.applySetBodyAttribute = function(record, isUndo)
{
	if (isUndo) {
		if (record.beforeValue)
			document.body.setAttribute(record.attrName, record.beforeValue);
		else
			document.body.removeAttribute(record.attrName);
	} else {
		if (record.attrValue)
			document.body.setAttribute(record.attrName, record.attrValue);
		else
			document.body.removeAttribute(record.attrName);
	}
}

EvoEditor.SetBodyAttribute = function(name, value)
{
	var record;

	record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBodyAttribute::" + name, document.body, document.body, EvoEditor.CLAIM_CONTENT_FLAG_NONE);

	try {
		if (record) {
			record.attrName = name;
			record.attrValue = value;
			record.beforeValue = document.body.getAttribute(name);
			record.apply = EvoEditor.applySetBodyAttribute;
		}

		if (value)
			document.body.setAttribute(name, value);
		else
			document.body.removeAttribute(name);
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBodyAttribute::" + name);
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
		EvoEditor.EmitContentChanged();
	}
}

EvoEditor.initializeContent = function()
{
	if (document.body) {
		if (!document.body.firstChild) {
			EvoUndoRedo.Disable();
			try {
				document.body.innerHTML = "<div><br></div>";
			} finally {
				EvoUndoRedo.Enable();
			}
		}

		/* Make sure there is a selection */
		if (!document.getSelection().baseNode) {
			document.getSelection().setPosition(document.body.firstChild ? document.body.firstChild : document.body, 0);
		}
	}
}

document.onload = EvoEditor.initializeContent;

document.onselectionchange = function() {
	EvoEditor.maybeUpdateFormattingState(EvoEditor.forceFormatStateUpdate ? EvoEditor.FORCE_YES : EvoEditor.FORCE_MAYBE);
	EvoEditor.forceFormatStateUpdate = false;
};

EvoEditor.initializeContent();
