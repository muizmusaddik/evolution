/* -*- Mode: C; tab-width: 8; indent-tabs-mode: t; c-basic-offset: 8 -*- */
#ifndef _E_TABLE_SORTER_H_
#define _E_TABLE_SORTER_H_

#include <gtk/gtkobject.h>
#include <gal/util/e-sorter.h>
#include <gal/e-table/e-table-model.h>
#include <gal/e-table/e-table-subset-variable.h>
#include <gal/e-table/e-table-sort-info.h>
#include <gal/e-table/e-table-header.h>

G_BEGIN_DECLS

#define E_TABLE_SORTER_TYPE        (e_table_sorter_get_type ())
#define E_TABLE_SORTER(o)          (GTK_CHECK_CAST ((o), E_TABLE_SORTER_TYPE, ETableSorter))
#define E_TABLE_SORTER_CLASS(k)    (GTK_CHECK_CLASS_CAST((k), E_TABLE_SORTER_TYPE, ETableSorterClass))
#define E_IS_TABLE_SORTER(o)       (GTK_CHECK_TYPE ((o), E_TABLE_SORTER_TYPE))
#define E_IS_TABLE_SORTER_CLASS(k) (GTK_CHECK_CLASS_TYPE ((k), E_TABLE_SORTER_TYPE))

typedef struct {
	ESorter base;

	ETableModel    *source;
	ETableHeader   *full_header;
	ETableSortInfo *sort_info;

	/* If needs_sorting is 0, then model_to_sorted and sorted_to_model are no-ops. */
	int             needs_sorting;

	int            *sorted;
	int            *backsorted;

	int             table_model_changed_id;
	int             table_model_row_changed_id;
	int             table_model_cell_changed_id;
	int             sort_info_changed_id;
} ETableSorter;

typedef struct {
	ESorterClass parent_class;
} ETableSorterClass;

GtkType       e_table_sorter_get_type                   (void);
ETableSorter *e_table_sorter_new                        (ETableModel     *etm,
							 ETableHeader    *full_header,
							 ETableSortInfo  *sort_info);
G_END_DECLS

#endif /* _E_TABLE_SORTER_H_ */
