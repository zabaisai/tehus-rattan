/**
 * Que columna del archivo alimenta que campo del producto.
 *
 * Se PROPONE por el nombre de la cabecera y lo CONFIRMA una persona tras ver la
 * vista previa. Adivinar y ejecutar sin preguntar es como acaba el precio en el
 * campo del stock, y para cuando alguien lo nota ya hay veinte mil productos
 * mal.
 */

export interface CampoDeProducto {
  campo: string;
  etiqueta: string;
  /** Nombres de cabecera que se reconocen, ya normalizados. */
  alias: string[];
}

export const CAMPOS: CampoDeProducto[] = [
  {
    campo: 'name',
    etiqueta: 'Nombre',
    alias: [
      'nombre',
      'producto',
      'articulo',
      'item',
      'descripcion corta',
      'name',
      'product',
    ],
  },
  {
    campo: 'sku',
    etiqueta: 'SKU',
    alias: ['sku', 'referencia interna', 'sku interno'],
  },
  {
    campo: 'code',
    etiqueta: 'Código',
    alias: ['codigo', 'code', 'referencia', 'ref'],
  },
  {
    campo: 'price',
    etiqueta: 'Precio',
    alias: [
      'precio',
      'valor',
      'precio base',
      'valor unitario',
      'precio unitario',
      'precio venta',
      'venta',
      'price',
    ],
  },
  {
    campo: 'category',
    etiqueta: 'Categoría',
    alias: ['categoria', 'linea', 'tipo', 'familia', 'coleccion', 'category'],
  },
  {
    campo: 'stock',
    etiqueta: 'Stock',
    alias: ['stock', 'cantidad', 'inventario', 'unidades', 'existencias'],
  },
  {
    campo: 'description',
    etiqueta: 'Descripción',
    alias: ['descripcion', 'detalle', 'observaciones', 'notas', 'description'],
  },
];

export interface MapeoDeColumnas {
  /** campo -> indice de columna (0-indexado). */
  campos: Record<string, number>;
  /** Columnas que no se reconocieron, para poder enseñarlas. */
  sinAsignar: Array<{ indice: number; cabecera: string }>;
}

/** Acentos, mayusculas y guiones fuera: «Precio Venta» y «precio_venta» son lo mismo. */
export function normalizar(cabecera: string): string {
  return cabecera
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Propone un mapeo a partir de las cabeceras.
 *
 * Una columna se asigna a UN solo campo: `referencia` es alias de `code` y de
 * `name`, y sin esta regla la misma columna alimentaria los dos, dejando el
 * nombre del producto igual a su codigo.
 */
export function mapearCabeceras(cabeceras: string[]): MapeoDeColumnas {
  const normalizadas = cabeceras.map((c, i) => ({
    indice: i,
    cabecera: c,
    normal: normalizar(c),
  }));

  const usadas = new Set<number>();
  const campos: Record<string, number> = {};

  for (const { campo, alias } of CAMPOS) {
    const encontrada = normalizadas.find(
      (h) => !usadas.has(h.indice) && alias.includes(h.normal),
    );
    if (encontrada) {
      campos[campo] = encontrada.indice;
      usadas.add(encontrada.indice);
    }
  }

  return {
    campos,
    sinAsignar: normalizadas
      .filter((h) => !usadas.has(h.indice) && h.cabecera.trim())
      .map((h) => ({ indice: h.indice, cabecera: h.cabecera })),
  };
}

/**
 * Comprueba un mapeo que llega de fuera.
 *
 * Sin nombre, codigo ni SKU no hay forma de saber que producto es cada fila, y
 * la importacion crearia miles de filas indistinguibles.
 */
export function validarMapeo(
  mapeo: MapeoDeColumnas,
  totalColumnas: number,
): string | null {
  const tieneIdentificador =
    mapeo.campos.name !== undefined ||
    mapeo.campos.code !== undefined ||
    mapeo.campos.sku !== undefined;

  if (!tieneIdentificador) {
    return 'Hay que asignar al menos una columna a Nombre, Código o SKU.';
  }

  const conocidos = new Set(CAMPOS.map((c) => c.campo));
  for (const [campo, indice] of Object.entries(mapeo.campos)) {
    if (!conocidos.has(campo)) return `El campo «${campo}» no existe.`;
    if (!Number.isInteger(indice) || indice < 0 || indice >= totalColumnas) {
      return `La columna asignada a «${campo}» no existe en el archivo.`;
    }
  }

  return null;
}
