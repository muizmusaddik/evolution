/* Evolution calendar - Main page of the task editor dialog
 *
 * Copyright (C) 2001 Ximian, Inc.
 *
 * Authors: Federico Mena-Quintero <federico@ximian.com>
 *          Miguel de Icaza <miguel@ximian.com>
 *          Seth Alves <alves@hungry.com>
 *          JP Rosevear <jpr@ximian.com>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA 02111-1307, USA.
 */

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include <gtk/gtksignal.h>
#include <gtk/gtktogglebutton.h>
#include <glade/glade.h>
#include <gal/widgets/e-unicode.h>
#include <widgets/misc/e-dateedit.h>
#include "e-util/e-dialog-widgets.h"
#include "../calendar-config.h"
#include "../e-timezone-entry.h"
#include "comp-editor-util.h"
#include "task-details-page.h"



/* Private part of the TaskDetailsPage structure */
struct _TaskDetailsPagePrivate {
	/* Glade XML data */
	GladeXML *xml;

	/* Widgets from the Glade file */
	GtkWidget *main;

	GtkWidget *summary;
	GtkWidget *date_time;
	
	GtkWidget *completed_date;

	GtkWidget *url;

	GtkWidget *organizer;
	GtkWidget *organizer_lbl;
	GtkWidget *delegated_to;
	GtkWidget *delegated_to_lbl;
	GtkWidget *delegated_from;
	GtkWidget *delegated_from_lbl;	

	gboolean updating;
};



static void task_details_page_class_init (TaskDetailsPageClass *class);
static void task_details_page_init (TaskDetailsPage *tdpage);
static void task_details_page_destroy (GtkObject *object);

static GtkWidget *task_details_page_get_widget (CompEditorPage *page);
static void task_details_page_focus_main_widget (CompEditorPage *page);
static void task_details_page_fill_widgets (CompEditorPage *page, CalComponent *comp);
static void task_details_page_fill_component (CompEditorPage *page, CalComponent *comp);
static void task_details_page_set_summary (CompEditorPage *page, const char *summary);
static void task_details_page_set_dates (CompEditorPage *page, CompEditorPageDates *dates);

static CompEditorPageClass *parent_class = NULL;



/**
 * task_details_page_get_type:
 * 
 * Registers the #TaskDetailsPage class if necessary, and returns the type ID
 * associated to it.
 * 
 * Return value: The type ID of the #TaskDetailsPage class.
 **/
GtkType
task_details_page_get_type (void)
{
	static GtkType task_details_page_type;

	if (!task_details_page_type) {
		static const GtkTypeInfo task_details_page_info = {
			"TaskDetailsPage",
			sizeof (TaskDetailsPage),
			sizeof (TaskDetailsPageClass),
			(GtkClassInitFunc) task_details_page_class_init,
			(GtkObjectInitFunc) task_details_page_init,
			NULL, /* reserved_1 */
			NULL, /* reserved_2 */
			(GtkClassInitFunc) NULL
		};

		task_details_page_type = 
			gtk_type_unique (TYPE_COMP_EDITOR_PAGE,
					 &task_details_page_info);
	}

	return task_details_page_type;
}

/* Class initialization function for the task page */
static void
task_details_page_class_init (TaskDetailsPageClass *class)
{
	CompEditorPageClass *editor_page_class;
	GtkObjectClass *object_class;

	editor_page_class = (CompEditorPageClass *) class;
	object_class = (GtkObjectClass *) class;

	parent_class = gtk_type_class (TYPE_COMP_EDITOR_PAGE);

	editor_page_class->get_widget = task_details_page_get_widget;
	editor_page_class->focus_main_widget = task_details_page_focus_main_widget;
	editor_page_class->fill_widgets = task_details_page_fill_widgets;
	editor_page_class->fill_component = task_details_page_fill_component;
	editor_page_class->set_summary = task_details_page_set_summary;
	editor_page_class->set_dates = task_details_page_set_dates;

	object_class->destroy = task_details_page_destroy;
}

/* Object initialization function for the task page */
static void
task_details_page_init (TaskDetailsPage *tdpage)
{
	TaskDetailsPagePrivate *priv;

	priv = g_new0 (TaskDetailsPagePrivate, 1);
	tdpage->priv = priv;

	priv->xml = NULL;

	priv->main = NULL;
	priv->summary = NULL;
	priv->date_time = NULL;
	priv->completed_date = NULL;
	priv->url = NULL;

	priv->updating = FALSE;
}

