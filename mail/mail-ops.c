/* -*- Mode: C; tab-width: 8; indent-tabs-mode: t; c-basic-offset: 8 -*- */
/* mail-ops.c: callbacks for the mail toolbar/menus */

/* 
 * Author : 
 *  Dan Winship <danw@helixcode.com>
 *  Jeffrey Stedfast <fejj@helixcode.com>
 *  Peter Williams <peterw@helixcode.com>
 *
 * Copyright 2000 Helix Code, Inc. (http://www.helixcode.com)
 *
 * This program is free software; you can redistribute it and/or 
 * modify it under the terms of the GNU General Public License as 
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA 02111-1307
 * USA
 */

#include <config.h>
#include <gnome.h>
#include <ctype.h>
#include <camel/camel-mime-filter-from.h>
#include "mail.h"
#include "mail-threads.h"
#include "mail-tools.h"
#include "mail-ops.h"
#include "composer/e-msg-composer.h"
#include "folder-browser.h"
#include "e-util/e-html-utils.h"

#include "mail-mt.h"

#define d(x) x

int mail_operation_run(const mail_operation_spec *op, void *in, int free);

#define mail_tool_camel_lock_down()
#define mail_tool_camel_lock_up()

/* ** FETCH MAIL ********************************************************** */

typedef struct fetch_mail_input_s
{
	gchar *source_url;
	gboolean keep_on_server;
	CamelFolder *destination;
	gpointer hook_func;
	gpointer hook_data;
}
fetch_mail_input_t;

typedef struct fetch_mail_update_info_s {
	gchar *name;
	gchar *display;
	gboolean new_messages;
} fetch_mail_update_info_t;

typedef struct fetch_mail_data_s {
	gboolean empty;
	EvolutionStorage *storage;
	GPtrArray *update_infos;
} fetch_mail_data_t;

static gchar *
describe_fetch_mail (gpointer in_data, gboolean gerund)
{
	fetch_mail_input_t *input = (fetch_mail_input_t *) in_data;
	char *name;
	
	/*source = camel_session_get_store (session, input->source_url, NULL);
	 *if (source) {
	 *	name = camel_service_get_name (CAMEL_SERVICE (source), FALSE);
	 *	camel_object_unref (CAMEL_OBJECT (source));
	 *} else
	 */
	name = input->source_url;
	
	if (gerund)
		return g_strdup_printf (_("Fetching email from %s"), name);
	else
		return g_strdup_printf (_("Fetch email from %s"), name);
}

static void
setup_fetch_mail (gpointer in_data, gpointer op_data, CamelException *ex)
{
	fetch_mail_input_t *input = (fetch_mail_input_t *) in_data;
	fetch_mail_data_t *data = (fetch_mail_data_t *) op_data;
	
	data->empty = FALSE;
	data->storage = NULL;
	data->update_infos = NULL;

	if (input->destination)
		camel_object_ref (CAMEL_OBJECT (input->destination));
}

static FilterContext *
mail_load_evolution_rule_context ()
{
	gchar *userrules;
	gchar *systemrules;
	FilterContext *fc;
	
	userrules = g_strdup_printf ("%s/filters.xml", evolution_dir);
	systemrules = g_strdup_printf ("%s/evolution/filtertypes.xml", EVOLUTION_DATADIR);
	fc = filter_context_new ();
	rule_context_load ((RuleContext *)fc, systemrules, userrules);
	g_free (userrules);
	g_free (systemrules);
	
	return fc;
}

static void
mail_op_report_status (FilterDriver *driver, enum filter_status_t status, const char *desc, void *data)
{
	/* FIXME: make it work */
	switch (status) {
	case FILTER_STATUS_START:
		mail_status(desc);
		break;
	case FILTER_STATUS_END:
		break;
	case FILTER_STATUS_ACTION:
		break;
	default:
		break;
	}
}

static void
update_changed_folders (CamelStore *store, CamelFolderInfo *info,
			EvolutionStorage *storage, const char *path,
			GPtrArray *update_infos, CamelException *ex)
{
	char *name;

	name = g_strdup_printf ("%s/%s", path, info->name);

	if (info->url) {
		CamelFolder *folder;
		fetch_mail_update_info_t *update_info;

		update_info = g_new (fetch_mail_update_info_t, 1);
		update_info->name = g_strdup (name);

		if (info->unread_message_count > 0) {
			update_info->new_messages = TRUE;
			update_info->display = g_strdup_printf ("%s (%d)", info->name,
								info->unread_message_count);
		} else {
			update_info->new_messages = FALSE;
			update_info->display = g_strdup (info->name);
		}

		/* This is a bit of a hack... if the store is already
		 * caching the folder, then we update it. Otherwise
		 * we don't.
		 */
		folder = CAMEL_STORE_CLASS (CAMEL_OBJECT_GET_CLASS (store))->
			lookup_folder (store, info->full_name);		
		if (folder) {
			camel_folder_sync (folder, FALSE, ex);
			if (!camel_exception_is_set (ex))
				camel_folder_refresh_info (folder, ex);
			camel_object_unref (CAMEL_OBJECT (folder));
		}

		/* Save our info to update */
		g_ptr_array_add (update_infos, update_info);
	}
	if (!camel_exception_is_set (ex) && info->sibling) {
		update_changed_folders (store, info->sibling, storage,
					path, update_infos, ex);
	}
	if (!camel_exception_is_set (ex) && info->child) {
		update_changed_folders (store, info->child, storage,
					name, update_infos, ex);
	}
	g_free (name);
}

