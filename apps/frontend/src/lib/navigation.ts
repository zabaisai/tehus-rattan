import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  Calculator,
  CheckSquare,
  Database,
  FileText,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  MessageCircle,
  MessageSquare,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';
import type { Role } from '@/types';
import type { TenantCapabilityKey } from './tenant-capabilities';
import { NOMBRE_PULSO } from './producto';

/**
 * NAVEGACIÓN DECLARATIVA (Fase 4).
 *
 * La barra lateral ya no decide con `if` sueltos qué enlace enseña: cada
 * entrada declara a quién sirve (`roles`) y de qué módulo depende
 * (`capability`), y `visibleNavItems` aplica las dos reglas en un solo sitio.
 * Así el menú, las pruebas y cualquier otra superficie que liste secciones
 * leen la misma tabla.
 *
 * `roles` ESPEJA lo que exige el backend, igual que en `creacion-rapida`: no
 * es la protección, es no ofrecer un enlace que va a devolver 403.
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** `null`/ausente = cualquier usuario de la empresa. */
  roles?: Role[] | null;
  /** Módulo que tiene que estar activo para que la sección exista. */
  capability?: TenantCapabilityKey;
  /** Azúcar para `roles: ['ADMIN', 'SUPER_ADMIN']`. */
  adminOnly?: boolean;
}

export const ADMIN_ROLES: Role[] = ['ADMIN', 'SUPER_ADMIN'];

export const NAV_ITEMS: NavItem[] = [
  { key: 'inicio', label: 'Inicio', href: '/dashboard', icon: LayoutDashboard },
  { key: 'contactos', label: 'Contactos', href: '/dashboard/contacts', icon: Users },
  { key: 'pipeline', label: 'Pipeline', href: '/dashboard/pipeline', icon: KanbanSquare },
  {
    key: 'conversaciones',
    label: 'Conversaciones',
    href: '/dashboard/conversations',
    icon: MessageSquare,
  },
  // Pulso lo ve TODO el mundo, no solo quien administra: un asesor necesita
  // saber si el bot está atendiendo a su cliente antes de escribirle encima.
  // Crear, editar y publicar sí quedan restringidos, pero dentro de la pantalla.
  { key: 'pulso', label: NOMBRE_PULSO, href: '/dashboard/flowbots', icon: Workflow },
  {
    key: 'tareas',
    label: 'Tareas',
    href: '/dashboard/tasks',
    icon: CheckSquare,
    capability: 'tasks',
  },
  {
    key: 'catalogo',
    label: 'Catálogo',
    href: '/dashboard/products',
    icon: Package,
    capability: 'catalog',
  },
  {
    key: 'cotizaciones',
    label: 'Cotizaciones',
    href: '/dashboard/quotes',
    icon: FileText,
    capability: 'quotes',
  },
  {
    key: 'documentos',
    label: 'Documentos',
    href: '/dashboard/documents/calculator',
    icon: Calculator,
  },
  // Las automatizaciones mandan mensajes reales a clientes reales: solo quien
  // administra la empresa debería poder tocarlas, igual que la conexión de
  // WhatsApp.
  {
    key: 'automatizaciones',
    label: 'Automatizaciones',
    href: '/dashboard/automations',
    icon: Zap,
    adminOnly: true,
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    href: '/dashboard/settings/whatsapp',
    icon: MessageCircle,
    adminOnly: true,
  },
  {
    key: 'empresa',
    label: 'Empresa',
    href: '/dashboard/settings/company',
    icon: Settings,
    adminOnly: true,
  },
  // Retención, exportación y solicitud de eliminación. Enlazado y no
  // escondido: una empresa tiene que poder llevarse sus datos sin escribirle
  // a nadie.
  {
    key: 'datos',
    label: 'Datos',
    href: '/dashboard/settings/data',
    icon: Database,
    adminOnly: true,
  },
];

/**
 * Un SUPER_ADMIN de plataforma administra la plataforma, no el CRM de una
 * empresa: nunca recibe la navegación de negocio, solo esta sección. Aquí no
 * hay capacidades de empresa que aplicar.
 */
export const PLATFORM_NAV_ITEMS: NavItem[] = [
  { key: 'empresas', label: 'Empresas', href: '/dashboard/platform/companies', icon: Building2 },
  {
    key: 'codigos',
    label: 'Códigos de invitación',
    href: '/dashboard/platform/invitation-codes',
    icon: KeyRound,
  },
  { key: 'auditoria', label: 'Auditoría', href: '/dashboard/platform/audit-logs', icon: ScrollText },
  {
    key: 'eliminaciones',
    label: 'Eliminaciones',
    href: '/dashboard/platform/deletion-requests',
    icon: Trash2,
  },
  {
    key: 'actividad',
    label: 'Actividad y seguridad',
    href: '/dashboard/platform/activity',
    icon: ShieldCheck,
  },
];

export interface NavVisibilityContext {
  role: Role | undefined | null;
  /** `can()` de `useTenantCapabilities`: falso hasta conocer la configuración. */
  can: (key: TenantCapabilityKey) => boolean;
  /** Mientras no esté lista la configuración, NINGÚN enlace opcional aparece. */
  isReady: boolean;
}

function rolePermits(item: NavItem, role: Role | undefined | null): boolean {
  const roles = item.adminOnly ? ADMIN_ROLES : item.roles;
  if (!roles) return true;
  if (!role) return false;
  return roles.includes(role);
}

/**
 * Los enlaces que ve ESTE usuario en ESTA empresa.
 *
 * Un enlace con `capability` solo existe cuando la configuración es conocida
 * Y el módulo está activo. Con `isReady` en falso (cargando o con error) se
 * omite: un módulo prohibido no debe aparecer un instante y desaparecer, y un
 * fallo al cargar la configuración deja la navegación central intacta.
 */
export function visibleNavItems(
  items: NavItem[],
  ctx: NavVisibilityContext,
): NavItem[] {
  return items.filter((item) => {
    if (!rolePermits(item, ctx.role)) return false;
    if (!item.capability) return true;
    return ctx.isReady && ctx.can(item.capability);
  });
}
