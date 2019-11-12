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

var EvoUndoRedo = {
	E_UNDO_REDO_STATE_NONE : 0,
	E_UNDO_REDO_STATE_CAN_UNDO : 1 << 0,
	E_UNDO_REDO_STATE_CAN_REDO : 1 << 1,

	stack : {
		// to not claim changes when none being made
		state : -1,
		undoOpType : "",
		redoOpType : "",

		maybeStateChanged : function() {
			var undoRecord, redoRecord, undoAvailable, undoOpType, redoAvailable, redoOpType;

			undoRecord = EvoUndoRedo.stack.getCurrentUndoRecord();
			redoRecord = EvoUndoRedo.stack.getCurrentRedoRecord();
			undoAvailable = undoRecord != null;
			undoOpType = undoRecord ? undoRecord.opType : "";
			redoAvailable = redoRecord != null;
			redoOpType = redoRecord ? redoRecord.opType : "";

			var state = EvoUndoRedo.E_UNDO_REDO_STATE_NONE;

			if (undoAvailable) {
				state |= EvoUndoRedo.E_UNDO_REDO_STATE_CAN_UNDO;
			}

			if (redoAvailable) {
				state |= EvoUndoRedo.E_UNDO_REDO_STATE_CAN_REDO;
			}

			if (EvoUndoRedo.state != state ||
			    EvoUndoRedo.undoOpType != (undoAvailable ? undoOpType : "") ||
			    EvoUndoRedo.redoOpType != (redoAvailable ? redoOpType : "")) {
				EvoUndoRedo.state = state;
				EvoUndoRedo.undoOpType = (undoAvailable ? undoOpType : "");
				EvoUndoRedo.redoOpType = (redoAvailable ? redoOpType : "");

				var params = {};

				params.state = EvoUndoRedo.state;
				params.undoOpType = EvoUndoRedo.undoOpType;
				params.redoOpType = EvoUndoRedo.redoOpType;

				window.webkit.messageHandlers.undoRedoStateChanged.postMessage(params);
			}
		},

		MAX_DEPTH : 1024, /* it's one item less, due to the 'bottom' being always ignored */

		array : [],
		bottom : 0,
		top : 0,
		current : 0,

		clampIndex : function(index) {
			index = (index) % EvoUndoRedo.stack.MAX_DEPTH;

			if (index < 0)
				index += EvoUndoRedo.stack.MAX_DEPTH;

			return index;
		},

		/* Returns currently active record for Undo operation, or null */
		getCurrentUndoRecord : function() {
			if (EvoUndoRedo.stack.current == EvoUndoRedo.stack.bottom || !EvoUndoRedo.stack.array.length ||
			    EvoUndoRedo.stack.current < 0 || EvoUndoRedo.stack.current > EvoUndoRedo.stack.array.length) {
				return null;
			}

			return EvoUndoRedo.stack.array[EvoUndoRedo.stack.current];
		},

		/* Returns currently active record for Redo operation, or null */
		getCurrentRedoRecord : function() {
			if (EvoUndoRedo.stack.current == EvoUndoRedo.stack.top) {
				return null;
			}

			var idx = EvoUndoRedo.stack.clampIndex(EvoUndoRedo.stack.current + 1);

			if (idx < 0 || idx > EvoUndoRedo.stack.array.length) {
				return null;
			}

			return EvoUndoRedo.stack.array[idx];
		},

		/* Clears the undo stack */
		clear : function() {
			EvoUndoRedo.stack.array.length = 0;
			EvoUndoRedo.stack.bottom = 0;
			EvoUndoRedo.stack.top = 0;
			EvoUndoRedo.stack.current = 0;

			EvoUndoRedo.stack.maybeStateChanged();
		},

		/* Adds a new record into the stack; if any undo had been made, then
		   those records are freed. It can also overwrite old undo steps, if
		   the stack size would overflow MAX_DEPTH. */
		push : function(record) {
			if (!EvoUndoRedo.stack.array.length) {
				EvoUndoRedo.stack.array[0] = null;
			}

			var next = EvoUndoRedo.stack.clampIndex(EvoUndoRedo.stack.current + 1);

			if (EvoUndoRedo.stack.current != EvoUndoRedo.stack.top) {
				var tt, bb, cc;

				tt = EvoUndoRedo.stack.top;
				bb = EvoUndoRedo.stack.bottom;
				cc = EvoUndoRedo.stack.current;

				if (bb > tt) {
					tt += EvoUndoRedo.stack.MAX_DEPTH;
					cc += EvoUndoRedo.stack.MAX_DEPTH;
				}

				while (cc + 1 <= tt) {
					EvoUndoRedo.stack.array[EvoUndoRedo.stack.clampIndex(cc + 1)] = null;
					cc++;
				}
			}

			if (next == EvoUndoRedo.stack.bottom) {
				EvoUndoRedo.stack.bottom = EvoUndoRedo.stack.clampIndex(EvoUndoRedo.stack.bottom + 1);
				EvoUndoRedo.stack.array[EvoUndoRedo.stack.bottom] = null;
			}

			EvoUndoRedo.stack.current = next;
			EvoUndoRedo.stack.top = next;
			EvoUndoRedo.stack.array[next] = record;

			EvoUndoRedo.stack.maybeStateChanged();
		},

		/* Moves the 'current' index in the stack and returns the undo record
		   to be undone; or 'null', when there's no undo record available. */
		undo : function() {
			var record = EvoUndoRedo.stack.getCurrentUndoRecord();

			if (record) {
				EvoUndoRedo.stack.current = EvoUndoRedo.stack.clampIndex(EvoUndoRedo.stack.current - 1);
			}

			EvoUndoRedo.stack.maybeStateChanged();

			return record;
		},

		/* Moves the 'current' index in the stack and returns the redo record
		   to be redone; or 'null', when there's no redo record available. */
		redo : function() {
			var record = EvoUndoRedo.stack.getCurrentRedoRecord();

			if (record) {
				EvoUndoRedo.stack.current = EvoUndoRedo.stack.clampIndex(EvoUndoRedo.stack.current + 1);
			}

			EvoUndoRedo.stack.maybeStateChanged();

			return record;
		},

		pathMatches : function(path1, path2) {
			if (!path1)
				return !path2;
			else if (!path2 || path1.length != path2.length)
				return false;

			var ii;

			for (ii = 0; ii < path1.length; ii++) {
				if (path1[ii] != path2[ii])
					return false;
			}

			return true;
		},

		topInsertTextAtSamePlace : function() {
			if (EvoUndoRedo.stack.current != EvoUndoRedo.stack.top ||
			    EvoUndoRedo.stack.current == EvoUndoRedo.stack.bottom) {
				return false;
			}

			var curr, prev;

			curr = EvoUndoRedo.stack.array[EvoUndoRedo.stack.current];
			prev = EvoUndoRedo.stack.array[EvoUndoRedo.stack.clampIndex(EvoUndoRedo.stack.current - 1)];

			return curr && prev &&
				curr.kind == EvoUndoRedo.RECORD_KIND_EVENT &&
				curr.opType == "insertText" &&
				!curr.selectionBefore.extentElem &&
				prev.kind == EvoUndoRedo.RECORD_KIND_EVENT &&
				prev.opType == "insertText" &&
				!prev.selectionBefore.extentElem &&
				curr.firstChildIndex == prev.firstChildIndex &&
				curr.restChildrenCount == prev.restChildrenCount &&
				curr.selectionBefore.baseOffset == prev.selectionAfter.baseOffset &&
				EvoUndoRedo.stack.pathMatches(curr.path, prev.path) &&
				EvoUndoRedo.stack.pathMatches(curr.selectionBefore.baseElem, prev.selectionAfter.baseElem);
		},

		maybeMergeConsecutive : function(skipFirst, opType) {
			if (EvoUndoRedo.stack.current != EvoUndoRedo.stack.top ||
			    EvoUndoRedo.stack.current == EvoUndoRedo.stack.bottom) {
				return;
			}

			var ii, from, curr, keep = null;

			from = EvoUndoRedo.stack.current;
			curr = EvoUndoRedo.stack.array[from];

			if (skipFirst) {
				keep = curr;
				from = EvoUndoRedo.stack.clampIndex(from - 1);
				curr = EvoUndoRedo.stack.array[from];
			}

			if (!curr ||
			    curr.kind != EvoUndoRedo.RECORD_KIND_EVENT ||
			    curr.opType != opType ||
			    curr.selectionBefore.extentElem) {
				return;
			}

			for (ii = EvoUndoRedo.stack.clampIndex(from - 1);
			     ii != EvoUndoRedo.stack.bottom;
			     ii = EvoUndoRedo.stack.clampIndex(ii - 1)) {
				var prev;

				prev = EvoUndoRedo.stack.array[ii];

				if (prev.kind != EvoUndoRedo.RECORD_KIND_EVENT ||
				    prev.opType != opType ||
				    prev.selectionBefore.extentElem ||
				    curr.firstChildIndex != prev.firstChildIndex ||
				    curr.restChildrenCount != prev.restChildrenCount ||
				    curr.selectionBefore.baseOffset != prev.selectionAfter.baseOffset ||
				    !EvoUndoRedo.stack.pathMatches(curr.path, prev.path) ||
				    !EvoUndoRedo.stack.pathMatches(curr.selectionBefore.baseElem, prev.selectionAfter.baseElem)) {
					break;
				}

				if (opType == "insertText")
					prev.opType = opType + "::merged";
				prev.selectionAfter = curr.selectionAfter;
				prev.htmlAfter = curr.htmlAfter;

				curr = prev;
				EvoUndoRedo.stack.array[EvoUndoRedo.stack.clampIndex(ii + 1)] = keep;
				if (keep) {
					EvoUndoRedo.stack.array[EvoUndoRedo.stack.clampIndex(ii + 2)] = null;
				}

				EvoUndoRedo.stack.top = ii + (keep ? 1 : 0);
				EvoUndoRedo.stack.current = EvoUndoRedo.stack.top;
			}

			EvoUndoRedo.stack.maybeStateChanged();
		},

		maybeMergeInsertText : function(skipFirst) {
			EvoUndoRedo.stack.maybeMergeConsecutive(skipFirst, "insertText");
			EvoUndoRedo.stack.maybeMergeConsecutive(skipFirst, "insertText::WordDelim");
		}
	},

	RECORD_KIND_EVENT	: 1, /* managed by EvoUndoRedo itself, in DOM events */
	RECORD_KIND_DOCUMENT	: 2, /* saving whole document */
	RECORD_KIND_GROUP	: 3, /* not saving anything, just grouping several records together */
	RECORD_KIND_CUSTOM	: 4, /* custom record */

	/*
	Record {
		int kind;		// RECORD_KIND_...
		string opType;		// operation type, like the one from oninput
		Array path;		// path to the common parent of the affteded elements
		int firstChildIndex;	// the index of the first children affeted/recorded
		int restChildrenCount;	// the Undo/Redo affects only some children, these are those which are unaffected after the path
		Object selectionBefore;	// stored selection as it was before the change
		string htmlBefore;	// affected children before the change; can be null, when inserting new nodes
		Object selectionAfter;	// stored selection as it was after the change
		string htmlAfter;	// affected children before the change; can be null, when removed old nodes

		Array records;		// nested records; can be null or undefined
	}

	The path, firstChildIndex and restChildrenCount together describe where the changes happened.
	That is, for example when changing node 'b' into 'x' and 'y':
	   <body>	|   <body>
	     <a/>	|     <a/>
	     <b/>	|     <x/>
	     <c/>	|     <y/>
	     <d/>	|     <c/>
	   </body>	|     <d/>
			|   </body>
	the 'path' points to 'body', the firstChildIndex=1 and restChildrenCount=2. Then undo/redo can
	delete all nodes between index >= firstChildIndex && index < children.length - restChildrenCount.
	*/

	disabled : 0,
	ongoingRecordings : [] // the recordings can be nested
};

