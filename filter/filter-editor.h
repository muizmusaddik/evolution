/*
 *  Copyright (C) 2000 Helix Code Inc.
 *
 *  Authors: Not Zed <notzed@lostzed.mmc.com.au>
 *
 *  This program is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Library General Public License
 *  as published by the Free Software Foundation; either version 2 of
 *  the License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Library General Public License for more details.
 *
 *  You should have received a copy of the GNU Library General Public
 *  License along with this program; if not, write to the Free Software
 *  Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
 */

#ifndef _FILTER_EDITOR_H
#define _FILTER_EDITOR_H

#include <gtk/gtk.h>
#include <libgnomeui/gnome-dialog.h>

#if 0
/* NOTE: object stuff not used (yet?), this is just a holder file for a static factory */

#define FILTER_EDITOR(obj)	GTK_CHECK_CAST (obj, filter_editor_get_type (), FilterEditor)
#define FILTER_EDITOR_CLASS(klass)	GTK_CHECK_CLASS_CAST (klass, filter_editor_get_type (), FilterEditorClass)
#define IS_FILTER_EDITOR(obj)      GTK_CHECK_TYPE (obj, filter_editor_get_type ())

typedef struct _FilterEditor	FilterEditor;
typedef struct _FilterEditorClass	FilterEditorClass;

struct _FilterEditor {
	GnomeDialog parent;
	struct _FilterEditorPrivate *priv;

};

struct _FilterEditorClass {
	GnomeDialogClass parent_class;

	/* virtual methods */

	/* signals */
};

guint		filter_editor_get_type	(void);
FilterEditor	*filter_editor_new	(void);
#endif

struct _FilterContext;

/* methods */
GtkWidget	*filter_editor_construct	(struct _FilterContext *f);

#endif /* ! _FILTER_EDITOR_H */