/* Destroy handler for the task page */
static void
task_details_page_destroy (GtkObject *object)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;

	g_return_if_fail (object != NULL);
	g_return_if_fail (IS_TASK_DETAILS_PAGE (object));

	tdpage = TASK_DETAILS_PAGE (object);
	priv = tdpage->priv;

	if (priv->xml) {
		gtk_object_unref (GTK_OBJECT (priv->xml));
		priv->xml = NULL;
	}

	g_free (priv);
	tdpage->priv = NULL;

	if (GTK_OBJECT_CLASS (parent_class)->destroy)
		(* GTK_OBJECT_CLASS (parent_class)->destroy) (object);
}



/* get_widget handler for the task page */
static GtkWidget *
task_details_page_get_widget (CompEditorPage *page)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;

	tdpage = TASK_DETAILS_PAGE (page);
	priv = tdpage->priv;

	return priv->main;
}

/* focus_main_widget handler for the task page */
static void
task_details_page_focus_main_widget (CompEditorPage *page)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;

	tdpage = TASK_DETAILS_PAGE (page);
	priv = tdpage->priv;

	gtk_widget_grab_focus (priv->organizer);
}

/* Fills the widgets with default values */
static void
clear_widgets (TaskDetailsPage *tdpage)
{
	TaskDetailsPagePrivate *priv;

	priv = tdpage->priv;

	/* Summary */
	gtk_label_set_text (GTK_LABEL (priv->summary), "");

	/* Start date */
	gtk_label_set_text (GTK_LABEL (priv->date_time), "");

	/* Date completed */
	e_date_edit_set_time (E_DATE_EDIT (priv->completed_date), -1);

	/* URL */
	e_dialog_editable_set (priv->url, NULL);
}

/* fill_widgets handler for the task page */
static void
task_details_page_fill_widgets (CompEditorPage *page, CalComponent *comp)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;
	GSList *list;
	CalComponentText text;
	CalComponentOrganizer organizer;
	const char *url;
	CompEditorPageDates dates;
	
	tdpage = TASK_DETAILS_PAGE (page);
	priv = tdpage->priv;

	priv->updating = TRUE;
	
	/* Clean the screen */
	clear_widgets (tdpage);
	
	/* Summary */
	cal_component_get_summary (comp, &text);
	task_details_page_set_summary (page, text.value);

	/* Dates */
	comp_editor_dates (&dates, comp);
	task_details_page_set_dates (page, &dates);
	
	/* URL */
	cal_component_get_url (comp, &url);
	e_dialog_editable_set (priv->url, url);

	/* Delegation */
	cal_component_get_organizer (comp, &organizer);
	if (organizer.value)
		e_dialog_editable_set (priv->organizer, organizer.value);

	cal_component_get_attendee_list (comp, &list);
	if (list != NULL) {
		CalComponentAttendee *attendee;
		
		attendee = list->data;
		if (attendee->delto)
			e_dialog_editable_set (priv->delegated_to, attendee->delto);
		if (attendee->delfrom) {
			gchar *s = e_utf8_to_gtk_string (priv->delegated_from, attendee->delfrom);
			gtk_label_set_text (GTK_LABEL (priv->delegated_from), s);
			g_free (s);
		}
	}
	cal_component_free_attendee_list (list);
	
	priv->updating = FALSE;
}

/* fill_component handler for the task page */
static void
task_details_page_fill_component (CompEditorPage *page, CalComponent *comp)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;
	struct icaltimetype icaltime;
	GSList list;
	CalComponentOrganizer organizer;
	CalComponentAttendee attendee;
	char *url;
	gboolean date_set;
	
	tdpage = TASK_DETAILS_PAGE (page);
	priv = tdpage->priv;

	icaltime = icaltime_null_time ();

	/* COMPLETED must be in UTC. */
	icaltime.is_utc = 1;

	/* Completed Date. */
	date_set = e_date_edit_get_date (E_DATE_EDIT (priv->completed_date),
					 &icaltime.year,
					 &icaltime.month,
					 &icaltime.day);
	e_date_edit_get_time_of_day (E_DATE_EDIT (priv->completed_date),
				     &icaltime.hour,
				     &icaltime.minute);
	if (date_set) {
		/* COMPLETED must be in UTC, so we assume that the date in the
		   dialog is in the current timezone, and we now convert it
		   to UTC. FIXME: We should really use one timezone for the
		   entire time the dialog is shown. Otherwise if the user
		   changes the timezone, the COMPLETED date may get changed
		   as well. */
		char *location = calendar_config_get_timezone ();
		icaltimezone *zone = icaltimezone_get_builtin_timezone (location);
		icaltimezone_convert_time (&icaltime, zone,
					   icaltimezone_get_utc_timezone ());
		cal_component_set_completed (comp, &icaltime);
	} else {
		cal_component_set_completed (comp, NULL);
	}

	/* URL. */
	url = e_dialog_editable_get (priv->url);
	cal_component_set_url (comp, url);
	if (url)
		g_free (url);

	/* Delegation */
	organizer.value = e_dialog_editable_get (priv->organizer);
	organizer.sentby = NULL;
	organizer.cn = NULL;
	organizer.language = NULL;
	cal_component_set_organizer (comp, &organizer);
	attendee.value = e_dialog_editable_get (priv->delegated_to);
	attendee.member = NULL;
	attendee.cutype = CAL_COMPONENT_CUTYPE_INDIVIDUAL;
	attendee.role = CAL_COMPONENT_ROLE_REQUIRED;
	attendee.status = CAL_COMPONENT_PARTSTAT_NEEDSACTION;
	attendee.rsvp = TRUE;
	attendee.delto = e_dialog_editable_get (priv->delegated_to);
	attendee.delfrom = NULL;
	attendee.sentby = NULL;
	attendee.cn = NULL;
	attendee.language = NULL;
	list.data = &attendee;
	list.next = NULL;
	cal_component_set_attendee_list (comp, &list);
	g_free ((char *)organizer.value);
	g_free ((char *)attendee.value);
	g_free ((char *)attendee.delto);
	g_free ((char *)attendee.delfrom);
}

