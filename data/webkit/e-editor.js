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

	E_CONTENT_EDITOR_GET_INLINE_IMAGES : 1 << 0,
	E_CONTENT_EDITOR_GET_RAW_BODY_HTML : 1 << 1,
	E_CONTENT_EDITOR_GET_RAW_BODY_PLAIN : 1 << 2,
	E_CONTENT_EDITOR_GET_RAW_BODY_STRIPPED : 1 << 3,
	E_CONTENT_EDITOR_GET_RAW_DRAFT : 1 << 4,
	E_CONTENT_EDITOR_GET_TO_SEND_HTML : 1 << 5,
	E_CONTENT_EDITOR_GET_TO_SEND_PLAIN : 1 << 6,

	/* Flags for ClaimAffectedContent() */
	CLAIM_CONTENT_FLAG_NONE : 0,
	CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE : 1 << 0,
	CLAIM_CONTENT_FLAG_SAVE_HTML : 1 << 1,

	TEXT_INDENT_SIZE : 3, // in characters
	NORMAL_PARAGRAPH_WIDTH : 71,

	FORCE_NO : 0,
	FORCE_YES : 1,
	FORCE_MAYBE : 2,

	MODE_PLAIN_TEXT : 0,
	MODE_HTML : 1,

	mode : 1, // one of the MODE constants
	storedSelection : null,
	inheritThemeColors : false,
	checkInheritFontsOnChange : false,
	forceFormatStateUpdate : false,
	formattingState : {
		mode : -1,
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
		bodyVlinkColor : null,
		bodyFontFamily : null
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

	if (force == EvoEditor.FORCE_NO && EvoEditor.formattingState.baseElement === baseElem && EvoEditor.mode == EvoEditor.formattingState.mode) {
		return;
	}

	force = force == EvoEditor.FORCE_YES;

	EvoEditor.formattingState.baseElement = baseElem;

	var changes = {}, nchanges = 0, value, tmp, computedStyle;

	value = EvoEditor.mode;
	if (value != EvoEditor.formattingState.mode) {
		EvoEditor.formattingState.mode = value;
		changes["mode"] = value;
		nchanges++;
	}

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
		changes["fontFamily"] = (window.getComputedStyle(document.body).fontFamily == value) ? "" : value;
		nchanges++;
	}

	value = document.body ? document.body.style.fontFamily : "";
	if (force || value != EvoEditor.formattingState.bodyFontFamily) {
		EvoEditor.formattingState.bodyFontFamily = value;
		changes["bodyFontFamily"] = value;
		nchanges++;
	}

	value = computedStyle ? computedStyle.color : "";
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

			if (parent.tagName == "UL" || parent.tagName == "OL")
				obj.indented = true;
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

		if (child.children.length > 0 &&
		    !traversar.flat &&
		    !EvoEditor.foreachChildRecur(topParent, child, 0, child.children.length - 1, traversar)) {
			return false;
		}

		if (!traversar.onlyBlockElements || EvoEditor.IsBlockNode(child)) {
			if (!traversar.exec(topParent, child)) {
				return false;
			}
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

EvoEditor.removeEmptyStyleAttribute = function(element)
{
	if (element && !element.style.length)
		element.removeAttribute("style");
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
			var change = record.changes[isUndo ? (record.changes.length - ii - 1) : ii];

			child = EvoSelection.FindElementByPath(parent, change.path);
			if (!child) {
				throw "EvoEditor.applySetAlignment: Cannot find child";
			}

			if (isUndo) {
				child.style.textAlign = change.before;
			} else if ((record.applyValueAfter == "left" && child.style.direction != "rtl" && window.getComputedStyle(child).direction != "rtl") ||
				   (record.applyValueAfter == "right" && (child.style.direction == "rtl" || window.getComputedStyle(child).direction == "rtl"))) {
				child.style.textAlign = "";
			} else {
				child.style.textAlign = record.applyValueAfter;
			}

			EvoEditor.removeEmptyStyleAttribute(child);
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

				if ((traversar.toSet == "left" && element.style.direction != "rtl" && window.getComputedStyle(element).direction != "rtl") ||
				    (traversar.toSet == "right" && (element.style.direction == "rtl" || window.getComputedStyle(element).direction == "rtl"))) {
					element.style.textAlign = "";
				} else {
					element.style.textAlign = traversar.toSet;
				}

				EvoEditor.removeEmptyStyleAttribute(element);
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

EvoEditor.moveChildren = function(fromElement, toElement, beforeElement, prepareParent, selectionUpdater)
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

			var li = fromElement.firstChild, replacedBy = li.firstChild;

			while (li.firstChild) {
				toParent.append(li.firstChild);
			}

			if (selectionUpdater)
				selectionUpdater.beforeRemove(fromElement.firstChild);

			fromElement.removeChild(fromElement.firstChild);

			if (selectionUpdater)
				selectionUpdater.afterRemove(replacedBy);
		} else {
			if (!toElement && prepareParent) {
				toElement = prepareParent.exec();

				// trying to move other than LI into UL/OL, thus do not enclose it into LI
				if (prepareParent.tagName == "LI" && (fromElement.tagName == "UL" || fromElement.tagName == "OL")) {
					var toParent = toElement.parentElement;
					toParent.removeChild(toElement);
					toElement = toParent;
				}
			}

			if (!firstElement) {
				firstElement = toElement;
			}

			toElement.insertBefore(fromElement.firstChild, beforeElement);
		}
	}

	return firstElement;
}

