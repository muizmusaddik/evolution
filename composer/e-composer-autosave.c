/*
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with the program; if not, see <http://www.gnu.org/licenses/>
 *
 * Copyright (C) 1999-2008 Novell, Inc. (www.novell.com)
 */

#include "e-composer-autosave.h"

#include <errno.h>
#include <sys/stat.h>
#include <glib/gi18n.h>
#include <glib/gstdio.h>

#include <e-util/e-alert-dialog.h>
#include <e-util/e-util.h>

#define AUTOSAVE_PREFIX		".evolution-composer.autosave"
#define AUTOSAVE_SEED		AUTOSAVE_PREFIX "-XXXXXX"
#define AUTOSAVE_INTERVAL	60 /* seconds */

typedef struct _AutosaveState AutosaveState;

struct _AutosaveState {
	EMsgComposer *composer;
	GFile *file;
	gboolean changed;
	guint source_id; /* timeout source ID */
	gboolean enabled;
	gboolean error_shown;
};

static GList *autosave_registry;

static void composer_changed_cb (EMsgComposer *composer);

static EMsgComposer *
composer_autosave_registry_lookup (const gchar *basename)
{
	GList *iter;

	/* Find the composer with the given autosave filename. */
	for (iter = autosave_registry; iter != NULL; iter = iter->next) {
		EMsgComposer *composer = iter->data;
		AutosaveState *state;
		gchar *_basename;

		state = g_object_get_data (G_OBJECT (composer), "autosave");
		if (state == NULL || state->file == NULL)
			continue;

		_basename = g_file_get_basename (state->file);
		if (strcmp (_basename, basename) == 0) {
			g_free (_basename);
			return composer;
		}
		g_free (_basename);
	}

	return NULL;
}

static AutosaveState *
composer_autosave_state_new (EMsgComposer *composer)
{
	AutosaveState *state;

	state = g_slice_new0 (AutosaveState);
	state->enabled = TRUE;
	state->changed = FALSE;
	state->source_id = 0;
	state->composer = composer;

	g_signal_connect (composer, "notify::changed", G_CALLBACK (composer_changed_cb), NULL);

	return state;
}

static void
composer_autosave_state_free (AutosaveState *state)
{
	if (state->source_id)
		g_source_remove (state->source_id);
	if (state->file)
		g_object_unref (state->file);
	g_slice_free (AutosaveState, state);
}

static gboolean
composer_autosave_state_open (AutosaveState *state)
{
	gchar *path;
	gint fd;

	if (state->file != NULL)
		return TRUE;

	path = g_build_filename (
		e_get_user_data_dir (), AUTOSAVE_SEED, NULL);

	/* Since GIO doesn't have support for creating temporary files
	 * from a template (and in a given directory), we have to use
	 * g_mkstemp(), which brings a small risk of overwriting another
	 * autosave file.  The risk is, however, miniscule. */
	fd = g_mkstemp (path);
	if (fd == -1) {
		g_free (path);
		return FALSE;
	}

	close (fd);

	/* Create the GFile */
	state->file = g_file_new_for_path (path);
	g_free (path);

	return TRUE;
}

static void
composer_autosave_finish_cb (EMsgComposer *composer,
                             GAsyncResult *result)
{
	AutosaveState *state;
	GError *error = NULL;

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_if_fail (state != NULL);

	e_composer_autosave_snapshot_finish (composer, result, &error);

	if (error != NULL) {
		gchar *basename;

		if (G_IS_FILE (state->file))
			basename = g_file_get_basename (state->file);
		else
			basename = g_strdup (" ");

		/* Only show one error dialog at a
		 * time to avoid cascading dialogs. */
		if (!state->error_shown) {
			state->error_shown = TRUE;
			e_alert_run_dialog_for_args (
				GTK_WINDOW (composer),
				"mail-composer:no-autosave",
				basename, error->message, NULL);
			state->error_shown = FALSE;
		} else
			g_warning ("%s: %s", basename, error->message);

		g_free (basename);
		g_error_free (error);
	}
}

static gboolean
composer_autosave_timeout (EMsgComposer *composer)
{
	AutosaveState *state;

	g_return_val_if_fail (composer != NULL, FALSE);
	g_return_val_if_fail (E_IS_MSG_COMPOSER (composer), FALSE);

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_val_if_fail (state != NULL, FALSE);
	g_return_val_if_fail (state->composer == composer, FALSE);

	if (!state->changed) {
		state->source_id = 0;
		return FALSE;
	}

	composer = state->composer;

	if (e_composer_autosave_get_enabled (composer)) {
		state->changed = FALSE;
		e_composer_autosave_snapshot_async (
			composer, (GAsyncReadyCallback)
			composer_autosave_finish_cb, NULL);
	}

	return TRUE;
}