/* set_summary handler for the task page */
static void
task_details_page_set_summary (CompEditorPage *page, const char *summary)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;
	gchar *s;
	
	tdpage = TASK_DETAILS_PAGE (page);
	priv = tdpage->priv;

	s = e_utf8_to_gtk_string (priv->summary, summary);
	gtk_label_set_text (GTK_LABEL (priv->summary), s);
	g_free (s);
}

static void
task_details_page_set_dates (CompEditorPage *page, CompEditorPageDates *dates)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;

	tdpage = TASK_DETAILS_PAGE (page);
	priv = tdpage->priv;

	comp_editor_date_label (dates, priv->date_time);

	if (dates->complete) {
		if (icaltime_is_null_time (*dates->complete)) {
			e_date_edit_set_time (E_DATE_EDIT (priv->completed_date), -1);
		} else {
			struct icaltimetype *tt = dates->complete;

			/* Convert it from UTC to local time to display.
			   FIXME: We should really use one timezone for the
			   entire time the dialog is shown. Otherwise if the
			   user changes the timezone, the COMPLETED date may
			   get changed as well. */
			char *location = calendar_config_get_timezone ();
			icaltimezone *zone = icaltimezone_get_builtin_timezone (location);
			icaltimezone_convert_time (tt,
						   icaltimezone_get_utc_timezone (),
						   zone);

			e_date_edit_set_date (E_DATE_EDIT (priv->completed_date),
					      tt->year, tt->month, tt->day);
			e_date_edit_set_time_of_day (E_DATE_EDIT (priv->completed_date),
						     tt->hour, tt->minute);
		}
	}
}



/* Gets the widgets from the XML file and returns if they are all available. */
static gboolean
get_widgets (TaskDetailsPage *tdpage)
{
	TaskDetailsPagePrivate *priv;

	priv = tdpage->priv;

#define GW(name) glade_xml_get_widget (priv->xml, name)

	priv->main = GW ("task-details-page");
	if (!priv->main)
		return FALSE;

	gtk_widget_ref (priv->main);
	gtk_widget_unparent (priv->main);

	priv->summary = GW ("summary");
	priv->date_time = GW ("date-time");

	priv->completed_date = GW ("completed-date");

	priv->url = GW ("url");

	priv->organizer = GW ("organizer");
	priv->organizer_lbl = GW ("organizer-label");
	priv->delegated_to = GW ("delegated-to");
	priv->delegated_to_lbl = GW ("delegated-to-label");
	priv->delegated_from = GW ("delegated-from");
	priv->delegated_from_lbl = GW ("delegated-from-label");

#undef GW

	return (priv->summary
		&& priv->date_time
		&& priv->completed_date
		&& priv->url
		&& priv->organizer
		&& priv->organizer_lbl
		&& priv->delegated_to
		&& priv->delegated_to_lbl
		&& priv->delegated_from
		&& priv->delegated_from_lbl);
}

/* Callback used when the start or end date widgets change.  We check that the
 * start date < end date and we set the "all day task" button as appropriate.
 */
static void
date_changed_cb (EDateEdit *dedit, gpointer data)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;
	CompEditorPageDates dates;
	struct icaltimetype completed_tt = icaltime_null_time();
	gboolean date_set;

	tdpage = TASK_DETAILS_PAGE (data);
	priv = tdpage->priv;

	if (priv->updating)
		return;

	date_set = e_date_edit_get_date (E_DATE_EDIT (priv->completed_date),
					 &completed_tt.year,
					 &completed_tt.month,
					 &completed_tt.day);
	e_date_edit_get_time_of_day (E_DATE_EDIT (priv->completed_date),
				     &completed_tt.hour,
				     &completed_tt.minute);
	if (!date_set)
		completed_tt = icaltime_null_time ();

	dates.start = NULL;
	dates.end = NULL;
	dates.due = NULL;
	dates.complete = &completed_tt;
	
	/* Notify upstream */
	comp_editor_page_notify_dates_changed (COMP_EDITOR_PAGE (tdpage), &dates);
}