EvoEditor.renameElement = function(element, tagName, attributes, targetElement, selectionUpdater)
{
	var prepareParent = {
		element : element,
		tagName : tagName,
		attributes : attributes,
		targetElement : targetElement,

		exec : function() {
			if (this.targetElement)
				return EvoEditor.restoreElement(this.targetElement, null, this.tagName, this.attributes);
			else
				return EvoEditor.restoreElement(this.element.parentElement, this.element, this.tagName, this.attributes);
		}
	};
	var newElement;

	newElement = EvoEditor.moveChildren(element, null, null, prepareParent, selectionUpdater);

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
		selectionUpdater : null,

		flat : true,
		onlyBlockElements : true,

		exec : function(parent, element) {
			var newElement;

			if (this.toSet.tagName != "LI" && (element.tagName == "UL" || element.tagName == "OL")) {
				var affected = [];

				if (!EvoEditor.allChildrenInSelection(element, true, affected)) {
					var elemParent = element.parentElement, insBefore, jj;

					if (affected.length > 0 && !(affected[0] === element.firstElementChild)) {
						insBefore = EvoEditor.splitList(element, 1, affected);
					} else {
						insBefore = element;
					}

					for (jj = 0; jj < affected.length; jj++) {
						EvoEditor.insertListChildBefore(affected[jj], this.toSet.tagName, insBefore ? insBefore.parentElement : elemParent, insBefore, this.selectionUpdater);
					}

					if (!element.childElementCount) {
						this.selectionUpdater.beforeRemove(element);

						element.parentElement.removeChild(element);

						this.selectionUpdater.afterRemove(insBefore ? insBefore.previousElementSibling : elemParent.lastElementChild);
					}

					return true;
				}
			}

			if (this.firstLI) {
				if (this.createParent) {
					this.targetElement = EvoEditor.restoreElement(parent, element, this.createParent.tagName, this.createParent.attributes);
				}

				this.firstLI = false;
			}

			newElement = EvoEditor.renameElement(element, this.toSet.tagName, this.toSet.attributes, this.targetElement, this.selectionUpdater);

			if (this.selectionUpdater) {
				this.selectionUpdater.beforeRemove(element);
				this.selectionUpdater.afterRemove(newElement);
			}

			return true;
		}
	};

	traversar.selectionUpdater = EvoSelection.CreateUpdaterObject();

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

	EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBlockFormat", null, null,
		EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE | EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML);

	try {
		EvoEditor.ForeachChildInAffectedContent(affected, traversar);

		traversar.selectionUpdater.restore();
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBlockFormat");
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
		EvoEditor.EmitContentChanged();
	}
}

EvoEditor.allChildrenInSelection = function(element, allowPartial, affected)
{
	if (!element || !element.firstChild)
		return false;

	var selection = document.getSelection(), all;

	all = selection.containsNode(element.firstElementChild, allowPartial) &&
	      selection.containsNode(element.lastElementChild, allowPartial);

	var node;

	affected.length = 0;

	for (node = element.firstElementChild; node; node = node.nextElementSibling) {
		if (all || selection.containsNode(node, allowPartial))
			affected[affected.length] = node;
	}

	return all;
}