static void
do_fetch_mail (gpointer in_data, gpointer op_data, CamelException *ex)
{
	fetch_mail_input_t *input = (fetch_mail_input_t *) in_data;
	fetch_mail_data_t *data = (fetch_mail_data_t *) op_data;
	FilterContext *fc;
	FilterDriver *filter;
	FILE *logfile = NULL;
	CamelFolder *folder;
	
	/* FIXME: This shouldn't be checking for "imap" specifically. */
	if (!strncmp (input->source_url, "imap:", 5)) {
		CamelStore *store;
		CamelFolderInfo *info;
		EvolutionStorage *storage;

		store = camel_session_get_store (session, input->source_url, ex);
		if (!store)
			return;
		storage = mail_lookup_storage (store);
		g_return_if_fail (storage != NULL);

		info = camel_store_get_folder_info (store, NULL, FALSE,
						    TRUE, TRUE, ex);
		if (!info) {
			camel_object_unref (CAMEL_OBJECT (store));
			gtk_object_unref (GTK_OBJECT (storage));
			return;
		}

		data->storage = storage;
		data->update_infos = g_ptr_array_new ();
		update_changed_folders (store, info, storage, "", data->update_infos, ex);

		camel_store_free_folder_info (store, info);
		camel_object_unref (CAMEL_OBJECT (store));
		gtk_object_unref (GTK_OBJECT (storage));

		data->empty = FALSE;
		return;
	}
	
	if (input->destination == NULL) {
		input->destination = mail_tool_get_local_inbox (ex);
		
		if (input->destination == NULL)
			return;
	}
	
	/* setup filter driver */
	fc = mail_load_evolution_rule_context ();
	filter = filter_driver_new (fc, mail_tool_filter_get_folder_func, 0);
	filter_driver_set_default_folder (filter, input->destination);
	
	if (TRUE /* perform_logging */) {
		char *filename = g_strdup_printf ("%s/evolution-filter-log", evolution_dir);
		logfile = fopen (filename, "a+");
		g_free (filename);
	}
	
	filter_driver_set_logfile (filter, logfile);
	filter_driver_set_status_func (filter, mail_op_report_status, NULL);
	
	camel_folder_freeze (input->destination);
	
	if (!strncmp (input->source_url, "mbox:", 5)) {
		char *path = mail_tool_do_movemail (input->source_url, ex);
		
		if (path && !camel_exception_is_set (ex)) {
			filter_driver_filter_mbox (filter, path, FILTER_SOURCE_INCOMING, ex);
			
			/* ok?  zap the output file */
			if (!camel_exception_is_set (ex)) {
				unlink (path);
			}
		}
		g_free (path);
	} else {
		folder = mail_tool_get_inbox (input->source_url, ex);

		if (folder) {
			if (camel_folder_get_message_count (folder) > 0) {
				CamelUIDCache *cache = NULL;
				GPtrArray *uids;
				
				uids = camel_folder_get_uids (folder);
				if (input->keep_on_server) {
					char *cachename = mail_config_folder_to_cachename (folder, "cache-");

					cache = camel_uid_cache_new (cachename);
					if (cache) {
						GPtrArray *new_uids;
						
						new_uids = camel_uid_cache_get_new_uids (cache, uids);
						camel_folder_free_uids (folder, uids);
						uids = new_uids;
					}
					
					g_free (cachename);
				}
				
				filter_driver_filter_folder (filter, folder, FILTER_SOURCE_INCOMING,
							     uids, !input->keep_on_server, ex);
				
				if (cache) {
					/* save the cache for the next time we fetch mail! */
					camel_uid_cache_free_uids (uids);
					
					if (!camel_exception_is_set (ex))
						camel_uid_cache_save (cache);
					camel_uid_cache_destroy (cache);
				} else
					camel_folder_free_uids (folder, uids);
			} else {
				data->empty = TRUE;
			}
			
			/* sync and expunge */
			camel_folder_sync (folder, TRUE, ex);
			
			camel_object_unref (CAMEL_OBJECT (folder));
		} else {
			data->empty = TRUE;
		}
	}

	if (logfile)
		fclose (logfile);

	camel_folder_thaw (input->destination);

	/*camel_object_unref (CAMEL_OBJECT (input->destination));*/
	gtk_object_unref (GTK_OBJECT (filter));
}

static void
cleanup_fetch_mail (gpointer in_data, gpointer op_data, CamelException *ex)
{
	fetch_mail_input_t *input = (fetch_mail_input_t *) in_data;
	fetch_mail_data_t *data = (fetch_mail_data_t *) op_data;

	if (data->empty && !camel_exception_is_set (ex))
		mail_op_set_message (_("There is no new mail at %s."),
				     input->source_url);
	
	if (data->update_infos) {
		int i;

		for (i = 0; i < data->update_infos->len; i++) {
			fetch_mail_update_info_t *update_info;

			update_info = (fetch_mail_update_info_t *) data->update_infos->pdata[i];
			evolution_storage_update_folder (data->storage,
							 update_info->name,
							 update_info->display,
							 update_info->new_messages);
			g_free (update_info->name);
			g_free (update_info->display);
			g_free (update_info);
		}

		g_ptr_array_free (data->update_infos, TRUE);
	}

	g_free (input->source_url);
	if (input->destination)
		camel_object_unref (CAMEL_OBJECT (input->destination));
}

static const mail_operation_spec op_fetch_mail = {
	describe_fetch_mail,
	sizeof (fetch_mail_data_t),
	setup_fetch_mail,
	do_fetch_mail,
	cleanup_fetch_mail
};

void
mail_do_fetch_mail (const gchar *source_url, gboolean keep_on_server,
		    CamelFolder *destination,
		    gpointer hook_func, gpointer hook_data)
{
	fetch_mail_input_t *input;
	
	g_return_if_fail (source_url != NULL);
	g_return_if_fail (destination == NULL ||
			  CAMEL_IS_FOLDER (destination));

	input = g_new (fetch_mail_input_t, 1);
	input->source_url = g_strdup (source_url);
	input->keep_on_server = keep_on_server;
	input->destination = destination;
	input->hook_func = hook_func;
	input->hook_data = hook_data;
	
	mail_operation_queue (&op_fetch_mail, input, TRUE);
}

/* ** FILTER ON DEMAND ********************************************************** */

/* why do we have this separate code, it is basically a copy of the code above,
   should be consolidated */

typedef struct filter_ondemand_input_s {
	CamelFolder *source;
	GPtrArray *uids;
} filter_ondemand_input_t;

static gchar *
describe_filter_ondemand (gpointer in_data, gboolean gerund)
{
	if (gerund)
		return g_strdup_printf (_("Filtering email on demand"));
	else
		return g_strdup_printf (_("Filter email on demand"));
}

static void
setup_filter_ondemand (gpointer in_data, gpointer op_data, CamelException *ex)
{
	filter_ondemand_input_t *input = (filter_ondemand_input_t *) in_data;
	
	camel_object_ref (CAMEL_OBJECT (input->source));
}

static void
do_filter_ondemand (gpointer in_data, gpointer op_data, CamelException *ex)
{
	filter_ondemand_input_t *input = (filter_ondemand_input_t *) in_data;
	FilterDriver *driver;
	FilterContext *context;
	FILE *logfile = NULL;
	int i;
	
	mail_tool_camel_lock_up ();
	if (camel_folder_get_message_count (input->source) == 0) {
		mail_tool_camel_lock_down ();
		return;
	}
	
	/* create the filter context */
	context = mail_load_evolution_rule_context ();
	
	if (((RuleContext *)context)->error) {
		gtk_object_unref (GTK_OBJECT (context));
		
		camel_exception_setv (ex, CAMEL_EXCEPTION_SYSTEM,
				      "Cannot apply filters: failed to load filter rules.");
		
		mail_tool_camel_lock_down ();
		return;
	}
	
	/* setup filter driver - no default destination */
	driver = filter_driver_new (context, mail_tool_filter_get_folder_func, NULL);
	
	if (TRUE /* perform_logging */) {
		char *filename;
		
		filename = g_strdup_printf ("%s/evolution-filter-log", evolution_dir);
		logfile = fopen (filename, "a+");
		g_free (filename);
	}
	
	filter_driver_set_logfile (driver, logfile);
	filter_driver_set_status_func (driver, mail_op_report_status, NULL);
	
	for (i = 0; i < input->uids->len; i++) {
		CamelMimeMessage *message;
		CamelMessageInfo *info;
		
		message = camel_folder_get_message (input->source, input->uids->pdata[i], ex);
		info = camel_folder_get_message_info (input->source, input->uids->pdata[i]);
		
		/* filter the message - use "incoming" rules since we don't want special "demand" filters? */
		filter_driver_filter_message (driver, message, info, "", FILTER_SOURCE_INCOMING, ex);

		camel_folder_free_message_info(input->source, info);
	}
	
	if (logfile)
		fclose (logfile);
	
	/* sync the source folder */
	camel_folder_sync (input->source, FALSE, ex);
	
	gtk_object_unref (GTK_OBJECT (driver));
	mail_tool_camel_lock_down ();
}

static void
cleanup_filter_ondemand (gpointer in_data, gpointer op_data, CamelException *ex)
{
	filter_ondemand_input_t *input = (filter_ondemand_input_t *) in_data;
	int i;
	
	if (input->source)
		camel_object_unref (CAMEL_OBJECT (input->source));
	
	for (i = 0; i < input->uids->len; i++)
		g_free (input->uids->pdata[i]);
	g_ptr_array_free (input->uids, TRUE);
}

