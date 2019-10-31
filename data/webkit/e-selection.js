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

var EvoSelection = {
};

/* The node path is described as an array of child indexes between parent
   and the childNode (in this order). */
EvoSelection.GetChildPath = function(parent, childNode)
{
	if (!childNode) {
		return null;
	}

	var array = [], node;

	if (childNode.nodeType == childNode.TEXT_NODE) {
		childNode = childNode.parentElement;
	}

	for (node = childNode; node && !(node === parent); node = node.parentElement) {
		var child, index = 0;

		for (child = node.previousElementSibling; child; child = child.previousElementSibling) {
			index++;
		}

		array[array.length] = index;
	}

	return array.reverse();
}

/* Finds the element (not node) referenced by the 'path', which had been created
   by EvoSelection.GetChildPath(). There should be used the same 'parent' element
   in both calls. */
EvoSelection.FindElementByPath = function(parent, path)
{
	if (!parent || !path) {
		return null;
	}

	var ii, child = parent;

	for (ii = 0; ii < path.length; ii++) {
		var idx = path[ii];

		if (idx < 0 || idx >= child.children.length) {
			throw "EvoSelection.FindElementByPath:: Index '" + idx + "' out of range '" + child.children.length + "'";
		}

		child = child.children.item(idx);
	}

	return child;
}

/* This is when the text nodes are split, then the text length of
   the previous text node influences offset of the next node. */
EvoSelection.GetOverallTextOffset = function(node)
{
	if (!node) {
		return 0;
	}

	var text_offset = 0, sibling;

	for (sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
		if (sibling.nodeType == sibling.TEXT_NODE) {
			text_offset += sibling.textContent.length;
		}
	}

	return text_offset;
}

/* Traverses direct text nodes under element until it reaches the first within
   the textOffset. */
EvoSelection.GetTextOffsetNode = function(element, textOffset)
{
	if (!element) {
		return null;
	}

	var node, adept = null;

	for (node = element.firstChild; node; node = node.nextSibling) {
		if (node.nodeType == node.TEXT_NODE) {
			var txt_len = node.textContent.length;

			if (textOffset > txt_len) {
				textOffset -= txt_len;
				adept = node;
			} else {
				break;
			}
		}
	}

	return node ? node : adept;
}

/* Returns an object, where the current selection in the doc is stored */
EvoSelection.Store = function(doc)
{
	if (!doc || !doc.getSelection()) {
		return null;
	}

	var selection = {}, sel = doc.getSelection();

	selection.baseElem = sel.baseNode ? EvoSelection.GetChildPath(doc.body, sel.baseNode) : [];
	selection.baseOffset = sel.baseOffset + EvoSelection.GetOverallTextOffset(sel.baseNode);

	if (!sel.isCollapsed) {
		selection.extentElem = EvoSelection.GetChildPath(doc.body, sel.extentNode);
		selection.extentOffset = sel.extentOffset + EvoSelection.GetOverallTextOffset(sel.extentNode);
	}

	return selection;
}

/* Restores selection in the doc according to the information stored in 'selection',
   obtained by EvoSelection.Store(). */
EvoSelection.Restore = function(doc, selection)
{
	if (!doc || !selection || !doc.getSelection()) {
		return;
	}

	var base_node, base_offset, extent_node, extent_offset;

	base_node = EvoSelection.FindElementByPath(doc.body, selection.baseElem);
	base_offset = selection.baseOffset;

	if (!base_node) {
		return;
	}

	if (!base_offset) {
		base_offset = 0;
	}

	base_node = EvoSelection.GetTextOffsetNode(base_node, base_offset);
	base_offset -= EvoSelection.GetOverallTextOffset(base_node);

	extent_node = EvoSelection.FindElementByPath(doc.body, selection.extentElem);
	extent_offset = selection.extentOffset;

	if (extent_node) {
		extent_node = EvoSelection.GetTextOffsetNode(extent_node, extent_offset);
		extent_offset -= EvoSelection.GetOverallTextOffset(extent_node);
	}

	if (extent_node)
		doc.getSelection().setBaseAndExtent(base_node, base_offset, extent_node, extent_offset);
	else
		doc.getSelection().setPosition(base_node, base_offset);
}

/* Encodes selection information to a string */
EvoSelection.ToString = function(selection)
{
	if (!selection) {
		return "";
	}

	var utils = {
		arrayToString : function(array) {
			var ii, str = "[";

			if (!array) {
				return str + "]";
			}

			for (ii = 0; ii < array.length; ii++) {
				if (ii) {
					str += ",";
				}
				str += array[ii];
			}

			return str + "]";
		}
	};

	var str = "", base_elem, base_offset, extent_elem, extent_offset;

	base_elem = selection.baseElem;
	base_offset = selection.baseOffset;
	extent_elem = selection.extentElem;
	extent_offset = selection.extentOffset;

	str += "baseElem=" + utils.arrayToString(base_elem);
	str += " baseOffset=" + (base_offset ? base_offset : 0);

	if (extent_elem) {
		str += " extentElem=" + utils.arrayToString(extent_elem);
		str += " extentOffset=" + (extent_offset ? extent_offset : 0);
	}

	return str;
}

/* Decodes selection information from a string */
EvoSelection.FromString = function(str)
{
	if (!str) {
		return null;
	}

	var utils = {
		arrayFromString : function(str) {
			if (!str || !str.startsWith("[") || !str.endsWith("]")) {
				return null;
			}

			var ii, array;

			array = str.substr(1, str.length - 2).split(",");

			if (!array) {
				return null;
			}

			if (array.length == 1 && array[0] == "") {
				array.length = 0;
			} else {
				for (ii = 0; ii < array.length; ii++) {
					array[ii] = parseInt(array[ii], 10);

					if (!Number.isInteger(array[ii])) {
						return null;
					}
				}
			}

			return array;
		}
	};

	var selection = {}, ii, split_str;

	split_str = str.split(" ");

	if (!split_str || !split_str.length) {
		return null;
	}

	for (ii = 0; ii < split_str.length; ii++) {
		var name;

		name = "baseElem";
		if (split_str[ii].startsWith(name + "=")) {
			selection[name] = utils.arrayFromString(split_str[ii].slice(name.length + 1));
			continue;
		}

		name = "baseOffset";
		if (split_str[ii].startsWith(name + "=")) {
			var value;

			value = parseInt(split_str[ii].slice(name.length + 1), 10);
			if (Number.isInteger(value)) {
				selection[name] = value;
			}
			continue;
		}

		name = "extentElem";
		if (split_str[ii].startsWith(name + "=")) {
			selection[name] = utils.arrayFromString(split_str[ii].slice(name.length + 1));
			continue;
		}

		name = "extentOffset";
		if (split_str[ii].startsWith(name + "=")) {
			var value;

			value = parseInt(split_str[ii].slice(name.length + 1), 10);
			if (Number.isInteger(value)) {
				selection[name] = value;
			}
		}
	}

	/* The "baseElem" is required, the rest is optional */
	if (!selection.baseElem)
		return null;

	return selection;
}