EvoEditor.splitList = function(element, nParents, onlyAffected)
{
	var parent, from = null;

	if (onlyAffected && onlyAffected.length)
		from = onlyAffected[onlyAffected.length - 1].nextElementSibling;

	if (!from)
		from = element.nextElementSibling;

	if (nParents == -1) {
		nParents = 0;

		for (parent = from; parent && parent.tagName != "BODY"; parent = parent.parentElement) {
			nParents++;
		}
	}

	var nextFrom, clone;

	parent = from ? from.parentElement : element.parentElement;

	while (nParents > 0 && parent && parent.tagName != "HTML") {
		nParents--;
		nextFrom = null;

		if (from) {
			clone = from.parentElement.cloneNode(false);
			from.parentElement.parentElement.insertBefore(clone, from.parentElement.nextElementSibling);

			nextFrom = clone;

			while (from.nextElementSibling) {
				clone.appendChild(from.nextElementSibling);
			}

			clone.insertBefore(from, clone.firstElementChild);
		}

		from = nextFrom;
		parent = parent.parentElement;
	}

	if (nextFrom)
		return nextFrom;

	return parent.nextElementSibling;
}

EvoEditor.insertListChildBefore = function(child, tagName, parent, insBefore, selectionUpdater)
{
	if (child.tagName == "LI") {
		var node = document.createElement(tagName);

		while(child.firstChild)
			node.appendChild(child.firstChild);

		parent.insertBefore(node, insBefore);

		if (selectionUpdater)
			selectionUpdater.beforeRemove(child);

		child.parentElement.removeChild(child);

		if (selectionUpdater)
			selectionUpdater.afterRemove(node);
	} else {
		parent.insertBefore(child, insBefore);
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
			var change = record.changes[isUndo ? (record.changes.length - ii - 1) : ii];

			child = EvoSelection.FindElementByPath(change.pathIsFromBody ? document.body : parent, change.path);
			if (!child) {
				throw "EvoEditor.applyIndent: Cannot find child";
			}

			if (change.isList) {
				EvoUndoRedo.RestoreChildren(change, child, isUndo);
				continue;
			}

			if (isUndo) {
				child.style.marginLeft = change.beforeMarginLeft;
				child.style.marginRight = change.beforeMarginRight;
			} else {
				child.style.marginLeft = change.afterMarginLeft;
				child.style.marginRight = change.afterMarginRight;
			}

			EvoEditor.removeEmptyStyleAttribute(child);
		}
	}
}