static const mail_operation_spec op_filter_ondemand = {
	describe_filter_ondemand,
	0,
	setup_filter_ondemand,
	do_filter_ondemand,
	cleanup_filter_ondemand
};

void
mail_do_filter_ondemand (CamelFolder *source, GPtrArray *uids)
{
	filter_ondemand_input_t *input;
	
	g_return_if_fail (source == NULL || CAMEL_IS_FOLDER (source));
	
	input = g_new (filter_ondemand_input_t, 1);
	input->source = source;
	input->uids = uids;
	
	mail_operation_queue (&op_filter_ondemand, input, TRUE);
}

/* ** SEND MAIL *********************************************************** */

struct _send_mail_msg {
	struct _mail_msg msg;

	char *uri;
	CamelMimeMessage *message;

	void (*done)(char *uri, CamelMimeMessage *message, gboolean sent, void *data);
	void *data;
};

#if 0
{
	/* If done_folder != NULL, will add done_flags to
	 * the flags of the message done_uid in done_folder. */

	CamelFolder *done_folder;
	char *done_uid;
	guint32 done_flags;

	GtkWidget *composer;
}
#endif

static char *send_mail_desc(struct _mail_msg *mm, int done)
{
	struct _send_mail_msg *m = (struct _send_mail_msg *)mm;
	const char *subject;

	subject = camel_mime_message_get_subject(m->message);
	if (subject && subject[0])
		return g_strdup_printf (_("Sending \"%s\""), subject);
	else
		return g_strdup(_("Sending message"));
}

static void send_mail_send(struct _mail_msg *mm)
{
	struct _send_mail_msg *m = (struct _send_mail_msg *)mm;
	extern CamelFolder *sent_folder;
	CamelMessageInfo *info;
	CamelTransport *xport;
	FilterContext *context;

	camel_medium_add_header(CAMEL_MEDIUM (m->message), "X-Mailer", "Evolution " VERSION " (Developer Preview)");
	camel_mime_message_set_date(m->message, CAMEL_MESSAGE_DATE_CURRENT, 0);
	
	xport = camel_session_get_transport(session, m->uri, &mm->ex);
	if (camel_exception_is_set(&mm->ex))
		return;
	
	mail_tool_send_via_transport(xport, (CamelMedium *)m->message, &mm->ex);
	camel_object_unref((CamelObject *)xport);
	if (camel_exception_is_set(&mm->ex))
		return;
	
	/* now lets run it through the outgoing filters */
	info = camel_message_info_new();
	info->flags = CAMEL_MESSAGE_SEEN;
	
	/* setup filter driver */
#warning "Using a gtk object outside of the mian thread, joy"
	context = mail_load_evolution_rule_context ();
	
	if (!((RuleContext *)context)->error) {
		FilterDriver *driver;
		FILE *logfile;
		
		driver = filter_driver_new (context, mail_tool_filter_get_folder_func, NULL);
		
		if (TRUE /* perform_logging */) {
			char *filename;
			
			filename = g_strdup_printf ("%s/evolution-filter-log", evolution_dir);
			logfile = fopen (filename, "a+");
			g_free (filename);
		}
		
		filter_driver_filter_message (driver, m->message, info, "", FILTER_SOURCE_OUTGOING, &mm->ex);
		
		gtk_object_unref (GTK_OBJECT (driver));
		
		if (logfile)
			fclose (logfile);
	}
	
	/* now to save the message in Sent */
	if (sent_folder)
		camel_folder_append_message(sent_folder, m->message, info, &mm->ex);
	
	camel_message_info_free(info);
}

static void send_mail_sent(struct _mail_msg *mm)
{
	struct _send_mail_msg *m = (struct _send_mail_msg *)mm;

	if (m->done)
		m->done(m->uri, m->message, !camel_exception_is_set(&mm->ex), m->data);
}

static void send_mail_free(struct _mail_msg *mm)
{
	struct _send_mail_msg *m = (struct _send_mail_msg *)mm;

	camel_object_unref((CamelObject *)m->message);
	g_free(m->uri);
}

static struct _mail_msg_op send_mail_op = {
	send_mail_desc,
	send_mail_send,
	send_mail_sent,
	send_mail_free,
};

int
mail_send_mail(const char *uri, CamelMimeMessage *message, void (*done) (char *uri, CamelMimeMessage *message, gboolean sent, void *data), void *data)
{
	struct _send_mail_msg *m;
	int id;

	m = mail_msg_new(&send_mail_op, NULL, sizeof(*m));
	m->uri = g_strdup(uri);
	m->message = message;
	camel_object_ref((CamelObject *)message);
	m->data = data;
	m->done = done;

	id = m->msg.seq;
	e_thread_put(mail_thread_new, (EMsg *)m);
	return id;
}

/* ** SEND MAIL QUEUE ***************************************************** */

typedef struct send_queue_input_s
{
	CamelFolder *folder_queue;
	gchar *xport_uri;
}
send_queue_input_t;

static gchar *
describe_send_queue (gpointer in_data, gboolean gerund)
{
	/*send_queue_input_t *input = (send_queue_input_t *) in_data;*/
	
	if (gerund) {
		return g_strdup_printf (_("Sending queue"));
	} else {
		return g_strdup_printf (_("Send queue"));
	}
}

static void
setup_send_queue (gpointer in_data, gpointer op_data, CamelException *ex)
{
	send_queue_input_t *input = (send_queue_input_t *) in_data;
	
	camel_object_ref (CAMEL_OBJECT (input->folder_queue));
}

static void
do_send_queue (gpointer in_data, gpointer op_data, CamelException *ex)
{
	send_queue_input_t *input = (send_queue_input_t *) in_data;
	extern CamelFolder *sent_folder;
	CamelTransport *xport;
	GPtrArray *uids;
	char *x_mailer;
	guint32 set;
	int i;
	
	uids = camel_folder_get_uids (input->folder_queue);
	if (!uids)
		return;
	
	x_mailer = g_strdup_printf ("Evolution %s (Developer Preview)",
				    VERSION);
	
	for (i = 0; i < uids->len; i++) {
		CamelMimeMessage *message;
		
		message = camel_folder_get_message (input->folder_queue, uids->pdata[i], ex);
		if (camel_exception_is_set (ex))
			break;
		
		camel_medium_add_header (CAMEL_MEDIUM (message), "X-Mailer", x_mailer);
		
		camel_mime_message_set_date (message, CAMEL_MESSAGE_DATE_CURRENT, 0);
		
		xport = camel_session_get_transport (session, input->xport_uri, ex);
		if (camel_exception_is_set (ex))
			break;
		
		mail_tool_send_via_transport (xport, CAMEL_MEDIUM (message), ex);
		camel_object_unref (CAMEL_OBJECT (xport));
		
		if (camel_exception_is_set (ex))
			break;
		
		set = camel_folder_get_message_flags (input->folder_queue,
						      uids->pdata[i]);
		camel_folder_set_message_flags (input->folder_queue,
						uids->pdata[i],
						CAMEL_MESSAGE_DELETED, ~set);

		/* now to save the message in Sent */
		if (sent_folder) {
			CamelMessageInfo *info;
			
			info = g_new0 (CamelMessageInfo, 1);
			info->flags = CAMEL_MESSAGE_SEEN;
			camel_folder_append_message (sent_folder, message, info, ex);
			g_free (info);
		}
	}
	
	g_free (x_mailer);
	
	for (i = 0; i < uids->len; i++)
		g_free (uids->pdata[i]);
	g_ptr_array_free (uids, TRUE);

	if (!camel_exception_is_set(ex))
		camel_folder_expunge(input->folder_queue, NULL);
	
	if (sent_folder)
		camel_folder_sync(sent_folder, FALSE, NULL);
}

