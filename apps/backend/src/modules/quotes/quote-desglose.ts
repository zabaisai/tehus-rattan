/**
 * EL DESGLOSE ECONÓMICO DE UNA COTIZACIÓN, DECIDIDO EN UN SOLO SITIO.
 *
 * POR QUÉ EXISTE
 *
 * El total se calculaba bien y se guardaba bien, pero CADA superficie decidía
 * por su cuenta qué filas enseñar: la pantalla una lista, el documento
 * imprimible otra, y el PDF del servidor una tercera que solo tenía subtotal,
 * descuento y total. En staging eso produjo un documento que decía:
 *
 *     Subtotal 400.000 − Descuento 25.000 → TOTAL 487.900
 *
 * Un cliente que sume lo que ve no llega al total. El fallo no estaba en el
 * dinero: estaba en tener tres listas escritas a mano para el mismo documento.
 *
 * QUÉ GARANTIZA
 *
 * Una sola función decide qué conceptos aparecen, en qué orden y con qué
 * signo. El PDF la usa; la pantalla enseña lo mismo porque sigue las mismas
 * reglas, y hay una prueba de paridad que lo comprueba.
 *
 * AQUÍ NO SE CALCULA NADA. Las cifras llegan ya resueltas por el servidor en
 * `Decimal` y redondeadas a la moneda para presentar. Si esta función sumara
 * por su cuenta, tarde o temprano diría algo distinto de la base de datos, que
 * es justo el problema que viene a cerrar.
 */

/** Lo que el servidor ya calculó y persistió. Números para presentar. */
export interface EconomiaDeCotizacion {
  /** Suma de las líneas, YA con sus descuentos de línea aplicados. */
  subtotal: number;
  /** Suma de los descuentos POR LÍNEA. Distinto del descuento general. */
  lineDiscountTotal: number;
  /** Descuento general, como importe. */
  discount: number;
  shipping: number;
  /** Puede ser negativo: es el único concepto que resta libremente. */
  adjustment: number;
  adjustmentLabel?: string | null;
  /** Base sobre la que se calcula el impuesto. */
  taxableBase?: number;
  /** En unidades humanas: 19 significa 19 %. */
  taxRate: number;
  taxTotal: number;
  /** `true` si el precio unitario YA lleva el impuesto dentro. */
  taxIncluded: boolean;
  total: number;
}

export interface FilaDeDesglose {
  etiqueta: string;
  /** Importe CON SIGNO: negativo en lo que resta. */
  valor: number;
  destacada?: boolean;
  /** Informativa: no entra en la suma que reconstruye el total. */
  informativa?: boolean;
}

/**
 * Filas del desglose, en el orden en que se aplican las operaciones.
 *
 * SOLO SE ENSEÑA LO QUE TIENE VALOR. Un «Descuento: 0» invita a preguntar por
 * qué no hay descuento, que es una conversación que nadie quería tener; y una
 * lista con cinco ceros esconde las dos cifras que de verdad importan.
 *
 * LA SUMA DE LAS FILAS NO DESTACADAS NI INFORMATIVAS DA EL TOTAL. Esa es la
 * propiedad que hace que el papel se sostenga, y hay una prueba que la
 * comprueba reconstruyendo la aritmética desde las cifras impresas.
 */
export function filasDeDesglose(e: EconomiaDeCotizacion): FilaDeDesglose[] {
  // SE PARTE DEL BRUTO Y SE RESTA, no del neto.
  //
  // `subtotal` ya lleva descontados los descuentos de línea. Si se enseñara
  // como primera fila y ADEMÁS se restaran esos descuentos, se contarían dos
  // veces; y si se enseñaran como fila que no suma, quien intente cuadrar el
  // papel a mano se encontraría una cifra que sobra. Partir del bruto deja
  // todas las filas sumables, que es lo que hace el documento defendible.
  const bruto = e.subtotal + e.lineDiscountTotal;

  const filas: FilaDeDesglose[] = [
    {
      etiqueta: e.lineDiscountTotal > 0 ? 'Subtotal bruto' : 'Subtotal',
      valor: bruto,
    },
  ];

  if (e.lineDiscountTotal > 0) {
    filas.push({
      etiqueta: 'Descuentos por línea',
      valor: -e.lineDiscountTotal,
    });
  }
  if (e.discount > 0) {
    filas.push({ etiqueta: 'Descuento general', valor: -e.discount });
  }
  if (e.shipping > 0) {
    filas.push({ etiqueta: 'Transporte', valor: e.shipping });
  }
  if (e.adjustment !== 0) {
    filas.push({
      // El concepto del ajuste es lo que lo hace defendible ante un cliente:
      // «Ajuste −15.000» sin más es una cifra que nadie sabe explicar.
      etiqueta: e.adjustmentLabel?.trim() || 'Ajuste',
      valor: e.adjustment,
    });
  }

  if (e.taxRate > 0) {
    if (e.taxIncluded) {
      // CON IMPUESTO INCLUIDO el total NO cambia: el impuesto ya está dentro
      // de los precios. Sumarlo aquí desviaría el papel un 19 % entero, así
      // que la fila es informativa y se dice expresamente en la etiqueta.
      filas.push({
        etiqueta: `IVA ${formatearTasa(e.taxRate)}% incluido en los precios`,
        valor: e.taxTotal,
        informativa: true,
      });
    } else {
      filas.push({
        etiqueta: `IVA ${formatearTasa(e.taxRate)}%`,
        valor: e.taxTotal,
      });
    }
  }

  filas.push({ etiqueta: 'TOTAL', valor: e.total, destacada: true });
  return filas;
}

/** `19` y no `19.00`; `19,5` cuando de verdad tiene decimales. */
function formatearTasa(tasa: number): string {
  return Number.isInteger(tasa) ? String(tasa) : String(tasa).replace('.', ',');
}

/**
 * Comprueba que el desglose CUADRA.
 *
 * Se usa en pruebas y como red en el propio documento: si algún día alguien
 * añade un concepto y olvida incluirlo, esto lo dice en vez de emitir un papel
 * que no se sostiene.
 */
export function desgloseCuadra(filas: FilaDeDesglose[]): boolean {
  const total = filas.find((f) => f.destacada);
  if (!total) return false;
  const suma = filas
    .filter((f) => !f.destacada && !f.informativa)
    .reduce((acc, f) => acc + f.valor, 0);
  // Tolerancia de un céntimo: el redondeo a la moneda puede dejar una
  // diferencia mínima, y fallar por eso sería ruido.
  return Math.abs(suma - total.valor) < 0.01;
}
