/* -*- Mode: C; tab-width: 8; indent-tabs-mode: t; c-basic-offset: 8 -*- */
#ifndef _E_TREE_SORTED_VARIABLE_H_
#define _E_TREE_SORTED_VARIABLE_H_

#include <gtk/gtkobject.h>
#include <gal/e-tree/e-tree-model.h>
#include <gal/e-table/e-table-subset-variable.h>
#include <gal/e-table/e-table-sort-info.h>
#include <gal/e-table/e-table-header.h>

G_BEGIN_DECLS

#define E_TREE_SORTED_VARIABLE_TYPE        (e_tree_sorted_variable_get_type ())
#define E_TREE_SORTED_VARIABLE(o)          (GTK_CHECK_CAST ((o), E_TREE_SORTED_VARIABLE_TYPE, ETreeSortedVariable))
#define E_TREE_SORTED_VARIABLE_CLASS(k)    (GTK_CHECK_CLASS_CAST((k), E_TREE_SORTED_VARIABLE_TYPE, ETreeSortedVariableClass))
#define E_IS_TREE_SORTED_VARIABLE(o)       (GTK_CHECK_TYPE ((o), E_TREE_SORTED_VARIABLE_TYPE))
#define E_IS_TREE_SORTED_VARIABLE_CLASS(k) (GTK_CHECK_CLASS_TYPE ((k), E_TREE_SORTED_VARIABLE_TYPE))

typedef struct {
	ETreeModel base;

	ETableSortInfo *sort_info;
	
	ETableHeader *full_header;

	int              table_model_changed_id;
	int              table_model_row_changed_id;
	int              table_model_cell_changed_id;
	int              sort_info_changed_id;
	int              sort_idle_id;
	int		 insert_idle_id;
	int		 insert_count;

} ETreeSortedVariable;

typedef struct {
	ETreeModelClass parent_class;
} ETreeSortedVariableClass;

GtkType      e_tree_sorted_variable_get_type        (void);
ETableModel *e_tree_sorted_variable_new             (ETreeModel          *etm,
						     ETableHeader        *header,
						     ETableSortInfo      *sort_info);

ETreeModel  *e_tree_sorted_get_toplevel             (ETreeSortedVariable *tree_model);

void         e_tree_sorted_variable_add             (ETreeSortedVariable *ets,
						     gint                 row);
void         e_tree_sorted_variable_add_all         (ETreeSortedVariable *ets);
gboolean     e_tree_sorted_variable_remove          (ETreeSortedVariable *ets,
						     gint                 row);
void         e_tree_sorted_variable_increment       (ETreeSortedVariable *ets,
						     gint                 position,
						     gint                 amount);
void         e_tree_sorted_variable_decrement       (ETreeSortedVariable *ets,
						     gint                 position,
						     gint                 amount);
void         e_tree_sorted_variable_set_allocation  (ETreeSortedVariable *ets,
						     gint                 total);
G_END_DECLS

#endif /* _E_TREE_SORTED_VARIABLE_H_ */