EvoEditor.Indent = function(increment)
{
	var traversar = {
		record : null,
		selectionUpdater : null,
		increment : increment,

		flat : true,
		onlyBlockElements : true,

		exec : function(parent, element) {
			var change = null, isList = element.tagName == "UL" || element.tagName == "OL";
			var isNested = isList && (element.parentElement.tagName == "UL" || element.parentElement.tagName == "OL");

			if (traversar.record) {
				if (!traversar.record.changes)
					traversar.record.changes = [];

				change = {};

				change.pathIsFromBody = false;

				if (isList) {
					change.isList = isList;
					change.path = EvoSelection.GetChildPath(parent, element);
				} else {
					change.path = EvoSelection.GetChildPath(parent, element);
					change.beforeMarginLeft = element.style.marginLeft;
					change.beforeMarginRight = element.style.marginRight;
				}

				traversar.record.changes[traversar.record.changes.length] = change;
			}

			if (isList) {
				var elemParent = null, all, affected = [], jj;

				all = EvoEditor.allChildrenInSelection(element, true, affected);

				if (this.increment) {
					var clone;

					clone = element.cloneNode(false);

					if (all) {
						if (change) {
							var childIndex = EvoEditor.GetChildIndex(element.parentElement, element);
							EvoUndoRedo.BackupChildrenBefore(change, element.parentElement, childIndex, childIndex);
							change.path = EvoSelection.GetChildPath(parent, element.parentElement);
						}

						element.parentElement.insertBefore(clone, element);
						clone.appendChild(element);

						if (change)
							EvoUndoRedo.BackupChildrenAfter(change, clone.parentElement);
					} else if (affected.length > 0) {
						if (change) {
							EvoUndoRedo.BackupChildrenBefore(change, element,
								EvoEditor.GetChildIndex(element, affected[0]),
								EvoEditor.GetChildIndex(element, affected[affected.length - 1]));
						}

						element.insertBefore(clone, affected[0]);

						for (jj = 0; jj < affected.length; jj++) {
							clone.appendChild(affected[jj]);
						}

						if (change)
							EvoUndoRedo.BackupChildrenAfter(change, element);
					}
				} else {
					var insBefore = null;

					elemParent = element.parentElement;

					// decrease indent in nested lists of the same type will merge items into one list
					if (isNested && elemParent.tagName == element.tagName &&
					    elemParent.getAttribute("type") == element.getAttribute("type")) {
						if (change) {
							var childIndex = EvoEditor.GetChildIndex(elemParent, element);
							EvoUndoRedo.BackupChildrenBefore(change, elemParent, childIndex, childIndex);
							change.path = EvoSelection.GetChildPath(parent, elemParent);
						}

						if (!all && affected.length > 0 && !(affected[0] === element.firstElementChild)) {
							insBefore = EvoEditor.splitList(element, 1, affected);
						} else {
							insBefore = element;
						}

						for (jj = 0; jj < affected.length; jj++) {
							elemParent.insertBefore(affected[jj], insBefore);
						}

						if (!element.childElementCount) {
							this.selectionUpdater.beforeRemove(element);

							element.parentElement.removeChild(element);

							this.selectionUpdater.afterRemove(affected[0]);
						}

						if (change)
							EvoUndoRedo.BackupChildrenAfter(change, elemParent);
					} else {
						var tmpElement = element;

						if (isNested) {
							tmpElement = elemParent;
							elemParent = elemParent.parentElement;
						}

						if (change) {
							var childIndex = EvoEditor.GetChildIndex(elemParent, tmpElement);
							EvoUndoRedo.BackupChildrenBefore(change, elemParent, childIndex, childIndex);
							if (isNested) {
								change.pathIsFromBody = true;
								change.path = EvoSelection.GetChildPath(document.body, elemParent);
							} else {
								change.path = EvoSelection.GetChildPath(parent, elemParent);
							}
						}

						if (isNested) {
							var clone;

							insBefore = EvoEditor.splitList(element, 1, affected);

							clone = element.cloneNode(false);
							elemParent.insertBefore(clone, insBefore);

							for (jj = 0; jj < affected.length; jj++) {
								clone.appendChild(affected[jj]);
							}
						} else {
							if (!all && affected.length > 0 && !(affected[0] === element.firstElementChild)) {
								insBefore = EvoEditor.splitList(element, 1, affected);
							} else {
								insBefore = element.nextElementSibling;
							}

							for (jj = 0; jj < affected.length; jj++) {
								EvoEditor.insertListChildBefore(affected[jj], "DIV", insBefore ? insBefore.parentElement : elemParent, insBefore, this.selectionUpdater);
							}
						}

						if (!element.childElementCount) {
							this.selectionUpdater.beforeRemove(element);

							element.parentElement.removeChild(element);

							this.selectionUpdater.afterRemove(insBefore ? insBefore.previousElementSibling : elemParent.lastElementChild);
						}

						if (change)
							EvoUndoRedo.BackupChildrenAfter(change, elemParent);
					}
				}
			} else {
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
				} else {
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

				EvoEditor.removeEmptyStyleAttribute(element);
			}

			return true;
		}
	};

	var affected = EvoEditor.ClaimAffectedContent(null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	traversar.record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, increment ? "Indent" : "Outdent", null, null, EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);
	traversar.selectionUpdater = EvoSelection.CreateUpdaterObject();

	try {
		EvoEditor.ForeachChildInAffectedContent(affected, traversar);

		if (traversar.record) {
			traversar.record.apply = EvoEditor.applyIndent;
		}

		traversar.selectionUpdater.restore();
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

EvoEditor.applySetBodyFontName = function(record, isUndo)
{
	EvoEditor.UpdateStyleSheet("x-evo-body-fontname", isUndo ? record.beforeCSS : record.afterCSS);

	if (record.beforeStyle != record.afterStyle) {
		document.body.style.fontFamily = isUndo ? record.beforeStyle : record.afterStyle;
		EvoEditor.removeEmptyStyleAttribute(body.document);
	}
}

EvoEditor.SetBodyFontName = function(name)
{
	var record;

	record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBodyFontName", document.body, document.body, EvoEditor.CLAIM_CONTENT_FLAG_NONE);

	try {
		var beforeCSS, css, beforeStyle;

		if (name)
			css = "body { font-family: " + name + "; }";
		else
			css = null;

		beforeStyle = document.body.style.fontFamily;
		beforeCSS = EvoEditor.UpdateStyleSheet("x-evo-body-fontname", css);

		if (name != document.body.style.fontFamily)
			document.body.style.fontFamily = name ? name : "";

		if (record) {
			record.apply = EvoEditor.applySetBodyFontName;
			record.beforeCSS = beforeCSS;
			record.afterCSS = css;
			record.beforeStyle = beforeStyle;
			record.afterStyle = document.body.style.fontFamily;

			if (record.beforeCSS == record.afterCSS && record.beforeStyle == record.afterStyle)
				record.ignore = true;
		}

		EvoEditor.removeEmptyStyleAttribute(document.body);
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "setBodyFontName");
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_YES);

		if (!record || !record.ignore)
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

EvoEditor.convertParagraphs = function(parent, wrapWidth)
{
	if (!parent)
		return;

	var ii;

	for (ii = 0; ii < parent.children.length; ii++) {
		var child = parent.children.item(ii);

		if (child.tagName == "DIV") {
			if (wrapWidth == -1) {
				child.style.width = "";
				EvoEditor.removeEmptyStyleAttribute(child);
			} else {
				child.style.width = wrapWidth + "ch";
			}
		} else if (child.tagName == "BLOCKQUOTE") {
			var innerWrapWidth = wrapWidth;

			innerWrapWidth -= 2; // length of "> "

			if (innerWrapWidth < EvoConvert.MIN_PARAGRAPH_WIDTH)
				innerWrapWidth = EvoConvert.MIN_PARAGRAPH_WIDTH;

			EvoEditor.convertParagraphs(child, innerWrapWidth);
		} else if (child.tagName == "UL") {
			if (wrapWidth == -1) {
				child.style.width = "";
				EvoEditor.removeEmptyStyleAttribute(child);
			} else {
				var innerWrapWidth = wrapWidth;

				innerWrapWidth -= 3; // length of " * " prefix

				if (innerWrapWidth < EvoConvert.MIN_PARAGRAPH_WIDTH)
					innerWrapWidth = EvoConvert.MIN_PARAGRAPH_WIDTH;

				child.style.width = innerWrapWidth + "ch";
			}
		} else if (child.tagName == "OL") {
			if (wrapWidth == -1) {
				child.style.width = "";
				child.style.paddingInlineStart = "";
				EvoEditor.removeEmptyStyleAttribute(child);
			} else {
				var innerWrapWidth = wrapWidth, olNeedWidth;

				olNeedWidth = EvoConvert.GetOLMaxLetters(child.getAttribute("type"), child.children.length) + 2; // length of ". " suffix

				if (olNeedWidth < EvoConvert.MIN_OL_WIDTH)
					olNeedWidth = EvoConvert.MIN_OL_WIDTH;

				innerWrapWidth -= olNeedWidth;

				if (innerWrapWidth < EvoConvert.MIN_PARAGRAPH_WIDTH)
					innerWrapWidth = EvoConvert.MIN_PARAGRAPH_WIDTH;

				child.style.width = innerWrapWidth + "ch";
				child.style.paddingInlineStart = olNeedWidth + "ch";
			}
		}
	}
}

EvoEditor.SetNormalParagraphWidth = function(value)
{
	if (EvoEditor.NORMAL_PARAGRAPH_WIDTH != value) {
		EvoEditor.NORMAL_PARAGRAPH_WIDTH = value;

		if (EvoEditor.mode == EvoEditor.MODE_PLAIN_TEXT)
			EvoEditor.convertParagraphs(document.body, EvoEditor.NORMAL_PARAGRAPH_WIDTH);
	}
}

EvoEditor.SetMode = function(mode)
{
	if (EvoEditor.mode != mode) {
		var opType = "setMode::" + (mode == EvoEditor.MODE_PLAIN_TEXT ? "PlainText" : "HTML"), record;

		record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_DOCUMENT, opType, null, null);

		if (record) {
			record.modeBefore = EvoEditor.mode;
			record.modeAfter = mode;
			record.apply = function(record, isUndo) {
				var useMode = isUndo ? record.modeBefore : record.modeAfter;

				if (EvoEditor.mode != useMode) {
					EvoEditor.mode = useMode;
				}
			}
		}

		EvoUndoRedo.Disable();
		try {
			EvoEditor.mode = mode;

			if (mode == EvoEditor.MODE_PLAIN_TEXT) {
				EvoEditor.convertParagraphs(document.body, EvoEditor.NORMAL_PARAGRAPH_WIDTH);
			} else {
				EvoEditor.convertParagraphs(document.body, -1);
			}
		} finally {
			EvoUndoRedo.Enable();
			EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_DOCUMENT, opType);

			EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_YES);
		}
	}
}

