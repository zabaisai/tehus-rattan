import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateQuoteFromLeadDto } from './create-quote-from-lead.dto';
import { UpdateQuoteDto } from './update-quote.dto';

/**
 * LA FRONTERA QUE DEJABA LA FUNCIONALIDAD INALCANZABLE.
 *
 * El esquema, el motor de calculo y sus pruebas soportaban transporte,
 * impuesto, ajuste y descuentos por linea. Los DTO no los declaraban, y con
 * `forbidNonWhitelisted` la API respondia «property shipping should not exist».
 * La funcionalidad existia, estaba probada y no se podia usar.
 *
 * Estas pruebas viven en la CAPA DE VALIDACION a proposito: es donde estaba el
 * fallo, y ninguna prueba del servicio o del motor lo habria visto.
 */
const errores = (cls: any, cuerpo: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, cuerpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const propiedades = (cls: any, cuerpo: Record<string, unknown>) =>
  errores(cls, cuerpo).map((e) => e.property);

describe('DTO económico de cotizaciones', () => {
  describe.each([
    ['CreateQuoteFromLeadDto', CreateQuoteFromLeadDto],
    ['UpdateQuoteDto', UpdateQuoteDto],
  ])('%s', (_nombre, Dto) => {
    it('ACEPTA los campos que el dominio ya soportaba', () => {
      expect(
        errores(Dto, {
          discount: 25000,
          shipping: 50000,
          adjustment: 5000,
          adjustmentLabel: 'Descuento acordado',
          taxRate: 19,
          taxIncluded: false,
        }),
      ).toHaveLength(0);
    });

    it('un ajuste NEGATIVO es válido: es su razón de ser', () => {
      expect(errores(Dto, { adjustment: -15000 })).toHaveLength(0);
    });

    it('rechaza un descuento negativo', () => {
      expect(propiedades(Dto, { discount: -1 })).toContain('discount');
    });

    it('rechaza un transporte negativo', () => {
      expect(propiedades(Dto, { shipping: -1 })).toContain('shipping');
    });

    it('rechaza un impuesto fuera de 0–100', () => {
      expect(propiedades(Dto, { taxRate: 101 })).toContain('taxRate');
      expect(propiedades(Dto, { taxRate: -1 })).toContain('taxRate');
      expect(errores(Dto, { taxRate: 19 })).toHaveLength(0);
      expect(errores(Dto, { taxRate: 0 })).toHaveLength(0);
    });

    it('rechaza números no finitos', () => {
      // `Infinity` y `NaN` atraviesan un `IsNumber` mal configurado y acaban
      // como `NaN` en la base, que es como se ve «$ NaN» en pantalla.
      expect(propiedades(Dto, { shipping: Infinity })).toContain('shipping');
      expect(propiedades(Dto, { discount: NaN })).toContain('discount');
    });

    it('rechaza más de 4 decimales, que es lo que la base guarda', () => {
      expect(propiedades(Dto, { shipping: 1.23456 })).toContain('shipping');
      expect(errores(Dto, { shipping: 1.2345 })).toHaveLength(0);
    });

    it('rechaza importes absurdos', () => {
      expect(propiedades(Dto, { shipping: 1e12 })).toContain('shipping');
    });

    it('sigue rechazando lo que NO existe', () => {
      // La corrección amplía la superficie; no la abre entera.
      expect(propiedades(Dto, { total: 1 })).toContain('total');
      expect(propiedades(Dto, { companyId: 'otra' })).toContain('companyId');
    });

    it('el cliente NO puede imponer el total', () => {
      expect(propiedades(Dto, { total: 999 })).toContain('total');
      expect(propiedades(Dto, { taxTotal: 999 })).toContain('taxTotal');
      expect(propiedades(Dto, { subtotal: 999 })).toContain('subtotal');
    });
  });

  describe('líneas', () => {
    it('acepta cantidad, precio y descuento por línea', () => {
      expect(
        errores(UpdateQuoteDto, {
          lineas: [
            { id: 'it1', quantity: 3, unitPrice: 250000, lineDiscount: 10000 },
          ],
        }),
      ).toHaveLength(0);
    });

    it('acepta el descuento de línea en porcentaje', () => {
      expect(
        errores(UpdateQuoteDto, {
          lineas: [{ id: 'it1', lineDiscountPercent: 12.5 }],
        }),
      ).toHaveLength(0);
    });

    it('exige el id de la línea', () => {
      expect(
        propiedades(UpdateQuoteDto, { lineas: [{ quantity: 2 }] }),
      ).toEqual(['lineas']);
    });

    it('rechaza cantidad cero o fraccionaria', () => {
      expect(
        errores(UpdateQuoteDto, { lineas: [{ id: 'it1', quantity: 0 }] }),
      ).not.toHaveLength(0);
      expect(
        errores(UpdateQuoteDto, { lineas: [{ id: 'it1', quantity: 1.5 }] }),
      ).not.toHaveLength(0);
    });

    it('rechaza un porcentaje mayor que 100', () => {
      expect(
        errores(UpdateQuoteDto, {
          lineas: [{ id: 'it1', lineDiscountPercent: 120 }],
        }),
      ).not.toHaveLength(0);
    });

    it('rechaza un cuerpo con demasiadas líneas', () => {
      const muchas = Array.from({ length: 501 }, (_, i) => ({ id: `it${i}` }));
      expect(propiedades(UpdateQuoteDto, { lineas: muchas })).toContain(
        'lineas',
      );
    });
  });

  describe('campos no económicos', () => {
    it('el estado solo admite los del ciclo de vida', () => {
      expect(errores(UpdateQuoteDto, { status: 'SENT' })).toHaveLength(0);
      expect(propiedades(UpdateQuoteDto, { status: 'INVENTADO' })).toContain(
        'status',
      );
    });

    it('la vigencia tiene que ser una fecha', () => {
      expect(propiedades(UpdateQuoteDto, { validUntil: 'mañana' })).toContain(
        'validUntil',
      );
      expect(
        errores(UpdateQuoteDto, { validUntil: '2026-12-31T00:00:00.000Z' }),
      ).toHaveLength(0);
    });

    it('la etiqueta del ajuste tiene un tope', () => {
      expect(
        propiedades(UpdateQuoteDto, { adjustmentLabel: 'x'.repeat(81) }),
      ).toContain('adjustmentLabel');
    });
  });
});