static void
composer_changed_cb (EMsgComposer *composer)
{
	AutosaveState *state;

	g_return_if_fail (composer != NULL);
	g_return_if_fail (E_IS_MSG_COMPOSER (composer));

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_if_fail (state != NULL);
	g_return_if_fail (state->composer == composer);

	g_object_get (G_OBJECT (composer), "changed", &state->changed, NULL);

	if (state->changed && state->source_id == 0) {
		state->source_id = g_timeout_add_seconds (
			AUTOSAVE_INTERVAL, (GSourceFunc)
			composer_autosave_timeout, state->composer);
	}
}

static void
composer_autosave_notify (gpointer unused,
                          GObject *where_the_object_was)
{
	/* Remove the dead composer from the registry. */
	autosave_registry = g_list_remove (
		autosave_registry, where_the_object_was);
}

GList *
e_composer_autosave_find_orphans (GError **error)
{
	GDir *dir;
	const gchar *dirname;
	const gchar *basename;
	GList *orphans = NULL;

	dirname = e_get_user_data_dir ();
	dir = g_dir_open (dirname, 0, error);
	if (dir == NULL)
		return NULL;

	/* Scan the user directory for autosave files. */
	while ((basename = g_dir_read_name (dir)) != NULL) {
		const gchar *errmsg;
		gchar *filename;
		struct stat st;

		/* Is this an autosave file? */
		if (!g_str_has_prefix (basename, AUTOSAVE_PREFIX))
			continue;

		/* Is this an orphaned autosave file? */
		if (composer_autosave_registry_lookup (basename) != NULL)
			continue;

		filename = g_build_filename (dirname, basename, NULL);

		/* Try to examine the autosave file.  Failure here
		 * is non-fatal; just emit a warning and move on. */
		errno = 0;
		if (g_stat (filename, &st) < 0) {
			errmsg = g_strerror (errno);
			g_warning ("%s: %s", filename, errmsg);
			g_free (filename);
			continue;
		}

		/* If the file is empty, delete it.  Failure here
		 * is non-fatal; just emit a warning and move on. */
		if (st.st_size == 0) {
			errno = 0;
			if (g_unlink (filename) < 0) {
				errmsg = g_strerror (errno);
				g_warning ("%s: %s", filename, errmsg);
			}
			g_free (filename);
			continue;
		}

		orphans = g_list_prepend (orphans, filename);
	}

	g_dir_close (dir);

	return g_list_reverse (orphans);
}

void
e_composer_autosave_register (EMsgComposer *composer)
{
	g_return_if_fail (E_IS_MSG_COMPOSER (composer));

	g_object_set_data_full (
		G_OBJECT (composer), "autosave",
		composer_autosave_state_new (composer),
		(GDestroyNotify) composer_autosave_state_free);

	autosave_registry = g_list_prepend (autosave_registry, composer);

	g_object_weak_ref (
		G_OBJECT (composer), (GWeakNotify)
		composer_autosave_notify, NULL);
}

void
e_composer_autosave_unregister (EMsgComposer *composer)
{
	AutosaveState *state;

	g_return_if_fail (E_IS_MSG_COMPOSER (composer));

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	if (state == NULL || state->file == NULL)
		return;

	g_file_delete (state->file, NULL, NULL);

	g_object_set_data (G_OBJECT (composer), "autosave", NULL);
}

typedef struct {
	EMsgComposer *composer;
	GSimpleAsyncResult *simple;
	AutosaveState *state;

	/* Transient data */
	GInputStream *input_stream;
} AutosaveData;

static void
autosave_data_free (AutosaveData *data)
{
	g_object_unref (data->composer);
	g_object_unref (data->simple);

	if (data->input_stream != NULL)
		g_object_unref (data->input_stream);

	g_slice_free (AutosaveData, data);
}

static gboolean
autosave_snapshot_check_for_error (AutosaveData *data,
                                   GError *error)
{
	GSimpleAsyncResult *simple;

	if (error == NULL)
		return FALSE;

	simple = data->simple;
	g_simple_async_result_set_from_error (simple, error);
	g_simple_async_result_set_op_res_gboolean (simple, FALSE);
	g_simple_async_result_complete (simple);
	g_error_free (error);

	autosave_data_free (data);

	return TRUE;
}

static void
autosave_snapshot_splice_cb (GOutputStream *output_stream,
                             GAsyncResult *result,
                             AutosaveData *data)
{
	GSimpleAsyncResult *simple;
	GError *error = NULL;

	g_output_stream_splice_finish (output_stream, result, &error);

	if (autosave_snapshot_check_for_error (data, error))
		return;

	simple = data->simple;
	g_simple_async_result_set_op_res_gboolean (simple, TRUE);
	g_simple_async_result_complete (simple);

	autosave_data_free (data);
}

