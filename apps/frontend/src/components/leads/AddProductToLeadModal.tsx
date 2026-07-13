'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Search, Package } from 'lucide-react';
import { getProducts, PRODUCT_CATEGORIES } from '@/lib/products';
import { AddLeadProductPayload } from '@/types';

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Agregar producto</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>

        {isLoading && <p className="text-sm text-stone-400">Cargando catálogo...</p>}

        {noProductsAtAll && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-stone-300 py-8 text-center text-stone-400">
            <Package size={24} strokeWidth={1.5} />
            <p className="text-sm">Primero crea o importa productos en el catálogo.</p>
          </div>
        )}

        {!isLoading && !noProductsAtAll && (
          <form onSubmit={handleSubmit}>
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-stone-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto"
                  className="w-full rounded-md border border-stone-300 py-2 pl-7 pr-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                />
              </div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Todas</option>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 max-h-40 overflow-y-auto rounded-md border border-stone-200">
              {filtered.length === 0 && (
                <p className="p-3 text-xs text-stone-400">Sin resultados.</p>
              )}
              {filtered.map((product) => (
                <label
                  key={product.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 border-b border-stone-100 px-3 py-2 text-sm last:border-b-0 hover:bg-stone-50 ${
                    selectedProductId === product.id ? 'bg-amber-50' : ''
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
                    <span className="text-stone-800">{product.name}</span>
                  </span>
                  <span className="text-xs text-stone-500">
                    {currencyFormatter.format(product.price)}
                  </span>
                </label>
              ))}
            </div>

            {selectedProduct && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-600">
                      Cantidad
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-600">
                      Precio unitario
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-stone-600">
                    Notas (opcional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Color, acabado, condiciones..."
                    className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                  />
                </div>
              </>
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
                disabled={saving || !selectedProductId}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {saving ? 'Agregando...' : 'Agregar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
