import * as zlib from 'zlib';

/**
 * Lee el texto de un PDF generado por PDFKit.
 *
 * NO ES CODIGO DE PRODUCCION: existe para poder COMPROBAR lo que sale impreso.
 * Vive en un modulo propio y no dentro de un `.spec` porque importar un fichero
 * de pruebas desde otro arrastra sus `describe`, y entonces las mismas pruebas
 * se ejecutan dos veces y los recuentos dejan de significar nada.
 *
 * El contenido de un PDF va comprimido y ademas codificado en hexadecimal por
 * glifo —`<434f><54495a41>` es «COTIZA»—, asi que buscar cadenas ASCII en el
 * archivo no encuentra nada y da una falsa sensacion de que todo esta bien. Esa
 * fue exactamente la trampa al verificar el documento a mano la primera vez.
 */
export function extraerTextoDePdf(pdf: Buffer): string {
  let contenido = Buffer.alloc(0);
  const crudo = pdf.toString('latin1');
  const re = /stream\r?\n/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(crudo)) !== null) {
    const inicio = m.index + m[0].length;
    const fin = crudo.indexOf('endstream', inicio);
    if (fin < 0) continue;
    try {
      contenido = Buffer.concat([
        contenido,
        zlib.inflateSync(Buffer.from(crudo.slice(inicio, fin), 'latin1')),
      ]);
    } catch {
      // Un flujo que no sea zlib —una fuente incrustada, por ejemplo— no es un
      // problema: solo interesan los de contenido.
    }
  }

  const texto = contenido.toString('latin1');
  const lineas: string[] = [];
  for (const tj of texto.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const linea = [...tj[1].matchAll(/<([0-9a-fA-F]+)>/g)]
      .map((h) => Buffer.from(h[1], 'hex').toString('latin1'))
      .join('');
    if (linea.trim()) lineas.push(linea);
  }
  return lineas.join('\n');
}

/** Importes con signo leidos del papel, en el orden en que aparecen. */
export function importesDelPdf(texto: string): number[] {
  const valores: number[] = [];
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^(-\s*)?\$\s*([\d.]+)$/);
    if (!m) continue;
    const valor = Number(m[2].replace(/\./g, ''));
    valores.push(m[1] ? -valor : valor);
  }
  return valores;
}