static void
autosave_snapshot_cb (GFile *file,
                      GAsyncResult *result,
                      AutosaveData *data)
{
	CamelMimeMessage *message;
	GFileOutputStream *output_stream;
	GInputStream *input_stream;
	CamelStream *camel_stream;
	GByteArray *buffer;
	GError *error = NULL;

	output_stream = g_file_replace_finish (file, result, &error);

	if (autosave_snapshot_check_for_error (data, error))
		return;

	/* Extract a MIME message from the composer. */
	message = e_msg_composer_get_message_draft (data->composer);
	if (message == NULL) {
		GSimpleAsyncResult *simple;

		/* FIXME Need to set a GError here. */
		simple = data->simple;
		g_simple_async_result_set_op_res_gboolean (simple, FALSE);
		g_simple_async_result_complete (simple);
		g_object_unref (output_stream);
		autosave_data_free (data);
		return;
	}

	/* Decode the MIME part to an in-memory buffer.  We have to do
	 * this because CamelStream is synchronous-only, and using threads
	 * is dangerous because CamelDataWrapper is not reentrant. */
	buffer = g_byte_array_new ();
	camel_stream = camel_stream_mem_new ();
	camel_stream_mem_set_byte_array (
		CAMEL_STREAM_MEM (camel_stream), buffer);
	camel_data_wrapper_decode_to_stream (
		CAMEL_DATA_WRAPPER (message), camel_stream);
	g_object_unref (message);
	g_object_unref (camel_stream);

	/* Load the buffer into a GMemoryInputStream.
	 * But watch out for zero length MIME parts. */
	input_stream = g_memory_input_stream_new ();
	if (buffer->len > 0)
		g_memory_input_stream_add_data (
			G_MEMORY_INPUT_STREAM (input_stream),
			buffer->data, (gssize) buffer->len,
			(GDestroyNotify) g_free);
	g_byte_array_free (buffer, FALSE);
	data->input_stream = input_stream;

	/* Splice the input and output streams */
	g_output_stream_splice_async (
		G_OUTPUT_STREAM (output_stream), input_stream,
		G_OUTPUT_STREAM_SPLICE_CLOSE_SOURCE |
		G_OUTPUT_STREAM_SPLICE_CLOSE_TARGET,
		G_PRIORITY_DEFAULT, NULL, (GAsyncReadyCallback)
		autosave_snapshot_splice_cb, data);

	g_object_unref (output_stream);
}

void
e_composer_autosave_snapshot_async (EMsgComposer *composer,
                                    GAsyncReadyCallback callback,
                                    gpointer user_data)
{
	AutosaveData *data;
	AutosaveState *state;
	GSimpleAsyncResult *simple;

	g_return_if_fail (E_IS_MSG_COMPOSER (composer));

	simple = g_simple_async_result_new (
		G_OBJECT (composer), callback, user_data,
		e_composer_autosave_snapshot_async);

	/* If the contents are unchanged, exit early. */
	if (!gtkhtml_editor_get_changed (GTKHTML_EDITOR (composer))) {
		g_simple_async_result_set_op_res_gboolean (simple, TRUE);
		g_simple_async_result_complete (simple);
		return;
	}

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_if_fail (state != NULL);

	/* Open the autosave file on-demand. */
	errno = 0;
	if (!composer_autosave_state_open (state)) {
		g_simple_async_result_set_error (
			simple, G_FILE_ERROR,
			g_file_error_from_errno (errno),
			"%s", g_strerror (errno));
		g_simple_async_result_set_op_res_gboolean (simple, FALSE);
		g_simple_async_result_complete (simple);
		return;
	}

	/* Overwrite the file */
	data = g_slice_new (AutosaveData);
	data->composer = g_object_ref (composer);
	data->simple = simple;
	data->state = state;

	g_file_replace_async (
		state->file, NULL, FALSE, G_FILE_CREATE_PRIVATE,
		G_PRIORITY_DEFAULT, NULL, (GAsyncReadyCallback)
		autosave_snapshot_cb, data);
}

gboolean
e_composer_autosave_snapshot_finish (EMsgComposer *composer,
                                     GAsyncResult *result,
                                     GError **error)
{
	GSimpleAsyncResult *simple;
	gboolean success;

	g_return_val_if_fail (E_IS_MSG_COMPOSER (composer), FALSE);
	g_return_val_if_fail (G_IS_SIMPLE_ASYNC_RESULT (result), FALSE);
	g_return_val_if_fail (error == NULL || *error == NULL, FALSE);

	simple = G_SIMPLE_ASYNC_RESULT (result);
	success = g_simple_async_result_get_op_res_gboolean (simple);
	g_simple_async_result_propagate_error (simple, error);

	return success;
}

gchar *
e_composer_autosave_get_filename (EMsgComposer *composer)
{
	AutosaveState *state;

	g_return_val_if_fail (E_IS_MSG_COMPOSER (composer), NULL);

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_val_if_fail (state != NULL, NULL);

	return g_file_get_path (state->file);
}

gboolean
e_composer_autosave_get_enabled (EMsgComposer *composer)
{
	AutosaveState *state;

	g_return_val_if_fail (E_IS_MSG_COMPOSER (composer), FALSE);

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_val_if_fail (state != NULL, FALSE);

	return state->enabled;
}

void
e_composer_autosave_set_enabled (EMsgComposer *composer,
                                 gboolean enabled)
{
	AutosaveState *state;

	g_return_if_fail (E_IS_MSG_COMPOSER (composer));

	state = g_object_get_data (G_OBJECT (composer), "autosave");
	g_return_if_fail (state != NULL);

	state->enabled = enabled;
}
