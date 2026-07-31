import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  construirDocumento,
  type DatosCotizacion,
  type DocumentoCotizacion,
} from './quote-document';

export type { DatosCotizacion } from './quote-document';

const MARGEN = 48;
const ANCHO_PAGINA = 595.28; // A4 en puntos
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;
/** A partir de aquí ya no cabe una fila más sin invadir el pie. */
const LIMITE_VERTICAL = 700;

const COLUMNAS = [
  { x: MARGEN, ancho: ANCHO_UTIL - 250, alinear: 'left' as const },
  { x: MARGEN + ANCHO_UTIL - 250, ancho: 50, alinear: 'right' as const },
  { x: MARGEN + ANCHO_UTIL - 190, ancho: 90, alinear: 'right' as const },
  { x: MARGEN + ANCHO_UTIL - 90, ancho: 90, alinear: 'right' as const },
];

/**
 * Dibuja el PDF de una cotización, EN EL SERVIDOR.
 *
 * Por qué en el servidor y no imprimiendo la pantalla: un PDF hecho por el
 * navegador depende de la impresora, del zoom y de la versión de Chrome de
 * quien lo genere, así que dos personas mandan documentos distintos al mismo
 * cliente. Aquí el resultado es idéntico siempre, y se puede adjuntar a un
 * correo sin que nadie abra el navegador.
 *
 * PDFKit y no Chromium sin cabeza (decisión cerrada 11): un Chromium por PDF
 * multiplica por diez la memoria del contenedor y añade una superficie de
 * actualizaciones de seguridad enorme para dibujar una tabla.
 *
 * Este servicio SOLO pinta. Qué dice el documento —qué campos se omiten, cómo
 * se formatea el dinero, si aparece la línea de descuento— se decide en
 * `quote-document.ts`, que es una función pura y sí se puede probar: el
 * contenido de un PDF va comprimido y no se puede comprobar buscando texto.
 *
 * No se descarga el logotipo: obligaría a una petición de red por documento,
 * con su espera y su modo de fallo, dentro de una respuesta que el usuario
 * está esperando.
 */
@Injectable()
export class QuotePdfService {
  async generar(datos: DatosCotizacion): Promise<Buffer> {
    const doc = construirDocumento(datos);
    return this.pintar(doc);
  }

