/**
 * Antigüedad en formato corto: «ahora», «12m», «3h», «5d».
 *
 * Vivía dentro de `ConversationList`. El Inicio necesita exactamente lo mismo
 * para el bloque de conversaciones sin responder, y dos copias de una regla de
 * redondeo son dos sitios donde el mismo hilo puede decir «59m» en una pantalla
 * y «1h» en la otra.
 */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return 'ahora';
  if (minutos < 60) return `${minutos}m`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;
  return `${Math.floor(horas / 24)}d`;
}

/** Lo mismo, dicho entero: es lo que oye un lector de pantalla. */
export function antiguedadEnPalabras(dateStr: string | null | undefined): string {
  if (!dateStr) return 'sin actividad';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias === 1 ? '' : 's'}`;
}
