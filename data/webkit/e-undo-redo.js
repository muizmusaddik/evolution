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
			undoOpType = undoRecord ? undoRecord["opType"] : "";
			redoAvailable = redoRecord != null;
			redoOpType = redoRecord ? redoRecord["opType"] : "";

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

				params["state"] = EvoUndoRedo.state;
				params["undoOpType"] = EvoUndoRedo.undoOpType;
				params["redoOpType"] = EvoUndoRedo.redoOpType;

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
	document.documentElement.onbeforeinput = EvoUndoRedo.before_input_cb;
	document.documentElement.oninput = EvoUndoRedo.input_cb;
}

EvoUndoRedo.Detach = function()
{
	document.documentElement.onbeforeinput = null;
	document.documentElement.oninput = null;
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

	EvoUndoRedo.StartRecord(EvoUndoRedo.RECORD_KIND_EVENT, inputEvent.inputType, null, null);
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

	if (record["kind"] == EvoUndoRedo.RECORD_KIND_GROUP) {
		var ii, records;

		records = record["records"];

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
				EvoSelection.Restore(document, record["selectionBefore"]);
			} else {
				EvoSelection.Restore(document, record["selectionAfter"]);
			}
		}

		return;
	}

	EvoUndoRedo.Disable();

	try {
		var commonParent, first, last, ii;

		commonParent = EvoSelection.FindElementByPath(document.body, record["path"]);
		if (!commonParent) {
			throw "EvoUndoRedo::applyRecord: Cannot find parent at path " + record["path"];
		}

		first = record["firstChildIndex"];

		// it can equal to the children.length, when the node had been removed
		if (first < 0 || first > commonParent.children.length) {
			throw "EvoUndoRedo::applyRecord: firstChildIndex (" + first + ") out of bounds (" + commonParent.children.length + ")";
		}

		last = commonParent.children.length - record["restChildrenCount"];
		if (last < 0 || last < first) {
			throw "EvoUndoRedo::applyRecord: restChildrenCount (" + record["restChildrenCount"] + ") out of bounds (length:" +
				commonParent.children.length + " first:" + first + " last:" + last + ")";
		}

		for (ii = last - 1; ii >= first; ii--) {
			if (ii >= 0 && ii < commonParent.children.length) {
				commonParent.removeChild(commonParent.children.item(ii));
			}
		}

		var tmpNode = document.createElement("evo-tmp");

		if (isUndo) {
			tmpNode.innerHTML = record["htmlBefore"];
		} else {
			tmpNode.innerHTML = record["htmlAfter"];
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

		if (withSelection) {
			if (isUndo) {
				EvoSelection.Restore(document, record["selectionBefore"]);
			} else {
				EvoSelection.Restore(document, record["selectionAfter"]);
			}
		}
	} finally {
		EvoUndoRedo.Enable();
	}
}