static void
cleanup_send_queue (gpointer in_data, gpointer op_data, CamelException *ex)
{
	send_queue_input_t *input = (send_queue_input_t *) in_data;
	
	camel_object_unref (CAMEL_OBJECT (input->folder_queue));
	
	g_free (input->xport_uri);
}

static const mail_operation_spec op_send_queue = {
	describe_send_queue,
	0,
	setup_send_queue,
	do_send_queue,
	cleanup_send_queue
};

void
mail_do_send_queue (CamelFolder *folder_queue,
		    const char *xport_uri)
{
	send_queue_input_t *input;

	g_return_if_fail (xport_uri != NULL);
	g_return_if_fail (CAMEL_IS_FOLDER (folder_queue));

	input = g_new (send_queue_input_t, 1);
	input->xport_uri = g_strdup (xport_uri);
	input->folder_queue = folder_queue;
	
	mail_operation_queue (&op_send_queue, input, TRUE);
}


/* ** APPEND MESSAGE TO FOLDER ******************************************** */

typedef struct append_mail_input_s
{
        CamelFolder *folder;
	CamelMimeMessage *message;
        CamelMessageInfo *info;
}
append_mail_input_t;

static gchar *
describe_append_mail (gpointer in_data, gboolean gerund)
{
	append_mail_input_t *input = (append_mail_input_t *) in_data;
	
	if (gerund) {
		if (input->message->subject && input->message->subject[0])
			return g_strdup_printf (_("Appending \"%s\""),
						input->message->subject);
		else
			return
				g_strdup (_("Appending a message without a subject"));
	} else {
		if (input->message->subject && input->message->subject[0])
			return g_strdup_printf (_("Appending \"%s\""),
						input->message->subject);
		else
			return g_strdup (_("Appending a message without a subject"));
	}
}

static void
setup_append_mail (gpointer in_data, gpointer op_data, CamelException *ex)
{
	append_mail_input_t *input = (append_mail_input_t *) in_data;
	
	camel_object_ref (CAMEL_OBJECT (input->message));
	camel_object_ref (CAMEL_OBJECT (input->folder));
}

static void
do_append_mail (gpointer in_data, gpointer op_data, CamelException *ex)
{
	append_mail_input_t *input = (append_mail_input_t *) in_data;
	
	camel_mime_message_set_date (input->message,
				     CAMEL_MESSAGE_DATE_CURRENT, 0);
	
        mail_tool_camel_lock_up ();
	
	/* now to save the message in the specified folder */
	camel_folder_append_message (input->folder, input->message, input->info, ex);
	
        mail_tool_camel_lock_down ();
}

static void
cleanup_append_mail (gpointer in_data, gpointer op_data, CamelException *ex)
{
	append_mail_input_t *input = (append_mail_input_t *) in_data;
	
	camel_object_unref (CAMEL_OBJECT (input->message));
        camel_object_unref (CAMEL_OBJECT (input->folder));
}

static const mail_operation_spec op_append_mail = {
	describe_append_mail,
	0,
	setup_append_mail,
	do_append_mail,
	cleanup_append_mail
};

void
mail_do_append_mail (CamelFolder *folder,
		     CamelMimeMessage *message,
		     CamelMessageInfo *info)
{
	append_mail_input_t *input;
	
	g_return_if_fail (CAMEL_IS_FOLDER (folder));
	g_return_if_fail (CAMEL_IS_MIME_MESSAGE (message));

	input = g_new (append_mail_input_t, 1);
	input->folder = folder;
	input->message = message;
	input->info = info;
	
	mail_operation_queue (&op_append_mail, input, TRUE);
}

/* ** TRANSFER MESSAGES **************************************************** */

typedef struct transfer_messages_input_s
{
	CamelFolder *source;
	GPtrArray *uids;
	gboolean delete_from_source;
	gchar *dest_uri;
}
transfer_messages_input_t;

static gchar *
describe_transfer_messages (gpointer in_data, gboolean gerund)
{
	transfer_messages_input_t *input = (transfer_messages_input_t *) in_data;
	char *format;
	
	if (gerund) {
		if (input->delete_from_source)
			format = _("Moving messages from \"%s\" into \"%s\"");
		else
			format = _("Copying messages from \"%s\" into \"%s\"");
	} else {
		if (input->delete_from_source)
			format = _("Move messages from \"%s\" into \"%s\"");
		else
			format = _("Copy messages from \"%s\" into \"%s\"");
	}

	return g_strdup_printf (format,
				mail_tool_get_folder_name (input->source), 
				input->dest_uri);
}

static void
setup_transfer_messages (gpointer in_data, gpointer op_data,
			 CamelException *ex)
{
	transfer_messages_input_t *input = (transfer_messages_input_t *) in_data;

	camel_object_ref (CAMEL_OBJECT (input->source));
}

static void
do_transfer_messages (gpointer in_data, gpointer op_data, CamelException *ex)
{
	transfer_messages_input_t *input = (transfer_messages_input_t *) in_data;
	CamelFolder *dest;
	gint i;
	time_t last_update = 0;
	gchar *desc;
	void (*func) (CamelFolder *, const char *, 
		      CamelFolder *, 
		      CamelException *);

	if (input->delete_from_source) {
		func = camel_folder_move_message_to;
		desc = _("Moving");
	} else {
		func = camel_folder_copy_message_to;
		desc = _("Copying");
	}

	dest = mail_tool_uri_to_folder (input->dest_uri, ex);
	if (camel_exception_is_set (ex))
		return;

	mail_tool_camel_lock_up ();
	camel_folder_freeze (input->source);
	camel_folder_freeze (dest);

	for (i = 0; i < input->uids->len; i++) {
		const gboolean last_message = (i+1 == input->uids->len);
		time_t now;

		/*
		 * Update the time display every 2 seconds
		 */
		time (&now);
		if (last_message || ((now - last_update) > 2)) {
			mail_op_set_message (_("%s message %d of %d (uid \"%s\")"), desc,
					     i + 1, input->uids->len, (char *) input->uids->pdata[i]);
			last_update = now;
		}
		
		(func) (input->source,
			input->uids->pdata[i], dest,
			ex);
		g_free (input->uids->pdata[i]);
		if (camel_exception_is_set (ex))
			break;
	}

	camel_folder_thaw (input->source);
	camel_folder_thaw (dest);
	camel_object_unref (CAMEL_OBJECT (dest));
	mail_tool_camel_lock_down ();
}

static void
cleanup_transfer_messages (gpointer in_data, gpointer op_data,
			   CamelException *ex)
{
	transfer_messages_input_t *input = (transfer_messages_input_t *) in_data;

	camel_object_unref (CAMEL_OBJECT (input->source));
	g_free (input->dest_uri);
	g_ptr_array_free (input->uids, TRUE);
}

static const mail_operation_spec op_transfer_messages = {
	describe_transfer_messages,
	0,
	setup_transfer_messages,
	do_transfer_messages,
	cleanup_transfer_messages
};