EvoEditor.applyFontReset = function(record, isUndo)
{
	if (record.changes) {
		var ii;

		for (ii = 0; ii < record.changes.length; ii++) {
			var change = record.changes[isUndo ? (record.changes.length - ii - 1) : ii];
			var parent = EvoSelection.FindElementByPath(document.body, change.parentPath);

			if (!parent) {
				throw "EvoEditor.applyFontReset: Cannot find node at path " + change.path;
			}

			parent.innerHTML = isUndo ? change.htmlBefore : change.htmlAfter;
		}
	}
}

EvoEditor.replaceInheritFonts = function(undoRedoRecord, selectionUpdater)
{
	var nodes, ii;

	nodes = document.querySelectorAll("font[face=inherit]");

	for (ii = nodes.length - 1; ii >= 0; ii--) {
		var node = nodes.item(ii);

		if (!node || (!undoRedoRecord && !document.getSelection().containsNode(node, true)))
			continue;

		var parent, change = null;

		parent = node.parentElement;

		if (undoRedoRecord) {
			if (!undoRedoRecord.changes)
				undoRedoRecord.changes = [];

			change = {
				parentPath : EvoSelection.GetChildPath(document.body, parent),
				htmlBefore : parent.innerHTML,
				htmlAfter : ""
			};

			undoRedoRecord.changes[undoRedoRecord.changes.length] = change;
		}

		if (node.attributes.length == 1) {
			var child;

			while (node.firstChild) {
				var child = node.firstChild;

				selectionUpdater.beforeRemove(child);

				parent.insertBefore(child, node);

				selectionUpdater.afterRemove(child);
			}

			parent.removeChild(node);
		} else {
			node.removeAttribute("face");
		}

		if (change)
			change.htmlAfter = parent.innerHTML;
	}

	if (undoRedoRecord && undoRedoRecord.changes)
		undoRedoRecord.apply = EvoEditor.applyFontReset;
}