  /**
   * Devuelve el PDF entero en memoria. Una cotización tiene decenas de
   * líneas, no miles: acumular es más simple que un flujo y permite fijar
   * `Content-Length`, que es lo que hace que el navegador muestre progreso de
   * descarga real en vez de una barra indeterminada.
   */
  private async pintar(d: DocumentoCotizacion): Promise<Buffer> {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: MARGEN,
      // Sin Creator/Producer personalizados: no hace falta anunciar la pila
      // técnica en un documento que se manda a clientes.
      info: { Title: d.titulo, Author: d.emisor.nombre },
    });

    const trozos: Buffer[] = [];
    pdf.on('data', (t: Buffer) => trozos.push(t));
    const terminado = new Promise<Buffer>((resolve, reject) => {
      pdf.on('end', () => resolve(Buffer.concat(trozos)));
      pdf.on('error', reject);
    });

    this.encabezado(pdf, d);
    this.destinatario(pdf, d);
    const y = this.tabla(pdf, d);
    this.totales(pdf, d, y);
    this.pie(pdf, d);

    pdf.end();
    return terminado;
  }

  private encabezado(pdf: PDFKit.PDFDocument, d: DocumentoCotizacion): void {
    pdf
      .fillColor('#131C4A')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(d.emisor.nombre, MARGEN, MARGEN);

    pdf.fontSize(8).font('Helvetica').fillColor('#525A6B');
    for (const linea of d.emisor.lineas) pdf.text(linea, MARGEN, pdf.y);

    pdf
      .fillColor('#131C4A')
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('COTIZACIÓN', MARGEN, MARGEN, {
        align: 'right',
        width: ANCHO_UTIL,
      });

    pdf
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#171B24')
      .text(d.numero, MARGEN, MARGEN + 26, {
        align: 'right',
        width: ANCHO_UTIL,
      })
      .fillColor('#525A6B')
      .fontSize(8)
      .text(d.fecha, MARGEN, MARGEN + 42, {
        align: 'right',
        width: ANCHO_UTIL,
      });

    if (d.validez) {
      pdf.text(d.validez, MARGEN, MARGEN + 54, {
        align: 'right',
        width: ANCHO_UTIL,
      });
    }

    const y = Math.max(pdf.y, MARGEN + 70) + 10;
    pdf
      .moveTo(MARGEN, y)
      .lineTo(MARGEN + ANCHO_UTIL, y)
      .strokeColor('#E2E5EC')
      .stroke();
    pdf.y = y + 14;
  }

  private destinatario(pdf: PDFKit.PDFDocument, d: DocumentoCotizacion): void {
    pdf
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#525A6B')
      .text('PARA', MARGEN, pdf.y);

    pdf
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#171B24')
      .text(d.destinatario.nombre, MARGEN, pdf.y + 2);

    if (d.destinatario.telefono) {
      pdf
        .fontSize(9)
        .fillColor('#525A6B')
        .text(d.destinatario.telefono, MARGEN, pdf.y);
    }

    if (d.asunto) {
      pdf
        .fontSize(10)
        .fillColor('#171B24')
        .font('Helvetica-Bold')
        .text(d.asunto, MARGEN, pdf.y + 8);
    }

    pdf.y += 16;
  }

  private tabla(pdf: PDFKit.PDFDocument, d: DocumentoCotizacion): number {
    const yCabecera = pdf.y;

    pdf.rect(MARGEN, yCabecera, ANCHO_UTIL, 20).fill('#F7F8FA');
    pdf.fillColor('#525A6B').fontSize(8).font('Helvetica-Bold');
    ['DESCRIPCIÓN', 'CANT.', 'UNITARIO', 'TOTAL'].forEach((titulo, i) => {
      pdf.text(titulo, COLUMNAS[i].x, yCabecera + 6, {
        width: COLUMNAS[i].ancho,
        align: COLUMNAS[i].alinear,
      });
    });

    let y = yCabecera + 26;
    pdf.font('Helvetica').fontSize(9);

    for (const fila of d.filas) {
      // Salto de página cuando ya no cabe. Sin esto las líneas se superponen
      // al pie y el documento sale ilegible pasadas unas veinte.
      if (y > LIMITE_VERTICAL) {
        pdf.addPage();
        y = MARGEN;
      }

      pdf.fillColor('#171B24').text(fila.nombre, COLUMNAS[0].x, y, {
        width: COLUMNAS[0].ancho,
      });
      const yTrasNombre = pdf.y;

      if (fila.descripcion) {
        pdf
          .fillColor('#6E7688')
          .fontSize(8)
          .text(fila.descripcion, COLUMNAS[0].x, yTrasNombre, {
            width: COLUMNAS[0].ancho,
          })
          .fontSize(9);
      }

      pdf.fillColor('#171B24');
      pdf.text(fila.cantidad, COLUMNAS[1].x, y, {
        width: COLUMNAS[1].ancho,
        align: 'right',
      });
      pdf.text(fila.unitario, COLUMNAS[2].x, y, {
        width: COLUMNAS[2].ancho,
        align: 'right',
      });
      pdf.text(fila.total, COLUMNAS[3].x, y, {
        width: COLUMNAS[3].ancho,
        align: 'right',
      });

      y = Math.max(pdf.y, yTrasNombre) + 8;
      pdf
        .moveTo(MARGEN, y - 4)
        .lineTo(MARGEN + ANCHO_UTIL, y - 4)
        .strokeColor('#EFF1F5')
        .stroke();
    }

    return y;
  }

  private totales(
    pdf: PDFKit.PDFDocument,
    d: DocumentoCotizacion,
    yInicial: number,
  ): void {
    let y = yInicial + 8;
    if (y > LIMITE_VERTICAL) {
      pdf.addPage();
      y = MARGEN;
    }

    const xEtiqueta = MARGEN + ANCHO_UTIL - 220;
    const xValor = MARGEN + ANCHO_UTIL - 90;

    d.totales.forEach((fila, i) => {
      // Línea separadora justo antes del total destacado.
      if (fila.destacada) {
        pdf
          .moveTo(xEtiqueta, y)
          .lineTo(MARGEN + ANCHO_UTIL, y)
          .strokeColor('#CBD0DB')
          .stroke();
        y += 8;
      }

      pdf
        .font(fila.destacada ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(fila.destacada ? 11 : 9)
        .fillColor(fila.destacada ? '#131C4A' : '#525A6B')
        .text(fila.etiqueta, xEtiqueta, y, { width: 120, align: 'right' })
        .fillColor(fila.destacada ? '#131C4A' : '#171B24')
        .text(fila.valor, xValor, y, { width: 90, align: 'right' });

      y += fila.destacada ? 20 : 14;
      void i;
    });

    pdf.y = y + 10;
  }

  private pie(pdf: PDFKit.PDFDocument, d: DocumentoCotizacion): void {
    if (d.notas) {
      pdf
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#525A6B')
        .text('NOTAS', MARGEN, pdf.y + 6)
        .font('Helvetica')
        .fillColor('#171B24')
        .text(d.notas, MARGEN, pdf.y + 2, { width: ANCHO_UTIL });
    }

    if (d.piePersonalizado) {
      pdf
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#6E7688')
        .text(d.piePersonalizado, MARGEN, pdf.y + 12, { width: ANCHO_UTIL });
    }
  }
}