void
mail_do_transfer_messages (CamelFolder *source, GPtrArray *uids,
			   gboolean delete_from_source,
			   gchar *dest_uri)
{
	transfer_messages_input_t *input;

	g_return_if_fail (CAMEL_IS_FOLDER (source));
	g_return_if_fail (uids != NULL);
	g_return_if_fail (dest_uri != NULL);

	input = g_new (transfer_messages_input_t, 1);
	input->source = source;
	input->uids = uids;
	input->delete_from_source = delete_from_source;
	input->dest_uri = g_strdup (dest_uri);

	mail_operation_queue (&op_transfer_messages, input, TRUE);
}

/* ** SCAN SUBFOLDERS ***************************************************** */

struct _get_folderinfo_msg {
	struct _mail_msg msg;

	CamelStore *store;
	CamelFolderInfo *info;
	void (*done)(CamelStore *store, CamelFolderInfo *info, void *data);
	void *data;
};

static char *get_folderinfo_desc(struct _mail_msg *mm, int done)
{
	struct _get_folderinfo_msg *m = (struct _get_folderinfo_msg *)mm;
	char *ret, *name;

	name = camel_service_get_name((CamelService *)m->store, TRUE);
	ret = g_strdup_printf(_("Scanning folders in \"%s\""), name);
	g_free(name);
	return ret;
}

static void get_folderinfo_get(struct _mail_msg *mm)
{
	struct _get_folderinfo_msg *m = (struct _get_folderinfo_msg *)mm;

	m->info = camel_store_get_folder_info(m->store, NULL, FALSE, TRUE, TRUE, &mm->ex);
}

static void get_folderinfo_got(struct _mail_msg *mm)
{
	struct _get_folderinfo_msg *m = (struct _get_folderinfo_msg *)mm;

	if (m->done)
		m->done(m->store, m->info, m->data);
}

static void get_folderinfo_free(struct _mail_msg *mm)
{
	struct _get_folderinfo_msg *m = (struct _get_folderinfo_msg *)mm;

	if (m->info)
		camel_store_free_folder_info(m->store, m->info);
	camel_object_unref((CamelObject *)m->store);
}

static struct _mail_msg_op get_folderinfo_op = {
	get_folderinfo_desc,
	get_folderinfo_get,
	get_folderinfo_got,
	get_folderinfo_free,
};

int mail_get_folderinfo(CamelStore *store, void (*done)(CamelStore *store, CamelFolderInfo *info, void *data), void *data)
{
	struct _get_folderinfo_msg *m;
	int id;

	m = mail_msg_new(&get_folderinfo_op, NULL, sizeof(*m));
	m->store = store;
	camel_object_ref((CamelObject *)store);
	m->done = done;
	m->data = data;
	id = m->msg.seq;

	e_thread_put(mail_thread_new, (EMsg *)m);

	return id;
}

/* ********************************************************************** */

static void do_add_subfolders(CamelStore *store, CamelFolderInfo *info, EvolutionStorage *storage, const char *prefix)
{
	char *path, *name;

	path = g_strdup_printf("%s/%s", prefix, info->name);
	if (info->unread_message_count > 0)
		name = g_strdup_printf("%s (%d)", info->name, info->unread_message_count);
	else
		name = g_strdup(info->name);

	evolution_storage_new_folder(storage, path, name, "mail", info->url?info->url:"",
				     _("(No description)"), info->unread_message_count > 0);
	g_free(name);
	if (info->child)
		do_add_subfolders(store, info->child, storage, path);
	if (info->sibling)
		do_add_subfolders(store, info->sibling, storage, prefix);
	g_free(path);
}

static void do_scan_subfolders(CamelStore *store, CamelFolderInfo *info, void *data)
{
	EvolutionStorage *storage = data;

	if (info) {
		gtk_object_set_data((GtkObject *)storage, "connected", (void *)1);
		do_add_subfolders(store, info, storage, "");
	}
}

/* synchronous function to scan the & and add folders in a store */
void mail_scan_subfolders(CamelStore *store, EvolutionStorage *storage)
{
	int id;

	id = mail_get_folderinfo(store, do_scan_subfolders, storage);
	mail_msg_wait(id);
}

/* ** ATTACH MESSAGES ****************************************************** */

struct _build_data {
	void (*done)(CamelFolder *folder, GPtrArray *uids, CamelMimePart *part, char *subject, void *data);
	void *data;
};

static void do_build_attachment(CamelFolder *folder, GPtrArray *uids, GPtrArray *messages, void *data)
{
	struct _build_data *d = data;
	CamelMultipart *multipart;
	CamelMimePart *part;
	char *subject;
	int i;

	if (messages->len == 0) {
		d->done(folder, messages, NULL, NULL, d->data);
		g_free(d);
		return;
	}

	if (messages->len == 1) {
		part = mail_tool_make_message_attachment(messages->pdata[0]);
	} else {
		multipart = camel_multipart_new();
		camel_data_wrapper_set_mime_type(CAMEL_DATA_WRAPPER (multipart), "multipart/digest");
		camel_multipart_set_boundary(multipart, NULL);

		for (i=0;i<messages->len;i++) {
			part = mail_tool_make_message_attachment(messages->pdata[i]);
			camel_multipart_add_part(multipart, part);
			camel_object_unref((CamelObject *)part);
		}
		part = camel_mime_part_new();
		camel_medium_set_content_object(CAMEL_MEDIUM (part), CAMEL_DATA_WRAPPER(multipart));
		camel_object_unref((CamelObject *)multipart);

		camel_mime_part_set_description(part, _("Forwarded messages"));
	}

	subject = mail_tool_generate_forward_subject(messages->pdata[0]);
	d->done(folder, messages, part, subject, d->data);
	g_free(subject);
	camel_object_unref((CamelObject *)part);

	g_free(d);
}

void
mail_build_attachment(CamelFolder *folder, GPtrArray *uids,
		      void (*done)(CamelFolder *folder, GPtrArray *messages, CamelMimePart *part, char *subject, void *data), void *data)
{
	struct _build_data *d;

	d = g_malloc(sizeof(*d));
	d->done = done;
	d->data = data;
	mail_get_messages(folder, uids, do_build_attachment, d);
}

/* ** LOAD FOLDER ********************************************************* */

/* there hsould be some way to merge this and create folder, since both can
   presumably create a folder ... */

struct _get_folder_msg {
	struct _mail_msg msg;

	char *uri;
	CamelFolder *folder;
	void (*done) (char *uri, CamelFolder *folder, void *data);
	void *data;
};

static char *get_folder_desc(struct _mail_msg *mm, int done)
{
	struct _get_folder_msg *m = (struct _get_folder_msg *)mm;
	
	return g_strdup_printf(_("Opening folder %s"), m->uri);
}

static void get_folder_get(struct _mail_msg *mm)
{
	struct _get_folder_msg *m = (struct _get_folder_msg *)mm;

	m->folder = mail_tool_uri_to_folder(m->uri, &mm->ex);
}

static void get_folder_got(struct _mail_msg *mm)
{
	struct _get_folder_msg *m = (struct _get_folder_msg *)mm;

	if (m->done)
		m->done(m->uri, m->folder, m->data);
}

static void get_folder_free(struct _mail_msg *mm)
{
	struct _get_folder_msg *m = (struct _get_folder_msg *)mm;

	g_free(m->uri);
	if (m->folder)
		camel_object_unref((CamelObject *)m->folder);
}

