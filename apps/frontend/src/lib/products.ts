import api from "./axios";
import {
  Product,
  CreateProductPayload,
  UpdateProductPayload,
  Importacion,
  VistaPreviaDeImportacion,
  MapeoDeColumnas,
} from "@/types";

export const MAX_PRODUCT_IMPORT_FILE_SIZE_MB = 50;
export const MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES =
  MAX_PRODUCT_IMPORT_FILE_SIZE_MB * 1024 * 1024;
export const MAX_PRODUCT_IMPORT_ROWS = 10000;

// Frontend-only guardrail so obviously-oversized or wrong-format files fail
// fast, without a round trip — the backend's own checks remain the real
// source of truth and run regardless of this.
export function validateProductImportFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";

  if (ext !== ".xlsx") {
    return "Formato de archivo no permitido. Usa un archivo .xlsx";
  }
  if (file.size > MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES) {
    return `El archivo supera el tamaño máximo permitido de ${MAX_PRODUCT_IMPORT_FILE_SIZE_MB}MB.`;
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
