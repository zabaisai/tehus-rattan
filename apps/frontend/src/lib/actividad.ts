import {
  Archive,
  Building2,
  Database,
  FileText,
  KeyRound,
  LucideIcon,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Workflow,
} from 'lucide-react';

/**
 * Traducción de un código de auditoría a algo que se pueda leer.
 *
 * La auditoría guarda códigos (`contact.archive`, `USE_INVITATION_CODE`) para
 * poder buscarlos y agruparlos sin depender del idioma. Un panel de inicio no
 * puede enseñarlos tal cual: «USE_INVITATION_CODE» no es actividad reciente,
 * es un identificador.
 *
 * LO QUE NO SE HACE AQUÍ: inventar un texto por cada acción posible. Las
 * acciones son cadenas libres que cualquier módulo puede añadir, así que hay
 * un respaldo que convierte `algo.que_paso` en «Algo que paso» en vez de
 * dejar un hueco o esconder la fila. Una actividad desconocida sigue siendo
 * actividad.
 */
const ETIQUETAS: Record<string, string> = {
  'contact.archive': 'Contacto archivado',
  'contact.restore': 'Contacto restaurado',
  'custom_field.create': 'Campo personalizado creado',
  'custom_field.update': 'Campo personalizado actualizado',
  'custom_field.deactivate': 'Campo personalizado desactivado',
  'flowbot.create': 'Bot creado',
  'flowbot.publish': 'Bot publicado',
  'flowbot.activate': 'Bot activado',
  CREATE_COMPANY: 'Empresa creada',
  CREATE_INVITATION_CODE: 'Código de invitación creado',
  USE_INVITATION_CODE: 'Código de invitación usado',
  REVOKE_INVITATION_CODE: 'Código de invitación revocado',
  DATA_EXPORTED: 'Datos exportados',
  DATA_PURGED: 'Datos depurados',
  RETENTION_POLICY_CHANGED: 'Política de retención cambiada',
  DELETION_REQUESTED: 'Eliminación solicitada',
  DELETION_APPROVED: 'Eliminación aprobada',
  DELETION_REJECTED: 'Eliminación rechazada',
  DELETION_EXECUTED: 'Eliminación ejecutada',
  PASSWORD_RESET_REQUESTED: 'Recuperación de contraseña solicitada',
  PASSWORD_RESET_COMPLETED: 'Contraseña restablecida',
  REVOKE_SESSION: 'Sesión revocada',
  REVOKE_ALL_USER_SESSIONS: 'Sesiones de un usuario revocadas',
  REVOKE_ALL_COMPANY_SESSIONS: 'Sesiones de la empresa revocadas',
  SESSIONS_REVOKED_AFTER_PASSWORD_RESET: 'Sesiones cerradas tras el cambio de contraseña',
  START_SUPPORT_SESSION: 'Sesión de soporte iniciada',
  END_SUPPORT_SESSION: 'Sesión de soporte finalizada',
  UPDATE_COMPANY_STATUS: 'Estado de la empresa actualizado',
  WHATSAPP_RECONNECTED: 'WhatsApp reconectado',
  WHATSAPP_DISCONNECTED_LOCAL: 'WhatsApp desconectado',
  WHATSAPP_CONNECTION_TESTED: 'Conexión de WhatsApp probada',
  WHATSAPP_PRIMARY_NUMBER_CHANGED: 'Número principal de WhatsApp cambiado',
  WHATSAPP_SIGNUP_COMPLETED: 'Alta de WhatsApp completada',
  WHATSAPP_SIGNUP_STARTED: 'Alta de WhatsApp iniciada',
  WHATSAPP_SIGNUP_FAILED: 'Alta de WhatsApp fallida',
};

/**
 * El icono se elige por FAMILIA, no por acción.
 *
 * Con cuarenta acciones y subiendo, un icono por acción sería una tabla que
 * hay que ampliar cada vez que alguien audita algo nuevo — y que se queda sin
 * icono justo entonces. La familia se deduce del prefijo o del tipo de
 * entidad, que cambian mucho menos.
 */
const ICONOS: Array<{ prueba: RegExp; icono: LucideIcon }> = [
  { prueba: /^contact\./i, icono: Archive },
  { prueba: /^flowbot\./i, icono: Workflow },
  { prueba: /^custom_field\./i, icono: FileText },
  { prueba: /whatsapp/i, icono: MessageCircle },
  { prueba: /invitation/i, icono: UserPlus },
  { prueba: /deletion|purge/i, icono: Trash2 },
  { prueba: /session|password/i, icono: ShieldCheck },
  { prueba: /data|retention|export/i, icono: Database },
  { prueba: /company/i, icono: Building2 },
  { prueba: /invitation_code/i, icono: KeyRound },
];

export function etiquetaDeActividad(action: string): string {
  const conocida = ETIQUETAS[action];
  if (conocida) return conocida;

  // Respaldo legible: `algo.que_paso` → «Algo que paso».
  const legible = action
    .replace(/[._]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!legible) return 'Actividad registrada';
  return legible.charAt(0).toUpperCase() + legible.slice(1);
}

export function iconoDeActividad(action: string): LucideIcon {
  return ICONOS.find((c) => c.prueba.test(action))?.icono ?? Sparkles;
}

/** «Ana Administradora» o, si el actor ya no existe, algo honesto. */
export function autorDeActividad(actorName: string | null): string {
  return actorName?.trim() || 'Sistema';
}