static struct _mail_msg_op get_folder_op = {
	get_folder_desc,
	get_folder_get,
	get_folder_got,
	get_folder_free,
};

int
mail_get_folder(const char *uri, void (*done) (char *uri, CamelFolder *folder, void *data), void *data)
{
	struct _get_folder_msg *m;
	int id;

	m = mail_msg_new(&get_folder_op, NULL, sizeof(*m));
	m->uri = g_strdup(uri);
	m->data = data;
	m->done = done;

	id = m->msg.seq;
	e_thread_put(mail_thread_new, (EMsg *)m);
	return id;
}

/* ** CREATE FOLDER ******************************************************* */

/* trying to find a way to remove this entirely and just use get_folder()
   to do the same thing.  But i dont think it can be done, because one works on
   shell uri's (get folder), and the other only works for mail uri's ? */

struct _create_folder_msg {
	struct _mail_msg msg;

	char *uri;
	CamelFolder *folder;
	void (*done) (char *uri, CamelFolder *folder, void *data);
	void *data;
};

static char *create_folder_desc(struct _mail_msg *mm, int done)
{
	struct _create_folder_msg *m = (struct _create_folder_msg *)mm;
	
	return g_strdup_printf(_("Opening folder %s"), m->uri);
}

static void create_folder_get(struct _mail_msg *mm)
{
	struct _create_folder_msg *m = (struct _create_folder_msg *)mm;

	/* FIXME: supply a way to make indexes optional */
	m->folder = mail_tool_get_folder_from_urlname(m->uri, "mbox",
						      CAMEL_STORE_FOLDER_CREATE|CAMEL_STORE_FOLDER_BODY_INDEX,
						      &mm->ex);
}

static void create_folder_got(struct _mail_msg *mm)
{
	struct _create_folder_msg *m = (struct _create_folder_msg *)mm;

	if (m->done)
		m->done(m->uri, m->folder, m->data);
}

static void create_folder_free(struct _mail_msg *mm)
{
	struct _create_folder_msg *m = (struct _create_folder_msg *)mm;

	g_free(m->uri);
	if (m->folder)
		camel_object_unref((CamelObject *)m->folder);
}

static struct _mail_msg_op create_folder_op = {
	create_folder_desc,
	create_folder_get,
	create_folder_got,
	create_folder_free,
};

void
mail_create_folder(const char *uri, void (*done) (char *uri, CamelFolder *folder, void *data), void *data)
{
	struct _create_folder_msg *m;

	m = mail_msg_new(&create_folder_op, NULL, sizeof(*m));
	m->uri = g_strdup(uri);
	m->data = data;
	m->done = done;

	e_thread_put(mail_thread_new, (EMsg *)m);
}

/* ** SYNC FOLDER ********************************************************* */

struct _sync_folder_msg {
	struct _mail_msg msg;

	CamelFolder *folder;
	void (*done) (CamelFolder *folder, void *data);
	void *data;
};

static char *sync_folder_desc(struct _mail_msg *mm, int done)
{
	return g_strdup(_("Synchronising folder"));
}

static void sync_folder_sync(struct _mail_msg *mm)
{
	struct _sync_folder_msg *m = (struct _sync_folder_msg *)mm;

	camel_folder_sync(m->folder, FALSE, &mm->ex);
}

static void sync_folder_synced(struct _mail_msg *mm)
{
	struct _sync_folder_msg *m = (struct _sync_folder_msg *)mm;

	if (m->done)
		m->done(m->folder, m->data);
}

static void sync_folder_free(struct _mail_msg *mm)
{
	struct _sync_folder_msg *m = (struct _sync_folder_msg *)mm;

	camel_object_unref((CamelObject *)m->folder);
}

static struct _mail_msg_op sync_folder_op = {
	sync_folder_desc,
	sync_folder_sync,
	sync_folder_synced,
	sync_folder_free,
};

void
mail_sync_folder(CamelFolder *folder, void (*done) (CamelFolder *folder, void *data), void *data)
{
	struct _sync_folder_msg *m;

	m = mail_msg_new(&sync_folder_op, NULL, sizeof(*m));
	m->folder = folder;
	camel_object_ref((CamelObject *)folder);
	m->data = data;
	m->done = done;

	e_thread_put(mail_thread_new, (EMsg *)m);
}

/* ******************************************************************************** */

static char *expunge_folder_desc(struct _mail_msg *mm, int done)
{
	return g_strdup(_("Expunging folder"));
}

static void expunge_folder_expunge(struct _mail_msg *mm)
{
	struct _sync_folder_msg *m = (struct _sync_folder_msg *)mm;

	camel_folder_expunge(m->folder, &mm->ex);
}

/* we just use the sync stuff where we can, since it would be the same */
static struct _mail_msg_op expunge_folder_op = {
	expunge_folder_desc,
	expunge_folder_expunge,
	sync_folder_synced,
	sync_folder_free,
};

void
mail_expunge_folder(CamelFolder *folder, void (*done) (CamelFolder *folder, void *data), void *data)
{
	struct _sync_folder_msg *m;

	m = mail_msg_new(&expunge_folder_op, NULL, sizeof(*m));
	m->folder = folder;
	camel_object_ref((CamelObject *)folder);
	m->data = data;
	m->done = done;

	e_thread_put(mail_thread_new, (EMsg *)m);
}

/* ** GET MESSAGE(s) ***************************************************** */

struct _get_message_msg {
	struct _mail_msg msg;

	CamelFolder *folder;
	char *uid;
	void (*done) (CamelFolder *folder, char *uid, CamelMimeMessage *msg, void *data);
	void *data;
	CamelMimeMessage *message;
};

static char *get_message_desc(struct _mail_msg *mm, int done)
{
	struct _get_message_msg *m = (struct _get_message_msg *)mm;

	return g_strdup_printf(_("Retrieving message %s"), m->uid);
}

static void get_message_get(struct _mail_msg *mm)
{
	struct _get_message_msg *m = (struct _get_message_msg *)mm;

	m->message = camel_folder_get_message(m->folder, m->uid, &mm->ex);
}

static void get_message_got(struct _mail_msg *mm)
{
	struct _get_message_msg *m = (struct _get_message_msg *)mm;

	if (m->done)
		m->done(m->folder, m->uid, m->message, m->data);
}

static void get_message_free(struct _mail_msg *mm)
{
	struct _get_message_msg *m = (struct _get_message_msg *)mm;

	g_free(m->uid);
	camel_object_unref((CamelObject *)m->folder);
}

static struct _mail_msg_op get_message_op = {
	get_message_desc,
	get_message_get,
	get_message_got,
	get_message_free,
};

void
mail_get_message(CamelFolder *folder, const char *uid, void (*done) (CamelFolder *folder, char *uid, CamelMimeMessage *msg, void *data), void *data, EThread *thread)
{
	struct _get_message_msg *m;

	m = mail_msg_new(&get_message_op, NULL, sizeof(*m));
	m->folder = folder;
	camel_object_ref((CamelObject *)folder);
	m->uid = g_strdup(uid);
	m->data = data;
	m->done = done;

	e_thread_put(thread, (EMsg *)m);
}

/* ********************************************************************** */

struct _get_messages_msg {
	struct _mail_msg msg;

	CamelFolder *folder;
	GPtrArray *uids;
	GPtrArray *messages;

	void (*done) (CamelFolder *folder, GPtrArray *uids, GPtrArray *msgs, void *data);
	void *data;
};

static char * get_messages_desc(struct _mail_msg *mm, int done)
{
	return g_strdup_printf(_("Retrieving messages"));
}

