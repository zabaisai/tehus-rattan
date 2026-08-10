import { construirDocumento } from './quote-document';
import { datosDelCaso } from './quote-caso-staging';

/**
 * EL DOCUMENTO NO CUADRABA A LA VISTA.
 *
 * Caso real, encontrado en staging el 7 de agosto de 2026 sobre el release
 * `0b8ebba`. El total persistido era correcto y el PDF lo imprimia bien, pero
 * el desglose que deberia justificarlo solo mostraba:
 *
 *     Subtotal      $ 400.000
 *     Descuento   - $  25.000
 *     TOTAL         $ 487.900
 *
 * 400.000 - 25.000 = 375.000, no 487.900. Faltaban transporte, ajuste e
 * impuesto. Un cliente que sume las lineas del papel no llega al total, y esa
 * es exactamente la clase de documento que no se puede mandar.
 *
 * POR QUE APARECIO AHORA: hasta que los campos economicos fueron alcanzables
 * desde la API, toda cotizacion tenia transporte, impuesto y ajuste en cero y
 * el documento cuadraba por casualidad. Al habilitarlos, el hueco se hizo
 * visible.
 */
/** Todo el texto de las filas de totales, para poder buscar en él. */
const textoDeTotales = (d: ReturnType<typeof construirDocumento>) =>
  d.totales.map((f) => `${f.etiqueta} ${f.valor}`).join(' | ');

describe('Desglose económico del documento (regresión de staging)', () => {
  it('el total impreso es el que viene del servidor', () => {
    // Esto SIEMPRE estuvo bien: el fallo no era el total, era su justificación.
    const doc = construirDocumento(datosDelCaso());
    const total = doc.totales.find((f) => f.destacada);
    expect(total?.etiqueta).toBe('TOTAL');
    expect(total?.valor).toContain('487.900');
  });

  it('muestra el TRANSPORTE', () => {
    const texto = textoDeTotales(construirDocumento(datosDelCaso()));
    expect(texto).toMatch(/transporte/i);
    expect(texto).toContain('50.000');
  });

  it('muestra el AJUSTE con su etiqueta y su signo', () => {
    const texto = textoDeTotales(construirDocumento(datosDelCaso()));
    expect(texto).toContain('QA_HOTFIX_ rebaja');
    // Negativo: el signo es la diferencia entre una rebaja y un recargo.
    expect(texto).toMatch(/-\s*\$?\s*15\.000/);
  });

  it('muestra el IMPUESTO con su tasa', () => {
    const texto = textoDeTotales(construirDocumento(datosDelCaso()));
    expect(texto).toMatch(/iva|impuesto/i);
    expect(texto).toContain('19');
    expect(texto).toContain('77.900');
  });

  it('muestra los descuentos POR LÍNEA cuando los hay', () => {
    const texto = textoDeTotales(construirDocumento(datosDelCaso()));
    expect(texto).toMatch(/línea|linea/i);
    expect(texto).toContain('100.000');
  });

  /**
   * LA COMPROBACION QUE DE VERDAD IMPORTA.
   *
   * No basta con que aparezcan los conceptos: quien lea el papel tiene que
   * poder sumar lo que ve y llegar al total. Esto reconstruye la aritmetica
   * desde las cifras IMPRESAS, no desde los datos de entrada.
   */
  it('el desglose IMPRESO permite reconstruir el total', () => {
    const doc = construirDocumento(datosDelCaso());
    const numero = (v: string) => {
      const limpio = v.replace(/[^\d,.-]/g, '').replace(/\./g, '');
      const n = Number(limpio.replace(',', '.'));
      return v.trim().startsWith('-') ? -Math.abs(n) : n;
    };

    const filas = doc.totales.filter((f) => !f.destacada);
    const total = doc.totales.find((f) => f.destacada)!;

    const suma = filas.reduce((acc, f) => acc + numero(f.valor), 0);
    expect(suma).toBe(numero(total.valor));
  });
});
