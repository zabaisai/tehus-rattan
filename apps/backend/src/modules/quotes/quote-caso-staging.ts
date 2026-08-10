import type { DatosCotizacion } from './quote-document';

/**
 * EL CASO REAL ENCONTRADO EN STAGING, en un solo sitio.
 *
 * Encontrado el 7 de agosto de 2026 sobre el release `0b8ebba`. El total
 * persistido era correcto y el PDF lo imprimia bien, pero el desglose que
 * deberia justificarlo solo mostraba subtotal, descuento y total:
 *
 *     400.000 - 25.000 = 375.000, y el papel decia 487.900.
 *
 * Lo usan varias pruebas; tenerlo aqui evita que se copien versiones que se
 * desvian entre si.
 */
export const CASO_STAGING = {
  subtotal: 400_000,
  lineDiscountTotal: 100_000,
  discount: 25_000,
  shipping: 50_000,
  adjustment: -15_000,
  adjustmentLabel: 'QA_HOTFIX_ rebaja',
  taxableBase: 410_000,
  taxRate: 19,
  taxTotal: 77_900,
  taxIncluded: false,
  total: 487_900,
};

export function datosDelCaso(): DatosCotizacion {
  return {
    number: 'COT-0001',
    status: 'DRAFT',
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
    company: { name: 'Tehus Rattan', currency: 'COP', locale: 'es-CO' },
    lead: { title: 'Oportunidad' },
    contact: { name: 'Cliente', phone: '+573001110077' },
    items: [
      {
        name: 'Silla de ratán',
        quantity: 2,
        unitPrice: 250_000,
        subtotal: 400_000,
      },
    ],
    ...CASO_STAGING,
  };
}