EvoUndoRedo.Attach = function()
{
	if (document.documentElement) {
		document.documentElement.onbeforeinput = EvoUndoRedo.before_input_cb;
		document.documentElement.oninput = EvoUndoRedo.input_cb;
	}
}

EvoUndoRedo.Detach = function()
{
	if (document.documentElement) {
		document.documentElement.onbeforeinput = null;
		document.documentElement.oninput = null;
	}
}

EvoUndoRedo.Enable = function()
{
	if (!EvoUndoRedo.disabled) {
		throw "EvoUndoRedo:: Cannot Enable, when not disabled";
	}

	EvoUndoRedo.disabled--;
}

EvoUndoRedo.Disable = function()
{
	EvoUndoRedo.disabled++;

	if (!EvoUndoRedo.disabled) {
		throw "EvoUndoRedo:: Overflow in Disable";
	}
}

EvoUndoRedo.isWordDelimEvent = function(inputEvent)
{
	return inputEvent.inputType == "insertText" &&
		inputEvent.data &&
		inputEvent.data.length == 1 &&
		(inputEvent.data == " " || inputEvent.data == "\t");
}

EvoUndoRedo.before_input_cb = function(inputEvent)
{
	if (EvoUndoRedo.disabled) {
		return;
	}

	var opType = inputEvent.inputType, record, startNode = null, endNode = null;

	if (EvoUndoRedo.isWordDelimEvent(inputEvent))
		opType += "::WordDelim";

	if (opType == "deleteWordBackward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "backward", "word");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteWordForward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "forward", "word");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteSoftLineBackward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "backward", "line");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteSoftLineForward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "forward", "line");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteEntireSoftLine") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "backward", "line");
		startNode = document.getSelection().baseNode;
		document.getSelection().modify("move", "forward", "line");
		endNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteHardLineBackward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "backward", "paragraph");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteHardLineForward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "forward", "paragraph");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteContentBackward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "backward", "paragraph");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	} else if (opType == "deleteContentForward") {
		var sel = EvoSelection.Store(document);
		document.getSelection().modify("move", "forward", "paragraph");
		startNode = document.getSelection().baseNode;
		EvoSelection.Restore(document, sel);
	}

	record = EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_EVENT, opType, startNode, endNode,
		EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML | EvoEditor.CLAIM_CONTENT_FLAG_USE_PARENT_BLOCK_NODE);

	/* Changing format with collapsed selection doesn't change HTML structure immediately */
	if (record && opType.startsWith("format") && document.getSelection().isCollapsed) {
		record.ignore = true;
	}
}

