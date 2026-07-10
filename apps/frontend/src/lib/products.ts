import api from './axios';
import { Product, CreateProductPayload, UpdateProductPayload } from '@/types';

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