EvoUndoRedo.getCommonParent = function(firstNode, secondNode)
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

	var commonParent, secondParent;

	for (commonParent = firstNode.parentElement; commonParent; commonParent = commonParent.parentElement) {
		if (commonParent === document.body) {
			break;
		}

		for (secondParent = secondNode.parentElement; secondNode; secondNode = secondNode.parentElement) {
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

EvoUndoRedo.getDirectChild = function(parent, child)
{
	if (!parent || !child || parent === child) {
		return null;
	}

	while (child && !(child.parentElement === parent)) {
		child = child.parentElement;
	}

	return child;
}

EvoUndoRedo.StartRecord = function(kind, opType, startNode, endNode)
{
	if (EvoUndoRedo.disabled) {
		return;
	}

	var record = {};

	record["kind"] = kind;
	record["opType"] = opType;
	record["selectionBefore"] = EvoSelection.Store(document);

	if (kind != EvoUndoRedo.RECORD_KIND_GROUP) {
		var commonParent, startChild, endChild;
		var firstChildIndex = -1, html = "", ii;

		if (!startNode) {
			startNode = document.getSelection().baseNode;
			endNode = document.getSelection().extentNode;

			if (!startNode) {
				startNode = document.body;
			}
		}

		if (!endNode) {
			endNode = startNode;
		}

		/* Tweak what to save, because some events do not modify only selection, but also its parent elements */
		if (kind == EvoUndoRedo.RECORD_KIND_EVENT) {
			if (opType == "insertLineBreak" ||
			    opType == "insertParagraph") {
				while (startNode && !(startNode === document.body)) {
					if (startNode.tagName == "P" ||
					    startNode.tagName == "DIV" ||
					    startNode.tagName == "BLOCKQUOTE" ||
					    startNode.tagName == "U" ||
					    startNode.tagName == "O" ||
					    startNode.tagName == "PRE" ||
					    startNode.tagName == "H1" ||
					    startNode.tagName == "H2" ||
					    startNode.tagName == "H3" ||
					    startNode.tagName == "H4" ||
					    startNode.tagName == "H5" ||
					    startNode.tagName == "H6" ||
					    startNode.tagName == "ADDRESS" ||
					    startNode.tagName == "TD" ||
					    startNode.tagName == "TH") {
						break;
					}

					startNode = startNode.parentElement;
				}
			}
		}

		commonParent = EvoUndoRedo.getCommonParent(startNode, endNode);
		startChild = EvoUndoRedo.getDirectChild(commonParent, startNode);
		endChild = EvoUndoRedo.getDirectChild(commonParent, endNode);

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
				html += child.outerHTML;

				if (child === endChild) {
					ii++;
					break;
				}
			}
		}

		record["path"] = EvoSelection.GetChildPath(document.body, commonParent);
		record["firstChildIndex"] = firstChildIndex;
		record["restChildrenCount"] = commonParent.children.length - ii;
		record["htmlBefore"] = html;
	}

	EvoUndoRedo.ongoingRecordings[EvoUndoRedo.ongoingRecordings.length] = record;
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

	if (record["kind"] != kind) {
		throw "EvoUndoRedo:StopRecord: Mismatch in record kind, expected " + record["kind"] + ", but received " + kind;
	}

	if (record["opType"] != opType) {
		throw "EvoUndoRedo:StopRecord: Mismatch in record opType, expected '" + record["opType"] + "', but received '" + opType + "'";
	}

	EvoUndoRedo.ongoingRecordings.length = EvoUndoRedo.ongoingRecordings.length - 1;

	record["selectionAfter"] = EvoSelection.Store(document);

	if (kind != EvoUndoRedo.RECORD_KIND_GROUP) {
		var commonParent, first, last, ii, html = "";

		commonParent = EvoSelection.FindElementByPath(document.body, record["path"]);

		if (!commonParent) {
			throw "EvoUndoRedo.StopRecord:: Failed to stop '" + opType + "', cannot find common parent";
		}

		first = record["firstChildIndex"];

		// it can equal to the children.length, when the node had been removed
		if (first < 0 || first > commonParent.children.length) {
			throw "EvoUndoRedo::StopRecord: firstChildIndex (" + first + ") out of bounds (" + commonParent.children.length + ")";
		}

		last = commonParent.children.length - record["restChildrenCount"];
		if (last < 0 || last < first) {
			throw "EvoUndoRedo::StopRecord: restChildrenCount (" + record["restChildrenCount"] + ") out of bounds (length:" +
				commonParent.children.length + " first:" + first + " last:" + last + ")";
		}

		for (ii = first; ii < last; ii++) {
			if (ii >= 0 && ii < commonParent.children.length) {
				html += commonParent.children.item(ii).outerHTML;
			}
		}

		record["htmlAfter"] = html;
	}

	if (EvoUndoRedo.ongoingRecordings.length) {
		var parentRecord = EvoUndoRedo.ongoingRecordings[EvoUndoRedo.ongoingRecordings.length - 1];
		var records = parentRecord["records"];
		if (!records) {
			records = [];
		}
		records[records.length] = record;
		parentRecord["records"] = records;
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