EvoUndoRedo.input_cb = function(inputEvent)
{
	if (EvoUndoRedo.disabled) {
		EvoEditor.EmitContentChanged();
		return;
	}

	var opType = inputEvent.inputType;

	if (EvoUndoRedo.isWordDelimEvent(inputEvent))
		opType += "::WordDelim";

	if (EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_EVENT, opType)) {
		EvoEditor.EmitContentChanged();

		EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_MAYBE);
	}

	if (!EvoUndoRedo.ongoingRecordings.length && opType == "insertText" &&
	    !EvoUndoRedo.stack.topInsertTextAtSamePlace()) {
		EvoUndoRedo.stack.maybeMergeInsertText(true);
	}

	EvoEditor.forceFormatStateUpdate = EvoEditor.forceFormatStateUpdate || opType == "" || opType.startsWith("format");
}

EvoUndoRedo.applyRecord = function(record, isUndo, withSelection)
{
	if (!record) {
		return;
	}

	var kind = record.kind;

	if (kind == EvoUndoRedo.RECORD_KIND_GROUP) {
		var ii, records;

		records = record.records;

		if (records && records.length) {
			if (isUndo) {
				for (ii = records.length - 1; ii >= 0; ii--) {
					EvoUndoRedo.applyRecord(records[ii], isUndo, false);
				}
			} else {
				for (ii = 0; ii < records.length; ii++) {
					EvoUndoRedo.applyRecord(records[ii], isUndo, false);
				}
			}
		}

		if (withSelection) {
			if (isUndo) {
				EvoSelection.Restore(document, record.selectionBefore);
			} else {
				EvoSelection.Restore(document, record.selectionAfter);
			}
		}

		return;
	}

	EvoUndoRedo.Disable();

	try {
		if (kind == EvoUndoRedo.RECORD_KIND_DOCUMENT) {
			if (isUndo) {
				document.documentElement.innerHTML = record.htmlBefore;
			} else {
				document.documentElement.innerHTML = record.htmlAfter;
			}

			if (record.apply != null) {
				record.apply(record, isUndo);
			}
		} else if (kind == EvoUndoRedo.RECORD_KIND_CUSTOM && record.apply != null) {
			record.apply(record, isUndo);
		} else {
			var commonParent, first, last, ii;

			commonParent = EvoSelection.FindElementByPath(document.body, record.path);
			if (!commonParent) {
				throw "EvoUndoRedo::applyRecord: Cannot find parent at path " + record.path;
			}

			first = record.firstChildIndex;

			if (first == -1) {
				if (isUndo) {
					commonParent.innerHTML = record.htmlBefore;
				} else {
					commonParent.innerHTML = record.htmlAfter;
				}
			} else {
				// it can equal to the children.length, when the node had been removed
				if (first < 0 || first > commonParent.children.length) {
					throw "EvoUndoRedo::applyRecord: firstChildIndex (" + first + ") out of bounds (" + commonParent.children.length + ")";
				}

				last = commonParent.children.length - record.restChildrenCount;
				if (last < 0 || last < first) {
					throw "EvoUndoRedo::applyRecord: restChildrenCount (" + record.restChildrenCount + ") out of bounds (length:" +
						commonParent.children.length + " first:" + first + " last:" + last + ")";
				}

				for (ii = last - 1; ii >= first; ii--) {
					if (ii >= 0 && ii < commonParent.children.length) {
						commonParent.removeChild(commonParent.children.item(ii));
					}
				}

				var tmpNode = document.createElement("evo-tmp");

				if (isUndo) {
					tmpNode.innerHTML = record.htmlBefore;
				} else {
					tmpNode.innerHTML = record.htmlAfter;
				}

				if (first < commonParent.children.length) {
					first = commonParent.children.item(first);

					while(tmpNode.firstElementChild) {
						commonParent.insertBefore(tmpNode.firstElementChild, first);
					}
				} else {
					while(tmpNode.children.length) {
						commonParent.appendChild(tmpNode.children.item(0));
					}
				}
			}
		}

		if (withSelection) {
			if (isUndo) {
				EvoSelection.Restore(document, record.selectionBefore);
			} else {
				EvoSelection.Restore(document, record.selectionAfter);
			}
		}
	} finally {
		EvoUndoRedo.Enable();
	}
}

