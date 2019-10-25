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

	/* Flags for StartRecord() */
	FLAG_NONE : 0,
	FLAG_USE_PARENT_BLOCK_NODE : 1 << 0,
	FLAG_SAVE_HTML : 1 << 1,

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

EvoUndoRedo.before_input_cb = function(inputEvent)
{
	if (EvoUndoRedo.disabled) {
		return;
	}

	var opType = inputEvent.inputType, useParentBlockNode = false;

	if (opType == "" || // some WebKit-specific editing commands use this
	    opType.startsWith("format") ||
	    opType == "insertLineBreak" ||
	    opType == "insertParagraph") {
		useParentBlockNode = true;
		var startNode;

		startNode = document.getSelection().baseNode;

		if (!startNode) {
			startNode = document.body;
		}

		while (startNode && !(startNode === document.body)) {
			if (EvoEditor.IsBlockNode(startNode)) {
				break;
			}

			startNode = startNode.parentElement;
		}
	}

	EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_EVENT, opType, startNode, null,
		EvoUndoRedo.FLAG_SAVE_HTML | (useParentBlockNode ? EvoUndoRedo.FLAG_USE_PARENT_BLOCK_NODE : EvoUndoRedo.FLAG_NONE));
}

EvoUndoRedo.input_cb = function(inputEvent)
{
	if (EvoUndoRedo.disabled) {
		return;
	}

	EvoUndoRedo.StopRecord(EvoUndoRedo.RECORD_KIND_EVENT, inputEvent.inputType);
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
				document.documentElement.outerHTML = record.htmlBefore;
			} else {
				document.documentElement.outerHTML = record.htmlAfter;
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

			if (first + 1 < commonParent.children.length) {
				first = commonParent.children.item(first + 1);

				for (ii = tmpNode.children.length - 1; ii >= 0; ii--) {
					commonParent.insertBefore(tmpNode.children.item(ii), first);
				}
			} else {
				while(tmpNode.children.length) {
					commonParent.appendChild(tmpNode.children.item(0));
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

	var record = {}, saveHTML;

	saveHTML = (flags & EvoUndoRedo.FLAG_SAVE_HTML) != 0;

	record.kind = kind;
	record.opType = opType;
	record.selectionBefore = EvoSelection.Store(document);

	if (kind == EvoUndoRedo.RECORD_KIND_DOCUMENT) {
		record.htmlBefore = document.documentElement.outerHTML;
	} else if (kind != EvoUndoRedo.RECORD_KIND_GROUP) {
		var affected;

		affected = EvoEditor.ClaimAffectedContent(startNode, endNode, (flags & EvoUndoRedo.FLAG_USE_PARENT_BLOCK_NODE) != 0, saveHTML);

		record.path = affected.path;
		record.firstChildIndex = affected.firstChildIndex;
		record.restChildrenCount = affected.restChildrenCount;

		if (saveHTML)
			record.htmlBefore = affected.html;
	}

	EvoUndoRedo.ongoingRecordings[EvoUndoRedo.ongoingRecordings.length] = record;

	return record;
}

EvoUndoRedo.StopRecord = function(kind, opType)
{
	if (EvoUndoRedo.disabled) {
		return;
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

	record.selectionAfter = EvoSelection.Store(document);

	if (kind == EvoUndoRedo.RECORD_KIND_DOCUMENT) {
		record.htmlAfter = document.documentElement.outerHTML;
	} else if (record.htmlBefore != window.undefined) {
		var commonParent, first, last, ii, html = "";

		commonParent = EvoSelection.FindElementByPath(document.body, record.path);

		if (!commonParent) {
			throw "EvoUndoRedo.StopRecord:: Failed to stop '" + opType + "', cannot find common parent";
		}

		first = record.firstChildIndex;

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

		record.htmlAfter = html;
	}

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
	}
}

EvoUndoRedo.Undo = function()
{
	var record = EvoUndoRedo.stack.undo();

	EvoUndoRedo.applyRecord(record, true, true);
}

EvoUndoRedo.Redo = function()
{
	var record = EvoUndoRedo.stack.redo();

	EvoUndoRedo.applyRecord(record, false, true);
}

EvoUndoRedo.Clear = function()
{
	EvoUndoRedo.stack.clear();
}

EvoUndoRedo.Attach();