/* This is called when any field is changed; it notifies upstream. */
static void
field_changed_cb (GtkWidget *widget, gpointer data)
{
	TaskDetailsPage *tdpage;
	TaskDetailsPagePrivate *priv;
	
	tdpage = TASK_DETAILS_PAGE (data);
	priv = tdpage->priv;
	
	if (!priv->updating)
		comp_editor_page_notify_changed (COMP_EDITOR_PAGE (tdpage));
}

/* Hooks the widget signals */
static void
init_widgets (TaskDetailsPage *tdpage)
{
	TaskDetailsPagePrivate *priv;

	priv = tdpage->priv;

	/* Make sure the EDateEdit widgets use our timezones to get the
	   current time. */
	e_date_edit_set_get_time_callback (E_DATE_EDIT (priv->completed_date),
					   (EDateEditGetTimeCallback) comp_editor_get_current_time,
					   tdpage, NULL);

	/* Completed Date */
	gtk_signal_connect (GTK_OBJECT (priv->completed_date), "changed",
			    GTK_SIGNAL_FUNC (date_changed_cb), tdpage);

	/* URL */
	gtk_signal_connect (GTK_OBJECT (priv->url), "changed",
			    GTK_SIGNAL_FUNC (field_changed_cb), tdpage);

	/* Delegation */
	gtk_signal_connect (GTK_OBJECT (priv->organizer), "changed",
			    GTK_SIGNAL_FUNC (field_changed_cb), tdpage);

	gtk_signal_connect (GTK_OBJECT (priv->delegated_to), "changed",
			    GTK_SIGNAL_FUNC (field_changed_cb), tdpage);

}



/**
 * task_details_page_construct:
 * @tdpage: An task details page.
 * 
 * Constructs an task page by loading its Glade data.
 * 
 * Return value: The same object as @tdpage, or NULL if the widgets could not 
 * be created.
 **/
TaskDetailsPage *
task_details_page_construct (TaskDetailsPage *tdpage)
{
	TaskDetailsPagePrivate *priv;

	priv = tdpage->priv;

	priv->xml = glade_xml_new (EVOLUTION_GLADEDIR 
				   "/task-details-page.glade", NULL);
	if (!priv->xml) {
		g_message ("task_details_page_construct(): "
			   "Could not load the Glade XML file!");
		return NULL;
	}

	if (!get_widgets (tdpage)) {
		g_message ("task_details_page_construct(): "
			   "Could not find all widgets in the XML file!");
		return NULL;
	}

	init_widgets (tdpage);

	return tdpage;
}

/**
 * task_details_page_new:
 * 
 * Creates a new task details page.
 * 
 * Return value: A newly-created task details page, or NULL if the page could
 * not be created.
 **/
TaskDetailsPage *
task_details_page_new (void)
{
	TaskDetailsPage *tdpage;

	tdpage = gtk_type_new (TYPE_TASK_DETAILS_PAGE);
	if (!task_details_page_construct (tdpage)) {
		gtk_object_unref (GTK_OBJECT (tdpage));
		return NULL;
	}

	return tdpage;
}

void
task_details_page_show_delegation (TaskDetailsPage *tdpage, gboolean show)
{
	TaskDetailsPagePrivate *priv;

	priv = tdpage->priv;

	if (show) {
		gtk_widget_show (priv->organizer);
		gtk_widget_show (priv->organizer_lbl);
		gtk_widget_show (priv->delegated_to);
		gtk_widget_show (priv->delegated_to_lbl);
		gtk_widget_show (priv->delegated_from);
		gtk_widget_show (priv->delegated_from_lbl);
		comp_editor_page_notify_needs_send (COMP_EDITOR_PAGE (tdpage));
	} else {
		gtk_widget_hide (priv->organizer);
		gtk_widget_hide (priv->organizer_lbl);
		gtk_widget_hide (priv->delegated_to);
		gtk_widget_hide (priv->delegated_to_lbl);
		gtk_widget_hide (priv->delegated_from);
		gtk_widget_hide (priv->delegated_from_lbl);
	}
}

GtkWidget *task_details_page_create_date_edit (void);

GtkWidget *
task_details_page_create_date_edit (void)
{
	GtkWidget *dedit;

	dedit = comp_editor_new_date_edit (TRUE, TRUE);
	e_date_edit_set_allow_no_date_set (E_DATE_EDIT (dedit), TRUE);

	return dedit;
}