EvoUndoRedo.StartRecord = function(kind, opType, startNode, endNode, flags)
{
	if (EvoUndoRedo.disabled) {
		return null;
	}

	var record = {};

	record.kind = kind;
	record.opType = opType;
	record.selectionBefore = EvoSelection.Store(document);

	if (kind == EvoUndoRedo.RECORD_KIND_DOCUMENT) {
		record.htmlBefore = document.documentElement.innerHTML;
	} else if (kind != EvoUndoRedo.RECORD_KIND_GROUP) {
		var affected;

		affected = EvoEditor.ClaimAffectedContent(startNode, endNode, flags);

		record.path = affected.path;
		record.firstChildIndex = affected.firstChildIndex;
		record.restChildrenCount = affected.restChildrenCount;

		if ((flags & EvoEditor.CLAIM_CONTENT_FLAG_SAVE_HTML) != 0)
			record.htmlBefore = affected.html;
	}

	EvoUndoRedo.ongoingRecordings[EvoUndoRedo.ongoingRecordings.length] = record;

	return record;
}

EvoUndoRedo.StopRecord = function(kind, opType)
{
	if (EvoUndoRedo.disabled) {
		return false;
	}

	if (!EvoUndoRedo.ongoingRecordings.length) {
		throw "EvoUndoRedo:StopRecord: Nothing is recorded";
	}

	var record = EvoUndoRedo.ongoingRecordings[EvoUndoRedo.ongoingRecordings.length - 1];

	if (record.kind != kind) {
		throw "EvoUndoRedo:StopRecord: Mismatch in record kind, expected " + record.kind + ", but received " + kind;
	}

	if (record.opType != opType) {
		throw "EvoUndoRedo:StopRecord: Mismatch in record opType, expected '" + record.opType + "', but received '" + opType + "'";
	}

	EvoUndoRedo.ongoingRecordings.length = EvoUndoRedo.ongoingRecordings.length - 1;

	if (record.ignore) {
		if (!EvoUndoRedo.ongoingRecordings.length &&
		    (record.kind != EvoUndoRedo.RECORD_KIND_EVENT || record.opType != "insertText")) {
			EvoUndoRedo.stack.maybeMergeInsertText(false);
		}

		return false;
	}

	if (kind == EvoUndoRedo.RECORD_KIND_DOCUMENT) {
		record.htmlAfter = document.documentElement.innerHTML;
	} else if (record.htmlBefore != window.undefined) {
		var commonParent, first, last, ii, html = "";

		commonParent = EvoSelection.FindElementByPath(document.body, record.path);

		if (!commonParent) {
			throw "EvoUndoRedo.StopRecord:: Failed to stop '" + opType + "', cannot find common parent";
		}

		first = record.firstChildIndex;

		if (first == -1) {
			html = commonParent.innerHTML;
		} else {
			// it can equal to the children.length, when the node had been removed
			if (first < 0 || first > commonParent.children.length) {
				throw "EvoUndoRedo::StopRecord: firstChildIndex (" + first + ") out of bounds (" + commonParent.children.length + ")";
			}

			last = commonParent.children.length - record.restChildrenCount;
			if (last < 0 || last < first) {
				throw "EvoUndoRedo::StopRecord: restChildrenCount (" + record.restChildrenCount + ") out of bounds (length:" +
					commonParent.children.length + " first:" + first + " last:" + last + ")";
			}

			for (ii = first; ii < last; ii++) {
				if (ii >= 0 && ii < commonParent.children.length) {
					html += commonParent.children.item(ii).outerHTML;
				}
			}
		}

		// some formatting commands do not change HTML structure immediately, thus ignore those
		if (kind == EvoUndoRedo.RECORD_KIND_EVENT && record.htmlBefore == html) {
			if (!EvoUndoRedo.ongoingRecordings.length && record.opType != "insertText") {
				EvoUndoRedo.stack.maybeMergeInsertText(false);
			}

			return false;
		}

		record.htmlAfter = html;
	}

	record.selectionAfter = EvoSelection.Store(document);

	if (EvoUndoRedo.ongoingRecordings.length) {
		var parentRecord = EvoUndoRedo.ongoingRecordings[EvoUndoRedo.ongoingRecordings.length - 1];
		var records = parentRecord.records;

		if (!records) {
			records = [];
		}

		records[records.length] = record;
		parentRecord.records = records;
	} else {
		EvoUndoRedo.stack.push(record);

		if (record.kind == EvoUndoRedo.RECORD_KIND_EVENT && record.opType == "insertText::WordDelim") {
			EvoUndoRedo.stack.maybeMergeConsecutive(true, "insertText");
			EvoUndoRedo.stack.maybeMergeConsecutive(false, "insertText::WordDelim");
		} else if (record.kind != EvoUndoRedo.RECORD_KIND_EVENT || record.opType != "insertText") {
			EvoUndoRedo.stack.maybeMergeInsertText(true);
		}
	}

	return true;
}

EvoUndoRedo.Undo = function()
{
	var record = EvoUndoRedo.stack.undo();

	if (!record)
		return;

	EvoUndoRedo.applyRecord(record, true, true);
	EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_YES);
	EvoEditor.EmitContentChanged();
}

EvoUndoRedo.Redo = function()
{
	var record = EvoUndoRedo.stack.redo();

	if (!record)
		return;

	EvoUndoRedo.applyRecord(record, false, true);
	EvoEditor.maybeUpdateFormattingState(EvoEditor.FORCE_YES);
	EvoEditor.EmitContentChanged();
}

EvoUndoRedo.Clear = function()
{
	EvoUndoRedo.stack.clear();
}

EvoUndoRedo.Attach();
