import {
  construirDocumento,
  formatearDinero,
  type DatosCotizacion,
} from './quote-document';

const base: DatosCotizacion = {
  number: 'COT-0007',
  title: 'Sala en rattan',
  status: 'SENT',
  subtotal: 1_000_000,
  discount: 0,
  lineDiscountTotal: 0,
  shipping: 0,
  adjustment: 0,
  adjustmentLabel: null,
  taxRate: 0,
  taxTotal: 0,
  taxIncluded: false,
  total: 1_000_000,
  notes: null,
  validUntil: new Date('2026-09-30T00:00:00Z'),
  createdAt: new Date('2026-08-01T00:00:00Z'),
  company: {
    name: 'Muebles Ejemplo',
    legalName: 'Muebles Ejemplo S.A.S.',
    taxId: '900123456-7',
    email: 'ventas@ejemplo.test',
    phone: '+5716001234',
    address: 'Calle 1 # 2-3',
    city: 'Bogotá',
    country: 'Colombia',
    website: 'ejemplo.test',
    quoteFooter: 'Precios sujetos a disponibilidad.',
    currency: 'COP',
    locale: 'es-CO',
  },
  lead: { title: 'Oportunidad — Ana' },
  contact: { name: 'Ana Pérez', phone: '+573001112233' },
  items: [
    {
      name: 'Sofá 3 puestos',
      description: 'Rattan natural',
      quantity: 1,
      unitPrice: 800_000,
      subtotal: 800_000,
    },
  ],
};

describe('construirDocumento', () => {
  describe('emisor', () => {
    it('usa la razón social si la hay', () => {
      expect(construirDocumento(base).emisor.nombre).toBe(
        'Muebles Ejemplo S.A.S.',
      );
    });

    it('sin razón social usa el nombre comercial', () => {
      const d = construirDocumento({
        ...base,
        company: { ...base.company, legalName: null },
      });

      expect(d.emisor.nombre).toBe('Muebles Ejemplo');
    });

    it('OMITE los campos vacíos en vez de dejar líneas en blanco', () => {
      // Una línea vacía en un documento que va a un cliente parece un error
      // de la empresa.
      const d = construirDocumento({
        ...base,
        company: { name: 'Mínima', currency: 'COP', locale: 'es-CO' },
      });

      expect(d.emisor.lineas).toEqual([]);
    });

    it('descarta los campos que solo tienen espacios', () => {
      const d = construirDocumento({
        ...base,
        company: { ...base.company, address: '   ', website: '' },
      });

      expect(d.emisor.lineas).not.toContain('   ');
      expect(d.emisor.lineas).not.toContain('');
    });

    it('el NIT se etiqueta, no sale suelto', () => {
      expect(construirDocumento(base).emisor.lineas).toContain(
        'NIT 900123456-7',
      );
    });
  });

  describe('destinatario', () => {
    it('usa el nombre del contacto', () => {
      expect(construirDocumento(base).destinatario.nombre).toBe('Ana Pérez');
    });

    it('sin contacto cae al título de la oportunidad', () => {
      // Es un apaño y se nota, pero es mejor que un documento sin
      // destinatario.
      const d = construirDocumento({ ...base, contact: null });

      expect(d.destinatario.nombre).toBe('Oportunidad — Ana');
    });

    it('un nombre en blanco cuenta como ausente', () => {
      const d = construirDocumento({
        ...base,
        contact: { name: '   ', phone: null },
      });

      expect(d.destinatario.nombre).toBe('Oportunidad — Ana');
      expect(d.destinatario.telefono).toBeNull();
    });
  });

  describe('totales', () => {
    it('sin descuento NO se genera la línea', () => {
      // Un "Descuento: 0" invita a preguntar por qué no hay descuento.
      const etiquetas = construirDocumento(base).totales.map((t) => t.etiqueta);

      expect(etiquetas).toEqual(['Subtotal', 'TOTAL']);
    });

    /**
     * La etiqueta pasa de «Descuento» a «Descuento general» a proposito: desde
     * que existen descuentos POR LINEA, «Descuento» a secas es ambiguo en un
     * documento que puede llevar los dos.
     */
    it('con descuento general aparece, y en negativo', () => {
      const d = construirDocumento({
        ...base,
        discount: 50_000,
        total: 950_000,
      });
      const descuento = d.totales.find(
        (t) => t.etiqueta === 'Descuento general',
      );

      expect(descuento).toBeDefined();
      expect(descuento!.valor.startsWith('- ')).toBe(true);
    });

    it('el total es la última y va destacada', () => {
      const totales = construirDocumento(base).totales;

      expect(totales.at(-1)!.etiqueta).toBe('TOTAL');
      expect(totales.at(-1)!.destacada).toBe(true);
    });

    it('un descuento negativo no crea una línea absurda', () => {
      const d = construirDocumento({ ...base, discount: -10 });

      expect(d.totales.map((t) => t.etiqueta)).not.toContain('Descuento');
    });
  });

  describe('líneas de producto', () => {
    it('respeta el orden y los importes recibidos', () => {
      const d = construirDocumento({
        ...base,
        items: [
          { name: 'A', quantity: 2, unitPrice: 100, subtotal: 200 },
          { name: 'B', quantity: 1, unitPrice: 50, subtotal: 50 },
        ],
      });

      expect(d.filas.map((f) => f.nombre)).toEqual(['A', 'B']);
      expect(d.filas[0].cantidad).toBe('2');
    });

    it('una descripción vacía se convierte en ausente', () => {
      const d = construirDocumento({
        ...base,
        items: [
          {
            name: 'A',
            description: '  ',
            quantity: 1,
            unitPrice: 1,
            subtotal: 1,
          },
        ],
      });

      expect(d.filas[0].descripcion).toBeNull();
    });

    it('sin líneas se genera el documento igualmente', () => {
      // Devolver un error al pedir el PDF sería peor: el usuario no sabría
      // que le falta añadir productos.
      expect(construirDocumento({ ...base, items: [] }).filas).toEqual([]);
    });
  });

  describe('formato', () => {
    it('usa la moneda y la región de LA EMPRESA', () => {
      const valor = formatearDinero(1_000_000, base.company);

      expect(valor).toContain('1.000.000');
    });

    it('una moneda inválida no rompe: degrada el formato', () => {
      const valor = formatearDinero(1000, {
        ...base.company,
        currency: 'INVENTADA',
      });

      expect(valor).toContain('1000');
    });

    it('una región inválida tampoco', () => {
      expect(() =>
        formatearDinero(1000, { ...base.company, locale: '@@@' }),
      ).not.toThrow();
    });

    it('sin fecha de validez no se inventa una', () => {
      expect(
        construirDocumento({ ...base, validUntil: null }).validez,
      ).toBeNull();
    });
  });

  describe('notas y pie', () => {
    it('las notas en blanco cuentan como ausentes', () => {
      expect(construirDocumento({ ...base, notes: '   ' }).notas).toBeNull();
    });

    it('el pie de la empresa se incluye', () => {
      expect(construirDocumento(base).piePersonalizado).toBe(
        'Precios sujetos a disponibilidad.',
      );
    });
  });

  describe('metadatos', () => {
    it('el título lleva el número de cotización', () => {
      expect(construirDocumento(base).titulo).toBe('Cotización COT-0007');
    });

    it('no expone identificadores internos', () => {
      const serializado = JSON.stringify(construirDocumento(base));

      expect(serializado).not.toContain('cuid');
      expect(serializado).not.toContain('companyId');
    });
  });
});
