import api from "./axios";
import {
  Product,
  CreateProductPayload,
  UpdateProductPayload,
  Importacion,
  VistaPreviaDeImportacion,
  MapeoDeColumnas,
} from "@/types";

/**
 * Los límites REALES, tal como los aplica el servidor.
 *
 * Estaban escritos a mano aquí —50 MB, 10.000 filas y solo `.xlsx`— y habían
 * dejado de coincidir con lo que el backend acepta: rechazaba CSV en el
 * navegador cuando el servidor ya lo importaba. Un límite duplicado a mano
 * SIEMPRE acaba desviándose, y entonces la pantalla promete una cosa y el
 * servidor hace otra.
 */
export interface LimitesDeImportacion {
  formatos: string[];
  tamañoMaximoMb: number;
  filasMaximas: number;
  /** Lo que de verdad se puede subir: el menor entre producto y proxy. */
  subidaMaximaMb: number;
  limitadoPorElProxy: boolean;
}

export async function getLimitesDeImportacion(): Promise<LimitesDeImportacion> {
  const { data } = await api.get<LimitesDeImportacion>(
    "/products/import/limits",
  );
  return data;
}

/**
 * Aviso rápido en el navegador, con los límites que dijo el servidor.
 *
 * No es la defensa: el backend vuelve a comprobarlo todo. Esto solo evita
 * subir 400 MB para que los rechacen al llegar.
 */
export function validateProductImportFile(
  file: File,
  limites: LimitesDeImportacion,
): string | null {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";

  if (!limites.formatos.includes(ext)) {
    return `Formato no permitido. Usa ${limites.formatos.join(" o ")}.`;
  }
  if (file.size > limites.subidaMaximaMb * 1024 * 1024) {
    return limites.limitadoPorElProxy
      ? `El archivo supera los ${limites.subidaMaximaMb} MB que admite la subida en este servidor.`
      : `El archivo supera el tamaño máximo de ${limites.subidaMaximaMb} MB.`;
  }
  return null;
}

export const PRODUCT_CATEGORIES = [
  "Salas",
  "Comedores",
  "Sillas",
  "Lámparas",
  "Accesorios",
  "Columpios",
  "Asoleadoras",
  "Zonas húmedas",
];

export async function getProducts(filters?: {
  category?: string;
  search?: string;
}): Promise<Product[]> {
  const { data } = await api.get<Product[]>("/products", { params: filters });
  return data;
}

export async function getProduct(id: string): Promise<Product> {
  const { data } = await api.get<Product>(`/products/${id}`);
  return data;
}

export async function createProduct(
  payload: CreateProductPayload,
): Promise<Product> {
  const { data } = await api.post<Product>("/products", payload);
  return data;
}

export async function updateProduct(
  id: string,
  payload: UpdateProductPayload,
): Promise<Product> {
  const { data } = await api.patch<Product>(`/products/${id}`, payload);
  return data;
}

export async function deactivateProduct(id: string): Promise<Product> {
  const { data } = await api.delete<Product>(`/products/${id}`);
  return data;
}

/**
 * Sube el archivo y registra la importación. NO la procesa.
 *
 * El procesamiento va aparte porque tarda minutos: esperar la respuesta dentro
 * de la subida significa que el navegador aguanta hasta que el proxy corta la
 * conexión, y entonces nadie sabe si el trabajo siguió o no.
 */
export async function subirImportacion(file: File): Promise<Importacion> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<Importacion>("/products/import", formData);
  return data;
}

export async function vistaPreviaDeImportacion(
  id: string,
): Promise<VistaPreviaDeImportacion> {
  const { data } = await api.get<VistaPreviaDeImportacion>(
    `/products/import/${id}/preview`,
  );
  return data;
}

export async function fijarMapeoDeImportacion(
  id: string,
  mapeo: MapeoDeColumnas,
): Promise<Importacion> {
  const { data } = await api.post<Importacion>(
    `/products/import/${id}/mapping`,
    { mapeo },
  );
  return data;
}

export async function arrancarImportacion(
  id: string,
): Promise<{ encolada: boolean }> {
  const { data } = await api.post(`/products/import/${id}/start`);
  return data;
}

/** El progreso. Es lo que consulta la pantalla mientras corre. */
export async function estadoDeImportacion(id: string): Promise<Importacion> {
  const { data } = await api.get<Importacion>(`/products/import/${id}`);
  return data;
}

export async function cancelarImportacion(
  id: string,
): Promise<{ estado: string }> {
  const { data } = await api.post(`/products/import/${id}/cancel`);
  return data;
}

/** URL del reporte de errores, en CSV para abrirlo en Excel. */
export function urlDelReporte(id: string): string {
  return `${api.defaults.baseURL ?? ""}/products/import/${id}/report`;
}
