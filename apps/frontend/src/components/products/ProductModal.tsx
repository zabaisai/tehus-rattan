'use client';

import { useState } from 'react';
import { Product } from '@/types';
import { PRODUCT_CATEGORIES } from '@/lib/products';
import { Modal } from '@/components/ui/Modal';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

export interface ProductFormData {
  name: string;
  description: string;
  price: string;
  category: string;
  imageUrl: string;
  isActive: boolean;
}

interface ProductModalProps {
  product: Product | null;
  onClose: () => void;
  onSubmit: (data: ProductFormData) => Promise<void>;
}

export function ProductModal({ product, onClose, onSubmit }: ProductModalProps) {
  const isEditing = !!product;

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? '');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({ name, description, price, category, imageUrl, isActive });
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'Ocurrió un error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEditing ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} maxWidth="sm">
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Nombre
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sala Primavera"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Categoría
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Sin categoría</option>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Precio base
              </label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="11700000"
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Material: Ratán natural. Medidas: Sofá 230x93x63, poltronas 117x93."
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
            <p className="mt-1 text-[11px] text-stone-400">
              Incluye material y medidas como parte de la descripción.
            </p>
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Imagen (URL)
            </label>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          {isEditing && (
            <label className="mb-4 flex items-center gap-2 text-xs font-medium text-stone-600">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-stone-300"
              />
              Producto activo
            </label>
          )}

          {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
    </Modal>
  );
}
