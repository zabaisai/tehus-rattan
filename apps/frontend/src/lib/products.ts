import api from './axios';
import {
  Product,
  CreateProductPayload,
  UpdateProductPayload,
  ProductImportSummary,
} from '@/types';

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
