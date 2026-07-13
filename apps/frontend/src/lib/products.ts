import api from './axios';
import {
  Product,
  CreateProductPayload,
  UpdateProductPayload,
  ProductImportSummary,
} from '@/types';

export const MAX_PRODUCT_IMPORT_FILE_SIZE_MB = 50;
export const MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES =
  MAX_PRODUCT_IMPORT_FILE_SIZE_MB * 1024 * 1024;
export const MAX_PRODUCT_IMPORT_ROWS = 10000;

// Frontend-only guardrail so obviously-oversized or wrong-format files fail
// fast, without a round trip — the backend's own checks remain the real
// source of truth and run regardless of this.
export function validateProductImportFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';

  if (ext !== '.xlsx') {
    return 'Formato de archivo no permitido. Usa un archivo .xlsx';
  }
  if (file.size > MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES) {
    return `El archivo supera el tamaño máximo permitido de ${MAX_PRODUCT_IMPORT_FILE_SIZE_MB}MB.`;
  }
  return null;
}

export const PRODUCT_CATEGORIES = [
  'Salas',
  'Comedores',
  'Sillas',
  'Lámparas',
  'Accesorios',
  'Columpios',
  'Asoleadoras',
  'Zonas húmedas',
];

export async function getProducts(filters?: {
  category?: string;
  search?: string;
}): Promise<Product[]> {
  const { data } = await api.get<Product[]>('/products', { params: filters });
  return data;
}

export async function getProduct(id: string): Promise<Product> {
  const { data } = await api.get<Product>(`/products/${id}`);
  return data;
}

export async function createProduct(
  payload: CreateProductPayload,
): Promise<Product> {
  const { data } = await api.post<Product>('/products', payload);
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

export async function importProductsFromExcel(
  file: File,
): Promise<ProductImportSummary> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<ProductImportSummary>(
    '/products/import',
    formData,
  );
  return data;
}
