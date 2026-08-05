import api from "./axios";
import { Contact, ImpactoDeContacto } from "@/types";

/**
 * Los contactos ACTIVOS. Sin parámetros a propósito: se pasa tal cual como
 * `queryFn` en varias pantallas, y react-query invoca su `queryFn` con un
 * objeto de contexto. Un parámetro opcional aquí lo recibiría en silencio y
 * acabaría en la URL como si fuera un filtro.
 *
 * Los archivados tienen su propio camino: `getPapelera`.
 */
export async function getContacts(): Promise<Contact[]> {
  const { data } = await api.get<Contact[]>("/contacts");
  return data;
}

export async function createContact(payload: {
  phone: string;
  name?: string;
  email?: string;
}): Promise<Contact> {
  const { data } = await api.post<Contact>("/contacts", payload);
  return data;
}

export async function updateContact(
  id: string,
  payload: { name?: string; email?: string },
): Promise<Contact> {
  const { data } = await api.patch<Contact>(`/contacts/${id}`, payload);
  return data;
}

/**
 * ARCHIVA el contacto: sale de las listas de trabajo y conserva su historia.
 *
 * El nombre de esta función dice lo que hace. Antes se llamaba
 * `deleteContact`, el botón decía «Eliminar» y lo que ocurría era esto — el
 * archivado es lo correcto, pero la etiqueta mentía y quien la pulsaba creía
 * haber borrado datos que seguían ahí.
 */
export async function archiveContact(
  id: string,
  motivo?: string,
): Promise<{ archivado: boolean; yaEstaba: boolean }> {
  const { data } = await api.delete(`/contacts/${id}`, {
    data: motivo ? { motivo } : undefined,
  });
  return data;
}

export async function restoreContact(
  id: string,
): Promise<{ restaurado: boolean; yaEstaba: boolean }> {
  const { data } = await api.post(`/contacts/${id}/restore`);
  return data;
}

/** Los archivados de la empresa: lo que la interfaz llama papelera. */
export async function getPapelera(): Promise<{
  items: Contact[];
  total: number;
}> {
  const { data } = await api.get("/contacts/papelera/listado");
  return data;
}

/** Solo lectura: qué se vería afectado por una eliminación definitiva. */
export async function getImpactoContacto(
  id: string,
): Promise<ImpactoDeContacto> {
  const { data } = await api.get<ImpactoDeContacto>(`/contacts/${id}/impacto`);
  return data;
}

/**
 * Eliminación DEFINITIVA. La frase de confirmación viaja al servidor, que la
 * vuelve a comprobar: la validación del navegador es una comodidad, no la
 * defensa.
 */
export async function eliminarContactoDefinitivo(
  id: string,
  confirmacion: string,
  motivo?: string,
): Promise<{ accion: "borrado" | "anonimizado" }> {
  const { data } = await api.delete(`/contacts/${id}/definitivo`, {
    data: { confirmacion, motivo },
  });
  return data;
}
