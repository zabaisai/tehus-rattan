/**
 * QUÉ dice el documento, separado de CÓMO se dibuja.
 *
 * Existe porque el contenido de un PDF va comprimido: no se puede comprobar
 * buscando texto en el archivo. Sin esta separación, las decisiones que de
 * verdad importan —qué campos se omiten, cómo se formatea el dinero, si
 * aparece la línea de descuento— quedarían sin poder probarse, y son
 * exactamente las que salen mal en un documento que se manda a un cliente.
 *
 * Aquí no se importa PDFKit a propósito: es una función pura.
 */

export interface DatosCotizacion {
  number: string;
  title?: string | null;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  notes?: string | null;
  validUntil?: Date | null;
  createdAt: Date;
  company: {
    name: string;
    legalName?: string | null;
    taxId?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    website?: string | null;
    quoteFooter?: string | null;
    currency?: string;
    locale?: string;
  };
  lead: { title: string };
  contact?: { name?: string | null; phone?: string | null } | null;
  items: Array<{
    name: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

export interface FilaTotal {
  etiqueta: string;
  valor: string;
  destacada?: boolean;
}

export interface DocumentoCotizacion {
  titulo: string;
  emisor: { nombre: string; lineas: string[] };
  numero: string;
  fecha: string;
  validez: string | null;
  destinatario: { nombre: string; telefono: string | null };
  asunto: string | null;
  filas: Array<{
    nombre: string;
    descripcion: string | null;
    cantidad: string;
    unitario: string;
    total: string;
  }>;
  totales: FilaTotal[];
  notas: string | null;
  piePersonalizado: string | null;
}

/** Moneda de LA EMPRESA, no del servidor donde corre el proceso. */
export function formatearDinero(
  valor: number,
  company: DatosCotizacion['company'],
): string {
  const locale = company.locale || 'es-CO';
  const currency = company.currency || 'COP';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(valor);
  } catch {
    // Una moneda mal configurada no puede impedir emitir la cotización: el
    // documento sale con un formato peor, pero sale.
    return `${currency} ${valor.toFixed(2)}`;
  }
}

export function formatearFecha(
  valor: Date,
  company: DatosCotizacion['company'],
): string {
  try {
    return new Intl.DateTimeFormat(company.locale || 'es-CO', {
      dateStyle: 'long',
    }).format(valor);
  } catch {
    return valor.toISOString().slice(0, 10);
  }
}

export function construirDocumento(
  datos: DatosCotizacion,
): DocumentoCotizacion {
  const { company } = datos;

  // Los campos vacíos se OMITEN, no se imprimen en blanco: una línea vacía en
  // un documento que va a un cliente parece un error de la empresa.
  const lineasEmisor = [
    company.taxId ? `NIT ${company.taxId}` : null,
    company.address,
    [company.city, company.country].filter(Boolean).join(', ') || null,
    company.phone,
    company.email,
    company.website,
  ].filter((x): x is string => Boolean(x && x.trim()));

  const totales: FilaTotal[] = [
    { etiqueta: 'Subtotal', valor: formatearDinero(datos.subtotal, company) },
  ];
  // Solo si lo hay: un "Descuento: 0" invita a preguntar por qué no hay
  // descuento, que es una conversación que nadie quería tener.
  if (datos.discount > 0) {
    totales.push({
      etiqueta: 'Descuento',
      valor: `- ${formatearDinero(datos.discount, company)}`,
    });
  }
  totales.push({
    etiqueta: 'TOTAL',
    valor: formatearDinero(datos.total, company),
    destacada: true,
  });

  return {
    titulo: `Cotización ${datos.number}`,
    emisor: {
      nombre: company.legalName || company.name,
      lineas: lineasEmisor,
    },
    numero: `N.º ${datos.number}`,
    fecha: formatearFecha(datos.createdAt, company),
    validez: datos.validUntil
      ? `Válida hasta ${formatearFecha(datos.validUntil, company)}`
      : null,
    destinatario: {
      // Sin contacto se cae al título de la oportunidad: es un apaño y se
      // nota, pero es mejor que un documento sin destinatario.
      nombre: datos.contact?.name?.trim() || datos.lead.title,
      telefono: datos.contact?.phone?.trim() || null,
    },
    asunto: datos.title?.trim() || null,
    filas: datos.items.map((item) => ({
      nombre: item.name,
      descripcion: item.description?.trim() || null,
      cantidad: String(item.quantity),
      unitario: formatearDinero(item.unitPrice, company),
      total: formatearDinero(item.subtotal, company),
    })),
    totales,
    notas: datos.notes?.trim() || null,
    piePersonalizado: company.quoteFooter?.trim() || null,
  };
}