static void get_messages_get(struct _mail_msg *mm)
{
	struct _get_messages_msg *m = (struct _get_messages_msg *)mm;
	int i;
	CamelMimeMessage *message;

	for (i=0; i<m->uids->len; i++) {
		mail_statusf(_("Retrieving message number %d of %d (uid \"%s\")"),
			     i+1, m->uids->len, (char *) m->uids->pdata[i]);

		message = camel_folder_get_message(m->folder, m->uids->pdata[i], &mm->ex);
		if (message == NULL)
			break;

		g_ptr_array_add(m->messages, message);
	}
}

static void get_messages_got(struct _mail_msg *mm)
{
	struct _get_messages_msg *m = (struct _get_messages_msg *)mm;

	if (m->done)
		m->done(m->folder, m->uids, m->messages, m->data);
}

static void get_messages_free(struct _mail_msg *mm)
{
	struct _get_messages_msg *m = (struct _get_messages_msg *)mm;
	int i;

	for (i=0;i<m->uids->len;i++)
		g_free(m->uids->pdata[i]);
	g_ptr_array_free(m->uids, TRUE);
	for (i=0;i<m->messages->len;i++) {
		if (m->messages->pdata[i])
			camel_object_unref((CamelObject *)m->messages->pdata[i]);
	}
	g_ptr_array_free(m->messages, TRUE);
	camel_object_unref((CamelObject *)m->folder);
}

static struct _mail_msg_op get_messages_op = {
	get_messages_desc,
	get_messages_get,
	get_messages_got,
	get_messages_free,
};

void
mail_get_messages(CamelFolder *folder, GPtrArray *uids, void (*done) (CamelFolder *folder, GPtrArray *uids, GPtrArray *msgs, void *data), void *data)
{
	struct _get_messages_msg *m;

	m = mail_msg_new(&get_messages_op, NULL, sizeof(*m));
	m->folder = folder;
	camel_object_ref((CamelObject *)folder);
	m->uids = uids;
	m->messages = g_ptr_array_new();
	m->data = data;
	m->done = done;

	e_thread_put(mail_thread_new, (EMsg *)m);
}


/* dum de dum, below is an entirely async 'operation' thingy */
struct _op_data {
	void *out;
	void *in;
	CamelException *ex;
	const mail_operation_spec *op;
	int pipe[2];
	int free;
	GIOChannel *channel;
};

static void *
runthread(void *oin)
{
	struct _op_data *o = oin;

	o->op->callback(o->in, o->out, o->ex);

	printf("thread run, sending notificaiton\n");

	write(o->pipe[1], "", 1);

	return oin;
}

static gboolean
runcleanup(GIOChannel *source, GIOCondition cond, void *d)
{
	struct _op_data *o = d;

	printf("ggot notification, blup\n");

	o->op->cleanup(o->in, o->out, o->ex);

	/*close(o->pipe[0]);*/
	close(o->pipe[1]);

	if (o->free)
		g_free(o->in);
	g_free(o->out);
	camel_exception_free(o->ex);
	g_free(o);

	g_io_channel_unref(source);

	return FALSE;
}

#include <pthread.h>

/* quick hack, like queue, but it runs it instantly in a new thread ! */
int
mail_operation_run(const mail_operation_spec *op, void *in, int free)
{
	struct _op_data *o;
	pthread_t id;

	o = g_malloc0(sizeof(*o));
	o->op = op;
	o->in = in;
	o->out = g_malloc0(op->datasize);
	o->ex = camel_exception_new();
	o->free = free;
	pipe(o->pipe);

	o->channel = g_io_channel_unix_new(o->pipe[0]);
	g_io_add_watch(o->channel, G_IO_IN, (GIOFunc)runcleanup, o);

	o->op->setup(o->in, o->out, o->ex);

	pthread_create(&id, 0, runthread, o);

	return TRUE;
}

/* ** SETUP TRASH VFOLDER ************************************************* */

typedef struct setup_trash_input_s {
	gchar *name;
	gchar *store_uri;
	CamelFolder **folder;
} setup_trash_input_t;

static gchar *
describe_setup_trash (gpointer in_data, gboolean gerund)
{
	setup_trash_input_t *input = (setup_trash_input_t *) in_data;
	
	if (gerund)
		return g_strdup_printf (_("Loading %s Folder for %s"), input->name, input->store_uri);
	else
		return g_strdup_printf (_("Load %s Folder for %s"), input->name, input->store_uri);
}

/* maps the shell's uri to the real vfolder uri and open the folder */
static CamelFolder *
create_trash_vfolder (const char *name, GPtrArray *urls, CamelException *ex)
{
	void camel_vee_folder_add_folder (CamelFolder *, CamelFolder *);
	
	char *storeuri, *foldername;
	CamelFolder *folder = NULL, *sourcefolder;
	const char *sourceuri;
	int source = 0;
	
	d(fprintf (stderr, "Creating Trash vfolder\n"));
	
	storeuri = g_strdup_printf ("vfolder:%s/vfolder/%s", evolution_dir, name);
	foldername = g_strdup ("mbox?(match-all (system-flag Deleted))");
	
	/* we dont have indexing on vfolders */
	folder = mail_tool_get_folder_from_urlname (storeuri, foldername, CAMEL_STORE_FOLDER_CREATE, ex);
	
	sourceuri = NULL;
	while (source < urls->len) {
		sourceuri = urls->pdata[source];
		fprintf (stderr, "adding vfolder source: %s\n", sourceuri);
		
		sourcefolder = mail_tool_uri_to_folder (sourceuri, ex);
		d(fprintf (stderr, "source folder = %p\n", sourcefolder));
		
		if (sourcefolder) {
			mail_tool_camel_lock_up ();
			camel_vee_folder_add_folder (folder, sourcefolder);
			mail_tool_camel_lock_down ();
		} else {
			/* we'll just silently ignore now-missing sources */
			camel_exception_clear (ex);
		}
		
		g_free (urls->pdata[source]);
		source++;
	}
	
	g_ptr_array_free (urls, TRUE);
	
	g_free (foldername);
	g_free (storeuri);
	
	return folder;
}

static void
populate_folder_urls (CamelFolderInfo *info, GPtrArray *urls)
{
	if (!info)
		return;
	
	g_ptr_array_add (urls, info->url);
	
	if (info->child)
		populate_folder_urls (info->child, urls);
	
	if (info->sibling)
		populate_folder_urls (info->sibling, urls);
}

static void
local_folder_urls (gpointer key, gpointer value, gpointer user_data)
{
	GPtrArray *urls = user_data;
	CamelFolder *folder = value;
	
	g_ptr_array_add (urls, g_strdup_printf ("file://%s/local/%s",
						evolution_dir,
						folder->full_name));
}

