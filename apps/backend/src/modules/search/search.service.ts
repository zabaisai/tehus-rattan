import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LIMITE_POR_TIPO_POR_DEFECTO,
  TIPOS_BUSCABLES,
  TipoBuscable,
} from './dto/search-query.dto';

/**
 * Un resultado, ya normalizado para pintarlo sin conocer la entidad.
 *
 * NO lleva URL. La ruta es asunto del frontend: meterla aquí ataría el backend
 * a `/dashboard/...` y cualquier cambio de navegación obligaría a desplegar la
 * API. El cliente recibe `tipo` e `id` y construye el enlace.
 */
export interface ResultadoDeBusqueda {
  tipo: TipoBuscable;
  id: string;
  titulo: string;
  subtitulo: string | null;
  /** Etiqueta corta de estado; el frontend decide el tono. */
  insignia: string | null;
  /** Id del contacto relacionado, para abrir su perfil desde el resultado. */
  contactoId: string | null;
  /** Solo contactos: indica que vive en la papelera. */
  archivado?: boolean;
}

export interface GrupoDeBusqueda {
  tipo: TipoBuscable;
  total: number;
  resultados: ResultadoDeBusqueda[];
}

export interface RespuestaDeBusqueda {
  consulta: string;
  total: number;
  grupos: GrupoDeBusqueda[];
}

