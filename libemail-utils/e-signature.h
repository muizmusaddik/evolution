/*
 *
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
 *
 * Copyright (C) 1999-2008 Novell, Inc. (www.novell.com)
 *
 */

#ifndef E_SIGNATURE_H
#define E_SIGNATURE_H

#include <glib-object.h>

/* Standard GObject macros */
#define E_TYPE_SIGNATURE \
	(e_signature_get_type ())
#define E_SIGNATURE(obj) \
	(G_TYPE_CHECK_INSTANCE_CAST \
	((obj), E_TYPE_SIGNATURE, ESignature))
#define E_SIGNATURE_CLASS(cls) \
	(G_TYPE_CHECK_CLASS_CAST \
	((cls), E_TYPE_SIGNATURE, ESignatureClass))
#define E_IS_SIGNATURE(obj) \
	(G_TYPE_CHECK_INSTANCE_TYPE \
	((obj), E_TYPE_SIGNATURE))
#define E_IS_SIGNATURE_CLASS(cls) \
	(G_TYPE_CHECK_CLASS_TYPE \
	((cls), E_TYPE_SIGNATURE))
#define E_SIGNATURE_GET_CLASS(obj) \
	(G_TYPE_INSTANCE_GET_CLASS \
	((obj), E_TYPE_SIGNATURE, ESignatureClass))

G_BEGIN_DECLS

typedef struct _ESignature ESignature;
typedef struct _ESignatureClass ESignatureClass;
typedef struct _ESignaturePrivate ESignaturePrivate;

struct _ESignature {
	GObject parent;
	ESignaturePrivate *priv;
};

struct _ESignatureClass {
	GObjectClass parent_class;
};

GType		e_signature_get_type		(void);
ESignature *	e_signature_new			(void);
ESignature *	e_signature_new_from_xml	(const gchar *xml);
gchar *		e_signature_uid_from_xml	(const gchar *xml);
gboolean	e_signature_set_from_xml	(ESignature *signature,
						 const gchar *xml);
gchar *		e_signature_to_xml		(ESignature *signature);
gboolean	e_signature_is_equal		(ESignature *signature1,
						 ESignature *signature2);
gboolean	e_signature_get_autogenerated	(ESignature *signature);
void		e_signature_set_autogenerated	(ESignature *signature,
						 gboolean autogenerated);
const gchar *	e_signature_get_filename	(ESignature *signature);
void		e_signature_set_filename	(ESignature *signature,
						 const gchar *filename);
gboolean	e_signature_get_is_html		(ESignature *signature);
void		e_signature_set_is_html		(ESignature *signature,
						 gboolean is_html);
gboolean	e_signature_get_is_script	(ESignature *signature);
void		e_signature_set_is_script	(ESignature *signature,
						 gboolean is_script);
const gchar *	e_signature_get_name		(ESignature *signature);
void		e_signature_set_name		(ESignature *signature,
						 const gchar *name);
const gchar *	e_signature_get_uid		(ESignature *signature);
void		e_signature_set_uid		(ESignature *signature,
						 const gchar *uid);

G_END_DECLS

#endif /* E_SIGNATURE_H */
