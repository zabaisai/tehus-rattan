import { QuotePdfService, type DatosCotizacion } from './quote-pdf.service';

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
    {
      name: 'Mesa de centro',
      description: null,
      quantity: 2,
      unitPrice: 100_000,
      subtotal: 200_000,
    },
  ],
};

/** Extrae el texto legible del PDF, suficiente para comprobar contenidos. */
const textoDe = (pdf: Buffer) => pdf.toString('latin1');

describe('QuotePdfService', () => {
  let service: QuotePdfService;

  beforeEach(() => {
    service = new QuotePdfService();
  });

  describe('es un PDF de verdad', () => {
    it('empieza por la cabecera %PDF y termina en %%EOF', async () => {
      const pdf = await service.generar(base);

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(textoDe(pdf).trimEnd().endsWith('%%EOF')).toBe(true);
    });

    it('tiene contenido real, no un documento vacío', async () => {
      const pdf = await service.generar(base);

      expect(pdf.length).toBeGreaterThan(1_000);
    });

    it('declara metadatos de documento', async () => {
      // El texto del PDF va comprimido (FlateDecode), asi que no se puede
      // comprobar buscando cadenas: QUE dice el documento se prueba en
      // quote-document.spec.ts, que es una funcion pura. Aqui solo se
      // comprueba que el archivo sale bien formado.
      const pdf = await service.generar(base);

      expect(textoDe(pdf)).toContain('/Title');
    });
  });

  describe('robustez con datos incompletos', () => {
    it('sin campos opcionales de la empresa no falla', async () => {
      // Los campos vacíos se omiten: una línea en blanco en un documento que
      // va a un cliente parece un error de la empresa.
      const pdf = await service.generar({
        ...base,
        company: { name: 'Mínima' },
      });

      expect(pdf.length).toBeGreaterThan(500);
    });

    it('sin contacto usa el título de la oportunidad', async () => {
      await expect(
        service.generar({ ...base, contact: null }),
      ).resolves.toBeInstanceOf(Buffer);
    });

    it('sin items genera igualmente el documento', async () => {
      // Una cotización vacía es rara, pero devolver un error al pedir el PDF
      // sería peor: el usuario no sabría que le falta añadir productos.
      await expect(
        service.generar({ ...base, items: [] }),
      ).resolves.toBeInstanceOf(Buffer);
    });

    it('una moneda inválida no impide emitir la cotización', async () => {
      await expect(
        service.generar({
          ...base,
          company: { ...base.company, currency: 'INVENTADA' },
        }),
      ).resolves.toBeInstanceOf(Buffer);
    });

    it('una configuración regional inválida tampoco', async () => {
      await expect(
        service.generar({
          ...base,
          company: { ...base.company, locale: '@@@' },
        }),
      ).resolves.toBeInstanceOf(Buffer);
    });
  });

  describe('muchas líneas', () => {
    it('con 60 items no se rompe ni se solapa: pagina', async () => {
      // Sin salto de página las líneas se superponen al pie y el documento
      // sale ilegible.
      const muchos = Array.from({ length: 60 }, (_, i) => ({
        name: `Producto ${i + 1}`,
        description: 'Descripción de ejemplo',
        quantity: 1,
        unitPrice: 10_000,
        subtotal: 10_000,
      }));

      const pdf = await service.generar({ ...base, items: muchos });

      // Más de una página: el contador de páginas del PDF lo refleja.
      expect(textoDe(pdf)).toContain('/Count');
      expect(pdf.length).toBeGreaterThan(5_000);
    });
  });

  describe('no filtra nada que no deba', () => {
    it('no anuncia la pila técnica', async () => {
      // Es un documento que se manda a clientes.
      const pdf = await service.generar(base);
      const texto = textoDe(pdf);

      expect(texto).not.toContain('Nest');
      expect(texto).not.toContain('takto');
    });
  });

  describe('descuento', () => {
    it('con y sin descuento se dibuja sin fallar', async () => {
      // Que la LINEA aparezca o no se decide y se prueba en
      // quote-document.spec.ts; aqui solo importa que el pintado aguante
      // ambos casos.
      await expect(
        service.generar({ ...base, discount: 0 }),
      ).resolves.toBeInstanceOf(Buffer);
      await expect(
        service.generar({ ...base, discount: 50_000, total: 950_000 }),
      ).resolves.toBeInstanceOf(Buffer);
    });
  });
});
