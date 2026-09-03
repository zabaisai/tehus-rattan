'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Package } from 'lucide-react';
import { getProducts } from '@/lib/products';
import { useCompanySettings } from '@/lib/company-settings';
import { AddLeadProductPayload } from '@/types';
import { Modal } from '@/components/ui/Modal';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

interface AddProductToLeadModalProps {
  onClose: () => void;
  onAdd: (payload: AddLeadProductPayload) => Promise<void>;
}

export function AddProductToLeadModal({ onClose, onAdd }: AddProductToLeadModalProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', category],
    queryFn: () => getProducts(category ? { category } : undefined),
  });

  const filtered = useMemo(() => {
    if (!products) return [];
    const term = search.toLowerCase();
    if (!term) return products;
    return products.filter((p) => p.name.toLowerCase().includes(term));
  }, [products, search]);

  // Categorías de LA EMPRESA más las que ya usan sus productos: nunca una
  // lista fija de la plataforma.
  const { data: settings } = useCompanySettings();
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [
      ...(settings?.catalog.categories ?? []),
      ...(products ?? []).map((p) => p.category ?? ''),
    ]) {
      const value = c.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase('es');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }, [settings, products]);

  const selectedProduct = products?.find((p) => p.id === selectedProductId) ?? null;

  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    const product = products?.find((p) => p.id === productId);
    setUnitPrice(product ? String(product.price) : '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductId) {
      setError('Selecciona un producto del catálogo');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onAdd({
        productId: selectedProductId,
        quantity: quantity ? Number(quantity) : undefined,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
        notes: notes.trim() || undefined,
      });
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'Ocurrió un error');
    } finally {
      setSaving(false);
    }
  }

  const noProductsAtAll = !isLoading && (products?.length ?? 0) === 0;

  return (
    <Modal title="Agregar producto" onClose={onClose} maxWidth="md" stackedZIndex>
        {isLoading && <p className="text-sm text-neutral-400">Cargando catálogo...</p>}

        {noProductsAtAll && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 py-8 text-center text-neutral-400">
            <Package size={24} strokeWidth={1.5} />
            <p className="text-sm">Primero crea o importa productos en el catálogo.</p>
          </div>
        )}

        {!isLoading && !noProductsAtAll && (
          <form onSubmit={handleSubmit}>
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto"
                  className="w-full rounded-md border border-neutral-300 py-2 pl-7 pr-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
              </div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              >
                <option value="">Todas</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 max-h-40 overflow-y-auto rounded-md border border-neutral-200">
              {filtered.length === 0 && (
                <p className="p-3 text-xs text-neutral-400">Sin resultados.</p>
              )}
              {filtered.map((product) => (
                <label
                  key={product.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 text-sm last:border-b-0 hover:bg-neutral-50 ${
                    selectedProductId === product.id ? 'bg-status-warning-surface' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="product"
                      checked={selectedProductId === product.id}
                      onChange={() => selectProduct(product.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-neutral-800">{product.name}</span>
                  </span>
                  <span className="text-xs text-neutral-500">
                    {currencyFormatter.format(product.price)}
                  </span>
                </label>
              ))}
            </div>

            {selectedProduct && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-600">
                      Cantidad
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-600">
                      Precio unitario
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    Notas (opcional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Color, acabado, condiciones..."
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                  />
                </div>
              </>
            )}

            {error && <p className="mb-3 text-xs text-status-error">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || !selectedProductId}
                className="rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white hover:bg-primary-900 disabled:opacity-50"
              >
                {saving ? 'Agregando...' : 'Agregar'}
              </button>
            </div>
          </form>
        )}
    </Modal>
  );
}