static void
do_setup_trash (gpointer in_data, gpointer op_data, CamelException *ex)
{
	setup_trash_input_t *input = (setup_trash_input_t *) in_data;
	EvolutionStorage *storage;
	CamelFolderInfo *info;
	CamelStore *store;
	GPtrArray *urls;
	
	urls = g_ptr_array_new ();
	
	/* we don't want to connect */
	store = (CamelStore *) camel_session_get_service (session, input->store_uri,
							  CAMEL_PROVIDER_STORE, ex);
	if (store == NULL) {
		g_warning ("Couldn't get service %s: %s\n", input->store_uri,
			   camel_exception_get_description (ex));
		camel_exception_clear (ex);
	} else {
		char *path, *uri;
		
		if (!strcmp (input->store_uri, "file:/")) {
			/* Yeah - this is a hack but then again so are local folders */
			g_hash_table_foreach (store->folders, local_folder_urls, urls);
		} else {
			info = camel_store_get_folder_info (store, "/", TRUE, TRUE, TRUE, ex);
			populate_folder_urls (info, urls);
			camel_store_free_folder_info (store, info);
		}
		
		*(input->folder) = create_trash_vfolder (input->name, urls, ex);
		
		uri = g_strdup_printf ("vfolder:%s", input->name);
		path = g_strdup_printf ("/%s", input->name);
		storage = mail_lookup_storage (store);
		evolution_storage_new_folder (storage, path, g_basename (path),
					      "mail", uri, input->name, FALSE);
		gtk_object_unref (GTK_OBJECT (storage));
		g_free (path);
		g_free (uri);
	}
}

static void
cleanup_setup_trash (gpointer in_data, gpointer op_data, CamelException *ex)
{
	setup_trash_input_t *input = (setup_trash_input_t *) in_data;
	
	g_free (input->name);
	g_free (input->store_uri);
}

static const mail_operation_spec op_setup_trash = {
	describe_setup_trash,
	0,
	NULL,
	do_setup_trash,
	cleanup_setup_trash
};

void
mail_do_setup_trash (const char *name, const char *store_uri, CamelFolder **folder)
{
	setup_trash_input_t *input;
	
	g_return_if_fail (name != NULL);
	g_return_if_fail (folder != NULL);
	
	input = g_new (setup_trash_input_t, 1);
	input->name = g_strdup (name);
	input->store_uri = g_strdup (store_uri);
	input->folder = folder;
	mail_operation_queue (&op_setup_trash, input, TRUE);
}

/* ** SAVE MESSAGES ******************************************************* */

struct _save_messages_msg {
	struct _mail_msg msg;

	CamelFolder *folder;
	GPtrArray *uids;
	char *path;
	void (*done)(CamelFolder *folder, GPtrArray *uids, char *path, void *data);
	void *data;
};

static char *save_messages_desc(struct _mail_msg *mm, int done)
{
	return g_strdup(_("Saving messages"));
}

/* tries to build a From line, based on message headers */
/* this is a copy directly from camel-mbox-summary.c */

static char *tz_months[] = {
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
};

static char *tz_days[] = {
	"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
};

static char *
build_from(struct _header_raw *header)
{
	GString *out = g_string_new("From ");
	char *ret;
	const char *tmp;
	time_t thetime;
	int offset;
	struct tm tm;

	tmp = header_raw_find(&header, "Sender", NULL);
	if (tmp == NULL)
		tmp = header_raw_find(&header, "From", NULL);
	if (tmp != NULL) {
		struct _header_address *addr = header_address_decode(tmp);

		tmp = NULL;
		if (addr) {
			if (addr->type == HEADER_ADDRESS_NAME) {
				g_string_append(out, addr->v.addr);
				tmp = "";
			}
			header_address_unref(addr);
		}
	}
	if (tmp == NULL)
		g_string_append(out, "unknown@nodomain.now.au");

	/* try use the received header to get the date */
	tmp = header_raw_find(&header, "Received", NULL);
	if (tmp) {
		tmp = strrchr(tmp, ';');
		if (tmp)
			tmp++;
	}

	/* if there isn't one, try the Date field */
	if (tmp == NULL)
		tmp = header_raw_find(&header, "Date", NULL);

	thetime = header_decode_date(tmp, &offset);
	thetime += ((offset / 100) * (60 * 60)) + (offset % 100) * 60;
	gmtime_r(&thetime, &tm);
	g_string_sprintfa(out, " %s %s %d %02d:%02d:%02d %4d\n",
			  tz_days[tm.tm_wday],
			  tz_months[tm.tm_mon], tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, tm.tm_year + 1900);

	ret = out->str;
	g_string_free(out, FALSE);
	return ret;
}

static void save_messages_save(struct _mail_msg *mm)
{
	struct _save_messages_msg *m = (struct _save_messages_msg *)mm;
	CamelStreamFilter *filtered_stream;
	CamelMimeFilterFrom *from_filter;
	CamelStream *stream;
	int fd, i;
	char *from;

	fd = open(m->path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
	if (fd == -1) {
		camel_exception_setv(&mm->ex, CAMEL_EXCEPTION_SYSTEM,
				     _("Unable to create output file: %s\n %s"), m->path, strerror(errno));
		return;
	}
	
	stream = camel_stream_fs_new_with_fd(fd);
	from_filter = camel_mime_filter_from_new();
	filtered_stream = camel_stream_filter_new_with_stream(stream);
	camel_stream_filter_add(filtered_stream, (CamelMimeFilter *)from_filter);
	camel_object_unref((CamelObject *)from_filter);
	
	for (i=0; i<m->uids->len; i++) {
		CamelMimeMessage *message;

		mail_statusf(_("Saving message %d of %d (uid \"%s\")"),
			     i+1, m->uids->len, (char *)m->uids->pdata[i]);
		
		message = camel_folder_get_message(m->folder, m->uids->pdata[i], &mm->ex);
		if (!message)
			break;

		/* we need to flush after each stream write since we are writing to the same fd */
		from = build_from(((CamelMimePart *)message)->headers);
		if (camel_stream_write_string(stream, from) == -1
		    || camel_stream_flush(stream) == -1
		    || camel_data_wrapper_write_to_stream((CamelDataWrapper *)message, (CamelStream *)filtered_stream) == -1
		    || camel_stream_flush((CamelStream *)filtered_stream) == -1) {
			camel_exception_setv(&mm->ex, CAMEL_EXCEPTION_SYSTEM,
					     _("Error saving messages to: %s:\n %s"), m->path, strerror(errno));
			g_free(from);
			camel_object_unref((CamelObject *)message);
			break;
		}
		g_free(from);
		camel_object_unref((CamelObject *)message);
	}

	camel_object_unref((CamelObject *)filtered_stream);
	camel_object_unref((CamelObject *)stream);
}

static void save_messages_saved(struct _mail_msg *mm)
{
	struct _save_messages_msg *m = (struct _save_messages_msg *)mm;

	if (m->done)
		m->done(m->folder, m->uids, m->path, m->data);
}

static void save_messages_free(struct _mail_msg *mm)
{
	struct _save_messages_msg *m = (struct _save_messages_msg *)mm;
	int i;

	for (i=0;i<m->uids->len;i++)
		g_free(m->uids->pdata[i]);
	g_ptr_array_free(m->uids, TRUE);
	camel_object_unref((CamelObject *)m->folder);
	g_free(m->path);
}

static struct _mail_msg_op save_messages_op = {
	save_messages_desc,
	save_messages_save,
	save_messages_saved,
	save_messages_free,
};

int
mail_save_messages(CamelFolder *folder, GPtrArray *uids, const char *path,
		   void (*done) (CamelFolder *folder, GPtrArray *uids, char *path, void *data), void *data)
{
	struct _save_messages_msg *m;
	int id;

	m = mail_msg_new(&save_messages_op, NULL, sizeof(*m));
	m->folder = folder;
	camel_object_ref((CamelObject *)folder);
	m->uids = uids;
	m->path = g_strdup(path);
	m->data = data;
	m->done = done;

	id = m->msg.seq;
	e_thread_put(mail_thread_new, (EMsg *)m);

	return id;
}
