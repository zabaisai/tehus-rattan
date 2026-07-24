"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, Pencil, Package, FileSpreadsheet } from "lucide-react";
import {
  getProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
  importProductsFromExcel,
  PRODUCT_CATEGORIES,
} from "@/lib/products";
import { Product, ProductImportSummary } from "@/types";
import { getMyCompany } from "@/lib/companies";
import { ProductModal, ProductFormData } from "@/components/products/ProductModal";
import { ProductImportModal } from "@/components/products/ProductImportModal";
import { EmptyState } from "@/components/ui/EmptyState";

const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products", category],
    queryFn: () => getProducts(category ? { category } : undefined),
  });

  // Heading/subtitle name the logged-in company (never a hardcoded tenant or
  // city). The city line is shown only when the company actually has one.
  const { data: company } = useQuery({ queryKey: ["company-me"], queryFn: getMyCompany });
  const catalogSubtitle = company
    ? `Productos activos de ${company.name}${company.city ? ` · ${company.city}` : ""}`
    : "Productos activos del catálogo";

  const filtered = useMemo(() => {
    if (!products) return [];
    const term = search.toLowerCase();
    if (!term) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.code?.toLowerCase().includes(term) ?? false) ||
        (p.sku?.toLowerCase().includes(term) ?? false),
    );
  }, [products, search]);

  function openCreateModal() {
    setEditingProduct(null);
    setModalOpen(true);
  }

  function openEditModal(product: Product) {
    setEditingProduct(product);
    setModalOpen(true);
  }

  async function handleSubmit(data: ProductFormData) {
    const payload = {
      name: data.name,
      description: data.description || undefined,
      price: Number(data.price),
      category: data.category || undefined,
      imageUrl: data.imageUrl || undefined,
    };

    if (editingProduct) {
      await updateProduct(editingProduct.id, {
        ...payload,
        isActive: data.isActive,
      });
    } else {
      await createProduct(payload);
    }
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    setModalOpen(false);
  }

  async function handleDeactivate(id: string) {
    if (!confirm("¿Desactivar este producto del catálogo?")) return;
    await deactivateProduct(id);
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function handleImport(file: File): Promise<ProductImportSummary> {
    const summary = await importProductsFromExcel(file);
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    return summary;
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Catálogo</h2>
          <p className="text-xs text-stone-500">{catalogSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportModalOpen(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-100 sm:flex-none"
          >
            <FileSpreadsheet size={16} />
            Importar Excel
          </button>
          <button
            onClick={openCreateModal}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800 sm:flex-none"
          >
            <Plus size={16} />
            Nuevo producto
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full flex-1 sm:max-w-xs">
          <Search size={15} className="absolute left-2.5 top-2.5 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar productos"
            className="w-full rounded-md border border-stone-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
          />
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 sm:w-auto"
        >
          <option value="">Todas las categorías</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-stone-400">Cargando catálogo...</p>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Package} message="No hay productos en el catálogo todavía." />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => (
            <div
              key={product.id}
              className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm"
            >
              <div className="flex h-36 items-center justify-center bg-stone-50">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package size={32} strokeWidth={1.5} className="text-stone-300" />
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-stone-900">{product.name}</h3>
                  {!product.isActive && (
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500">
                      Inactivo
                    </span>
                  )}
                </div>

                {product.category && (
                  <span className="w-fit rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {product.category}
                  </span>
                )}

                {product.description && (
                  <p className="line-clamp-2 text-xs text-stone-500">{product.description}</p>
                )}

                <p className="mt-1 text-base font-semibold text-stone-900">
                  {currencyFormatter.format(product.price)}
                </p>

                <div className="mt-auto flex justify-end gap-1 pt-2">
                  <button
                    onClick={() => openEditModal(product)}
                    className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeactivate(product.id)}
                    className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ProductModal
          key={editingProduct?.id ?? "new"}
          product={editingProduct}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {importModalOpen && (
        <ProductImportModal
          onClose={() => setImportModalOpen(false)}
          onImport={handleImport}
        />
      )}
    </div>
  );
}
