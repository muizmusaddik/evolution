/* -*- Mode: C; tab-width: 8; indent-tabs-mode: t; c-basic-offset: 8 -*- */
/*
 *  Authors: Jeffrey Stedfast <fejj@ximian.com>
 *
 *  Copyright 2002 Ximian, Inc. (www.ximian.com)
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Street #330, Boston, MA 02111-1307, USA.
 *
 */


#ifndef __FILTER_LABEL__
#define __FILTER_LABEL__

#ifdef __cplusplus
extern "C" {
#pragma }
#endif /* __cplusplus */

#include "filter-option.h"

#define FILTER_LABEL(obj)         GTK_CHECK_CAST (obj, filter_label_get_type (), FilterLabel)
#define FILTER_LABEL_CLASS(klass) GTK_CHECK_CLASS_CAST (klass, filter_label_get_type (), FilterLabelClass)
#define IS_FILTER_LABEL(obj)      GTK_CHECK_TYPE (obj, filter_label_get_type ())

typedef struct _FilterLabel FilterLabel;
typedef struct _FilterLabelClass FilterLabelClass;

struct _FilterLabel {
	FilterOption parent;
};

struct _FilterLabelClass {
	FilterOptionClass parent_class;
	
	/* virtual methods */
	
	/* signals */
};

GtkType filter_label_get_type (void);

FilterLabel *filter_label_new (void);

/* Sigh, this is a mess, but its cleaner than the original mess */
int filter_label_count(void);
const char *filter_label_label(int i);
int filter_label_index(const char *label);

#ifdef __cplusplus
}
#endif /* __cplusplus */

#endif /* __FILTER_LABEL__ */