/** `contains` insensible a mayúsculas, que es como busca una persona. */
const like = (q: string) => ({ contains: q, mode: 'insensitive' as const });

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  /**
   * Busca en varias entidades a la vez, SIEMPRE dentro de una empresa.
   *
   * `companyId` entra en cada `where` de Prisma, nunca se filtra después en
   * memoria: una consulta que trae filas de otra empresa y luego las descarta
   * ya las ha traído, y basta un `return` mal puesto para que salgan.
   *
   * El `companyId` viene del token, no del cliente. No hay parámetro para
   * pedirlo: si lo hubiera, sería el camino más corto para leer otra empresa.
   */
  async buscar(
    companyId: string,
    opciones: {
      q: string;
      tipos?: TipoBuscable[];
      incluirPapelera?: boolean;
      limite?: number;
    },
  ): Promise<RespuestaDeBusqueda> {
    const q = opciones.q.trim();
    const limite = opciones.limite ?? LIMITE_POR_TIPO_POR_DEFECTO;
    const tipos =
      opciones.tipos && opciones.tipos.length > 0
        ? opciones.tipos
        : [...TIPOS_BUSCABLES];

    // En paralelo: son consultas independientes y encadenarlas solo suma
    // latencia a una interfaz que responde mientras se teclea.
    const grupos = await Promise.all(
      tipos.map((tipo) => this.buscarTipo(tipo, companyId, q, limite, opciones.incluirPapelera)),
    );

    return {
      consulta: q,
      total: grupos.reduce((suma, g) => suma + g.total, 0),
      grupos: grupos.filter((g) => g.total > 0),
    };
  }

  private buscarTipo(
    tipo: TipoBuscable,
    companyId: string,
    q: string,
    limite: number,
    incluirPapelera?: boolean,
  ): Promise<GrupoDeBusqueda> {
    switch (tipo) {
      case 'contactos':
        return this.contactos(companyId, q, limite, incluirPapelera);
      case 'conversaciones':
        return this.conversaciones(companyId, q, limite);
      case 'oportunidades':
        return this.oportunidades(companyId, q, limite);
      case 'productos':
        return this.productos(companyId, q, limite);
      case 'cotizaciones':
        return this.cotizaciones(companyId, q, limite);
    }
  }

  private async contactos(
    companyId: string,
    q: string,
    limite: number,
    incluirPapelera?: boolean,
  ): Promise<GrupoDeBusqueda> {
    const filas = await this.prisma.contact.findMany({
      where: {
        companyId,
        // Los archivados quedan fuera salvo que se pidan: mezclarlos hace
        // dudar de cuáles siguen vivos, que es lo que archivar resuelve.
        ...(incluirPapelera ? {} : { archivedAt: null }),
        OR: [{ name: like(q) }, { phone: like(q) }, { email: like(q) }],
      },
      select: { id: true, name: true, phone: true, email: true, archivedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limite,
    });

    return {
      tipo: 'contactos',
      total: filas.length,
      resultados: filas.map((c) => ({
        tipo: 'contactos' as const,
        id: c.id,
        titulo: c.name?.trim() || c.phone,
        subtitulo: [c.phone, c.email].filter(Boolean).join(' · ') || null,
        insignia: c.archivedAt ? 'En papelera' : null,
        contactoId: c.id,
        archivado: Boolean(c.archivedAt),
      })),
    };
  }

  /**
   * Una conversación no tiene texto propio que buscar, así que se encuentra
   * por su contacto. Buscar dentro de los MENSAJES sería otra cosa: recorrer
   * el histórico completo de la empresa es caro y además expone en una lista
   * lo que alguien escribió en un chat. Queda fuera a propósito.
   */
  private async conversaciones(
    companyId: string,
    q: string,
    limite: number,
  ): Promise<GrupoDeBusqueda> {
    const filas = await this.prisma.conversation.findMany({
      where: {
        companyId,
        contact: {
          OR: [{ name: like(q) }, { phone: like(q) }, { email: like(q) }],
        },
      },
      select: {
        id: true,
        status: true,
        lastMessageAt: true,
        contact: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: limite,
    });

    return {
      tipo: 'conversaciones',
      total: filas.length,
      resultados: filas.map((c) => ({
        tipo: 'conversaciones' as const,
        id: c.id,
        titulo: c.contact?.name?.trim() || c.contact?.phone || 'Conversación',
        subtitulo: c.contact?.phone ?? null,
        insignia: c.status ?? null,
        contactoId: c.contact?.id ?? null,
      })),
    };
  }

  private async oportunidades(
    companyId: string,
    q: string,
    limite: number,
  ): Promise<GrupoDeBusqueda> {
    const filas = await this.prisma.lead.findMany({
      where: {
        companyId,
        OR: [
          { title: like(q) },
          { contact: { OR: [{ name: like(q) }, { phone: like(q) }] } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        stage: { select: { name: true } },
        contact: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limite,
    });

    return {
      tipo: 'oportunidades',
      total: filas.length,
      resultados: filas.map((l) => ({
        tipo: 'oportunidades' as const,
        id: l.id,
        titulo: l.title,
        subtitulo: l.contact?.name?.trim() || l.contact?.phone || null,
        insignia: l.stage?.name ?? l.status ?? null,
        contactoId: l.contact?.id ?? null,
      })),
    };
  }

  private async productos(
    companyId: string,
    q: string,
    limite: number,
  ): Promise<GrupoDeBusqueda> {
    const filas = await this.prisma.product.findMany({
      where: {
        companyId,
        OR: [{ name: like(q) }, { sku: like(q) }, { code: like(q) }],
      },
      select: { id: true, name: true, sku: true, code: true, category: true },
      orderBy: { updatedAt: 'desc' },
      take: limite,
    });

    return {
      tipo: 'productos',
      total: filas.length,
      resultados: filas.map((p) => ({
        tipo: 'productos' as const,
        id: p.id,
        titulo: p.name,
        subtitulo: [p.sku ?? p.code, p.category].filter(Boolean).join(' · ') || null,
        insignia: null,
        contactoId: null,
      })),
    };
  }

  private async cotizaciones(
    companyId: string,
    q: string,
    limite: number,
  ): Promise<GrupoDeBusqueda> {
    const filas = await this.prisma.quote.findMany({
      where: {
        companyId,
        OR: [
          { number: like(q) },
          { title: like(q) },
          { contact: { OR: [{ name: like(q) }, { phone: like(q) }] } },
        ],
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        contact: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limite,
    });

    return {
      tipo: 'cotizaciones',
      total: filas.length,
      resultados: filas.map((c) => ({
        tipo: 'cotizaciones' as const,
        id: c.id,
        titulo: c.number,
        subtitulo:
          c.title?.trim() ||
          c.contact?.name?.trim() ||
          c.contact?.phone ||
          null,
        insignia: c.status ?? null,
        contactoId: c.contact?.id ?? null,
      })),
    };
  }
}