EvoEditor.maybeReplaceInheritFonts = function()
{
	if (document.querySelectorAll("font[face=inherit]").length <= 0)
		return;

	var record, selectionUpdater;

	selectionUpdater = EvoSelection.CreateUpdaterObject();

	record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "UnsetFontName", null, null, EvoEditor.CLAIM_CONTENT_FLAG_NONE);
	try {
		EvoEditor.replaceInheritFonts(record, selectionUpdater);

		selectionUpdater.restore();
	} finally {
		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "UnsetFontName");

		if (record)
			EvoUndoRedo.GroupTopRecords(2);
	}
}

EvoEditor.SetFontName = function(name)
{
	if (!name || name == "")
		name = "inherit";

	var record, selectionUpdater = EvoSelection.CreateUpdaterObject(), bodyFontFamily;

	// to workaround https://bugs.webkit.org/show_bug.cgi?id=204622
	bodyFontFamily = document.body.style.fontFamily;

	record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_GROUP, "SetFontName", null, null,
		EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE | EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML);
	try {
		if (!document.getSelection().isCollapsed && bodyFontFamily)
			document.body.style.fontFamily = "";

		document.execCommand("FontName", false, name);

		if (document.getSelection().isCollapsed) {
			if (name == "inherit")
				EvoEditor.checkInheritFontsOnChange = true;

			/* Format change on collapsed selection is not applied immediately */
			if (record)
				record.ignore = true;
		} else if (name == "inherit") {
			var subrecord;

			subrecord = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "SetFontName", null, null, EvoEditor.CLAIM_CONTENT_FLAG_NONE);
			try {
				EvoEditor.replaceInheritFonts(subrecord, selectionUpdater);
				selectionUpdater.restore();
			} finally {
				EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_CUSTOM, "SetFontName");
			}
		}
	} finally {
		if (bodyFontFamily && document.body.style.fontFamily != bodyFontFamily)
			document.body.style.fontFamily = bodyFontFamily;

		EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_GROUP, "SetFontName");
		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
		EvoEditor.EmitContentChanged();

		EvoEditor.removeEmptyStyleAttribute(document.body);
	}
}

