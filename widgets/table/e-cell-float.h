/* -*- Mode: C; tab-width: 8; indent-tabs-mode: t; c-basic-offset: 8 -*- */
/*
 * Copyright (C) 2001 CodeFactory AB
 * Copyright (C) 2001 Mikael Hallendal <micke@codefactory.se>
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public
 * License along with this program; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place - Suite 330,
 * Boston, MA 02111-1307, USA.
 *
 * Derived from e-cell-number by Chros Lahey <clahey@ximian.com>
 * ECellFloat - Float item for e-table.
 *
 * Author: Mikael Hallendal <micke@codefactory.se>
 */

#ifndef _E_CELL_FLOAT_H_
#define _E_CELL_FLOAT_H_

#include <gal/e-table/e-cell-text.h>

G_BEGIN_DECLS

#define E_CELL_FLOAT_TYPE        (e_cell_float_get_type ())
#define E_CELL_FLOAT(o)          (GTK_CHECK_CAST ((o), E_CELL_FLOAT_TYPE, ECellFloat))
#define E_CELL_FLOAT_CLASS(k)    (GTK_CHECK_CLASS_CAST((k), E_CELL_FLOAT_TYPE, ECellFloatClass))
#define E_IS_CELL_FLOAT(o)       (GTK_CHECK_TYPE ((o), E_CELL_FLOAT_TYPE))
#define E_IS_CELL_FLOAT_CLASS(k) (GTK_CHECK_CLASS_TYPE ((k), E_CELL_FLOAT_TYPE))

typedef struct {
	ECellText base;
} ECellFloat;

typedef struct {
	ECellTextClass parent_class;
} ECellFloatClass;

GtkType    e_cell_float_get_type (void);
ECell     *e_cell_float_new      (const char *fontname, GtkJustification justify);

G_END_DECLS

#endif /* _E_CELL_FLOAT_H_ */
