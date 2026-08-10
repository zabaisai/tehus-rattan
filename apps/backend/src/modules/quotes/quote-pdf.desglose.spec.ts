import { QuotePdfService } from './quote-pdf.service';
import { construirDocumento, type DatosCotizacion } from './quote-document';
import { datosDelCaso, CASO_STAGING } from './quote-caso-staging';
import { extraerTextoDePdf } from './quote-pdf.texto';

/**
 * EL PDF DE VERDAD, NO SU MODELO.
 *
 * El desglose vive en `quote-desglose.ts` y se prueba alli, pero eso no
 * demuestra que ACABE EN EL PAPEL: en staging el modelo era correcto y el
 * controlador no le pasaba los campos, asi que el documento salia sin
 * transporte, sin ajuste y sin impuesto.
 */
describe('PDF: el desglose llega al papel', () => {
  const servicio = new QuotePdfService();

  it('el extractor funciona: encuentra lo que SIEMPRE estuvo bien', async () => {
    // Sin esto, un extractor roto haria pasar todas las demas pruebas por no
    // encontrar nunca nada.
    const texto = extraerTextoDePdf(await servicio.generar(datosDelCaso()));
    expect(texto).toContain('COTIZACIÓN');
    expect(texto).toContain('COT-0001');
  });

  it('imprime TODOS los conceptos del caso de staging', async () => {
    const texto = extraerTextoDePdf(await servicio.generar(datosDelCaso()));

    expect(texto).toContain('Subtotal bruto');
    expect(texto).toContain('500.000');
    expect(texto).toContain('Descuentos por línea');
    expect(texto).toContain('Descuento general');
    expect(texto).toContain('Transporte');
    expect(texto).toContain('50.000');
    expect(texto).toContain('QA_HOTFIX_ rebaja');
    expect(texto).toContain('IVA 19%');
    expect(texto).toContain('77.900');
    expect(texto).toContain('487.900');
  });

  it('NUNCA imprime «NaN» ni «undefined»', async () => {
    const texto = extraerTextoDePdf(await servicio.generar(datosDelCaso()));
    expect(texto).not.toContain('NaN');
    expect(texto).not.toContain('undefined');
  });

  /**
   * LA COMPROBACION QUE DE VERDAD IMPORTA.
   *
   * Quien lea el papel tiene que poder sumar lo que ve y llegar al total. Esto
   * lo reconstruye desde las cifras IMPRESAS, no desde los datos de entrada.
   */
  it('las cifras impresas suman el total', async () => {
    const doc = construirDocumento(datosDelCaso());
    const numero = (v: string) => {
      const n = Number(v.replace(/[^\d,-]/g, '').replace(',', '.'));
      return v.trim().startsWith('-') ? -Math.abs(n) : n;
    };

    const total = doc.totales.find((f) => f.destacada)!;
    const suma = doc.totales
      .filter((f) => !f.destacada && f.valor)
      // La fila de «IVA incluido» no suma; en este caso no aplica.
      .reduce((acc, f) => acc + numero(f.valor), 0);

    expect(suma).toBe(CASO_STAGING.total);
    expect(numero(total.valor)).toBe(CASO_STAGING.total);
  });

  it('el PDF es válido y descargable', async () => {
    const pdf = await servicio.generar(datosDelCaso());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    // Un PDF sin marca de fin es un archivo truncado que algunos lectores
    // abren y otros rechazan.
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  describe('maquetación', () => {
    /**
     * El bloque de totales crece: antes eran tres filas y ahora pueden ser
     * siete. Si no cupiera, el TOTAL acabaria solo en otra pagina o pisando el
     * pie, que es la forma mas rapida de que un documento parezca un error.
     */
    it('el desglose completo cabe en la primera página', async () => {
      const pdf = await servicio.generar(datosDelCaso());
      const paginas = (
        pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []
      ).length;
      expect(paginas).toBe(1);
    });

    it('con muchas líneas el documento pagina sin perder el total', async () => {
      const muchas: DatosCotizacion = {
        ...datosDelCaso(),
        items: Array.from({ length: 40 }, (_, i) => ({
          name: `Producto ${i + 1}`,
          quantity: 1,
          unitPrice: 10_000,
          subtotal: 10_000,
        })),
      };
      const texto = extraerTextoDePdf(await servicio.generar(muchas));

      // El total sigue estando, esté en la página que esté.
      expect(texto).toContain('TOTAL');
      expect(texto).toContain('487.900');
    });

    /**
     * PDFKit PARTE la etiqueta larga en varias lineas dentro de su columna, que
     * es lo correcto: se lee entera y no invade la columna del importe. Lo que
     * habria que evitar es que la RECORTARA.
     *
     * Por eso se comprueba sobre el texto con los saltos colapsados: buscar la
     * cadena tal cual falla en el punto donde parte, y eso seria una prueba
     * que suspende por maquetacion correcta.
     */
    it('una etiqueta de ajuste larga se parte, pero no se recorta', async () => {
      const datos = datosDelCaso();
      const etiqueta = 'Rebaja acordada con el cliente por volumen anual';
      datos.adjustmentLabel = etiqueta;

      const texto = extraerTextoDePdf(await servicio.generar(datos));
      const enUnaLinea = texto.replace(/\s+/g, ' ');

      expect(enUnaLinea).toContain(etiqueta);
      // Y su importe sigue a su lado, no se queda huerfano.
      expect(enUnaLinea).toContain('- $ 15.000');
    });

    it('la marca de la empresa se conserva', async () => {
      const texto = extraerTextoDePdf(await servicio.generar(datosDelCaso()));
      expect(texto).toContain('Tehus Rattan');
    });
  });

  describe('otros casos', () => {
    it('sin transporte, impuesto ni ajuste imprime solo subtotal y total', async () => {
      const datos: DatosCotizacion = {
        ...datosDelCaso(),
        subtotal: 400_000,
        lineDiscountTotal: 0,
        discount: 0,
        shipping: 0,
        adjustment: 0,
        adjustmentLabel: null,
        taxRate: 0,
        taxTotal: 0,
        total: 400_000,
      };
      const texto = extraerTextoDePdf(await servicio.generar(datos));

      expect(texto).toContain('Subtotal');
      expect(texto).not.toMatch(/transporte/i);
      expect(texto).not.toMatch(/iva/i);
      expect(texto).toContain('400.000');
    });

    it('con impuesto INCLUIDO lo dice en el papel', async () => {
      const datos: DatosCotizacion = {
        ...datosDelCaso(),
        subtotal: 400_000,
        lineDiscountTotal: 0,
        discount: 0,
        shipping: 0,
        adjustment: 0,
        adjustmentLabel: null,
        taxRate: 19,
        taxTotal: 63_866,
        taxIncluded: true,
        total: 400_000,
      };
      const texto = extraerTextoDePdf(await servicio.generar(datos));

      expect(texto).toMatch(/incluido/i);
      expect(texto).toContain('400.000');
    });
  });
});