EvoEditor.convertHtmlToSend = function()
{
	var html, bgcolor, text, link, vlink;
	var unsetBgcolor = false, unsetText = false, unsetLink = false, unsetVlink = false;
	var themeCss, inheritThemeColors = EvoEditor.inheritThemeColors;
	var ii, styles, styleNode = null;

	themeCss = EvoEditor.UpdateThemeStyleSheet(null);
	bgcolor = document.documentElement.getAttribute("x-evo-bgcolor");
	text = document.documentElement.getAttribute("x-evo-text");
	link = document.documentElement.getAttribute("x-evo-link");
	vlink = document.documentElement.getAttribute("x-evo-vlink");

	document.documentElement.removeAttribute("x-evo-bgcolor");
	document.documentElement.removeAttribute("x-evo-text");
	document.documentElement.removeAttribute("x-evo-link");
	document.documentElement.removeAttribute("x-evo-vlink");

	if (inheritThemeColors) {
		if (bgcolor && !document.body.getAttribute("bgcolor")) {
			document.body.setAttribute("bgcolor", bgcolor);
			unsetBgcolor = true;
		}

		if (text && !document.body.getAttribute("text")) {
			document.body.setAttribute("text", text);
			unsetText = true;
		}

		if (link && !document.body.getAttribute("link")) {
			document.body.setAttribute("link", link);
			unsetLink = true;
		}

		if (vlink && !document.body.getAttribute("vlink")) {
			document.body.setAttribute("vlink", vlink);
			unsetVlink = true;
		}
	}

	styles = document.head.getElementsByTagName("style");

	for (ii = 0; ii < styles.length; ii++) {
		if (styles[ii].id == "x-evo-body-fontname") {
			styleNode = styles[ii];
			styleNode.id = "";
			break;
		}
	}

	html = document.documentElement.outerHTML;

	if (styleNode)
		styleNode.id = "x-evo-body-fontname";

	if (bgcolor)
		document.documentElement.setAttribute("x-evo-bgcolor", bgcolor);
	if (text)
		document.documentElement.setAttribute("x-evo-text", text);
	if (link)
		document.documentElement.setAttribute("x-evo-link", link);
	if (vlink)
		document.documentElement.setAttribute("x-evo-vlink", vlink);

	if (inheritThemeColors) {
		if (unsetBgcolor)
			document.body.removeAttribute("bgcolor");

		if (unsetText)
			document.body.removeAttribute("text");

		if (unsetLink)
			document.body.removeAttribute("link");

		if (unsetVlink)
			document.body.removeAttribute("vlink");
	}

	if (themeCss)
		EvoEditor.UpdateThemeStyleSheet(themeCss);

	return html;
}

EvoEditor.GetContent = function(flags, cid_uid_prefix)
{
	var content_data = {}, img_elems = [], elems, ii, jj;

	if (!document.body)
		return content_data;

	EvoUndoRedo.Disable();

	try {
		if ((flags & EvoEditor.E_CONTENT_EDITOR_GET_RAW_BODY_STRIPPED) != 0) {
			var hidden_elems = [];

			try {
				elems = document.getElementsByClassName("-x-evo-signature-wrapper");
				if (elems && elems.length) {
					for (ii = 0; ii < elems.length; ii++) {
						var elem = elems.item(ii);

						if (elem && !elem.hidden) {
							hidden_elems[hidden_elems.length] = elem;
							elem.hidden = true;
						}
					}
				}

				elems = document.getElementsByTagName("BLOCKQUOTE");
				if (elems && elems.length) {
					for (ii = 0; ii < elems.length; ii++) {
						var elem = elems.item(ii);

						if (elem && !elem.hidden) {
							hidden_elems[hidden_elems.length] = elem;
							elem.hidden = true;
						}
					}
				}

				content_data["raw-body-stripped"] = document.body.innerText;
			} finally {
				for (ii = 0; ii < hidden_elems.length; ii++) {
					hidden_elems[ii].hidden = false;
				}
			}
		}

		// Do these before changing image sources
		if ((flags & EvoEditor.E_CONTENT_EDITOR_GET_RAW_BODY_HTML) != 0)
			content_data["raw-body-html"] = document.body.innerHTML;

		if ((flags & EvoEditor.E_CONTENT_EDITOR_GET_RAW_BODY_PLAIN) != 0)
			content_data["raw-body-plain"] = document.body.innerText;

		if (EvoEditor.mode == EvoEditor.MODE_HTML &&
		    (flags & EvoEditor.E_CONTENT_EDITOR_GET_INLINE_IMAGES) != 0) {
			var images = [];

			for (ii = 0; ii < document.images.length; ii++) {
				var elem = document.images.item(ii);
				var src = (elem && elem.src) ? elem.src.toLowerCase() : "";

				if (elem &&
				    src.startsWith("data:") ||
				    src.startsWith("file://") ||
				    src.startsWith("evo-file://")) {
					for (jj = 0; jj < img_elems.length; jj++) {
						if (elem.src == img_elems[jj].orig_src) {
							elem.subelems[elem.subelems.length] = elem;
							elem.src = img_elems[jj].cid;
							break;
						}
					}

					if (jj >= img_elems.length) {
						var img_obj = {
							subelems : [ elem ],
							cid : "cid:" + cid_uid_prefix + "-" + img_elems.length,
							orig_src : elem.src
						};

						if (elem.src.toLowerCase().startsWith("cid:"))
							img_obj.cid = elem.src;

						img_elems[img_elems.length] = img_obj;
						images[images.length] = {
							cid : img_obj.cid,
							src : elem.src
						};
						elem.src = img_obj.cid;
					}
				} else if (elem && src.startsWith("cid:")) {
					images[images.length] = {
						cid : elem.src,
						src : elem.src
					};
				}
			}

			if (images.length)
				content_data["images"] = images;
		}

		// Draft should have replaced images as well
		if ((flags & EvoEditor.E_CONTENT_EDITOR_GET_RAW_DRAFT) != 0) {
			document.head.setAttribute("x-evo-selection", EvoSelection.ToString(EvoSelection.Store(document)));
			try {
				content_data["raw-draft"] = document.documentElement.innerHTML;
			} finally {
				document.head.removeAttribute("x-evo-selection");
			}
		}

		if ((flags & EvoEditor.E_CONTENT_EDITOR_GET_TO_SEND_HTML) != 0)
			content_data["to-send-html"] = EvoEditor.convertHtmlToSend();

		if ((flags & EvoEditor.	E_CONTENT_EDITOR_GET_TO_SEND_PLAIN) != 0) {
			content_data["to-send-plain"] = EvoConvert.ToPlainText(document.body, EvoEditor.NORMAL_PARAGRAPH_WIDTH);
		}
	} finally {
		try {
			for (ii = 0; ii < img_elems.length; ii++) {
				var img_obj = img_elems[ii];

				for (jj = 0; jj < img_obj.subelems.length; jj++) {
					img_obj.subelems[jj].src = img_obj.orig_src;
				}
			}
		} finally {
			EvoUndoRedo.Enable();
		}
	}

	return content_data;
}

EvoEditor.UpdateStyleSheet = function(id, css)
{
	var styles, ii, res = null;

	styles = document.head.getElementsByTagName("style");

	for (ii = 0; ii < styles.length; ii++) {
		if (styles[ii].id == id) {
			res = styles[ii].innerHTML;

			if (css)
				styles[ii].innerHTML = css;
			else
				document.head.removeChild(styles[ii]);

			return res;
		}
	}

	if (css) {
		var style;

		style = document.createElement("STYLE");
		style.id = id;
		style.innerText = css;
		document.head.append(style);
	}

	return res;
}

EvoEditor.UpdateThemeStyleSheet = function(css)
{
	return EvoEditor.UpdateStyleSheet("x-evo-theme-sheet", css);
}

document.onload = EvoEditor.initializeContent;

document.onselectionchange = function() {
	if (EvoEditor.checkInheritFontsOnChange) {
		EvoEditor.checkInheritFontsOnChange = false;
		EvoEditor.maybeReplaceInheritFonts();
	}

	EvoEditor.maybeUpdateFormattingState(EvoEditor.forceFormatStateUpdate ? EvoEditor.FORCE_YES : EvoEditor.FORCE_MAYBE);
	EvoEditor.forceFormatStateUpdate = false;
};

EvoEditor.initializeContent();
