"use client";

import { Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  Package,
  FileSpreadsheet,
} from "lucide-react";
import {
  getProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
} from "@/lib/products";
import { CatalogItemType, Product } from "@/types";
import { getMyCompany } from "@/lib/companies";
import { useCompanySettings } from "@/lib/company-settings";
import {
  effectiveItemType,
  ITEM_TYPE_LABELS,
  suggestedItemType,
  useTenantConfiguration,
} from "@/lib/tenant-configuration";
import {
  catalogVocabulary,
  isLegacyItemType,
  useTenantCapabilities,
} from "@/lib/tenant-capabilities";
import { RequireTenantCapability } from "@/components/capabilities/RequireTenantCapability";
import {
  ProductModal,
  ProductFormData,
} from "@/components/products/ProductModal";
import { ProductImportModal } from "@/components/products/ProductImportModal";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useFormatoDeDinero } from "@/lib/use-formato-de-dinero";

/**
 * Elementos de un tipo que la empresa YA NO CREA (Fase 4): se conservan y se
 * editan, pero el formulario no ofrece crear otro igual. La frase es una, y
 * la misma que lee quien mira la lista y quien abre la ficha.
 */
export const NOTA_HEREDADOS =
  "Elementos heredados de otra forma de vender: se conservan y se pueden editar, pero no se crean nuevos.";

function capitalizar(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

function ProductsPageContent() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [itemType, setItemType] = useState<"" | CatalogItemType>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const parametros = useSearchParams();
  const idPorUrl = parametros.get("abrir");
  const [urlAplicada, setUrlAplicada] = useState<string | null>(null);

  // El filtro por tipo es del SERVIDOR (`?itemType=`): PRODUCT incluye los
  // elementos anteriores a la Fase 2 que aún no tienen tipo guardado.
  const { data: products, isLoading } = useQuery({
    queryKey: ["products", category, itemType],
    queryFn: () =>
      getProducts(
        category || itemType
          ? {
              ...(category ? { category } : {}),
              ...(itemType ? { itemType } : {}),
            }
          : undefined,
      ),
  });

  // Qué puede CREAR esta empresa (Fase 4): solo productos, solo servicios o
  // ambos. Decide el vocabulario de toda la pantalla y qué ofrece el
  // formulario. Mientras no se conoce, se habla en neutro («Catálogo») y se
  // ofrecen ambos tipos, que es lo que el servidor admite por defecto.
  const capacidades = useTenantCapabilities();
  const { formatear: dinero } = useFormatoDeDinero();
  const vocabulario = catalogVocabulary(capacidades.catalog);
  const reglasCatalogo = capacidades.catalog;

  // Respaldo para una configuración sin reglas de catálogo: el tipo que se
  // PROPONE al crear (Servicio solo si la empresa vende exclusivamente
  // servicios). Es una sugerencia que el usuario confirma.
  const { data: configuration } = useTenantConfiguration();
  const tipoPropuesto =
    reglasCatalogo?.defaultItemType ?? suggestedItemType(configuration);

  // Heading/subtitle name the logged-in company (never a hardcoded tenant or
  // city). The city line is shown only when the company actually has one.
  const { data: company } = useQuery({
    queryKey: ["company-me"],
    queryFn: getMyCompany,
  });

  // Categorías DE ESTA EMPRESA (Company.settings, v1 o v2), no una lista
  // fija de la plataforma. Se les suman las que ya usan sus productos, para
  // que nada creado antes deje de poder filtrarse.
  const { data: settings } = useCompanySettings();
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [
      ...(settings?.catalog.categories ?? []),
      ...(products ?? []).map((p) => p.category ?? ""),
    ]) {
      const value = c.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase("es");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }, [settings, products]);
  const sujeto =
    vocabulario.mode === "mixed"
      ? "Productos y servicios"
      : capitalizar(vocabulario.plural);
  const catalogSubtitle = company
    ? `${sujeto} activos de ${company.name}${company.city ? ` · ${company.city}` : ""}`
    : `${sujeto} activos del catálogo`;

  // Enlace profundo desde la busqueda global: `?abrir=<id>` abre la ficha de
  // ese producto. Solo abre si el id existe de verdad: un producto borrado
  // deja enlaces vivos por ahi, y un modal vacio seria peor que no abrir nada.
  //
  // Se ajusta en el RENDER y no en un efecto. Un efecto que llama a `setState`
  // provoca un segundo render en cascada -y el modal aparecería un fotograma
  // tarde-; este es el patron que React documenta para reaccionar a un cambio
  // de entrada. `urlAplicada` hace que ocurra una sola vez, de modo que cerrar
  // el modal no lo reabra mientras el parametro siga en la URL.
  const productoPorUrl =
    idPorUrl && products
      ? (products.find((p) => p.id === idPorUrl) ?? null)
      : null;
  if (productoPorUrl && urlAplicada !== idPorUrl) {
    setUrlAplicada(idPorUrl);
    setEditingProduct(productoPorUrl);
    setModalOpen(true);
  }

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

  const esHeredado = (product: Product) =>
    isLegacyItemType(reglasCatalogo, effectiveItemType(product.itemType));
  const hayHeredados = filtered.some(esHeredado);
  const hayFiltros = Boolean(search || category || itemType);

  function openCreateModal() {
    setEditingProduct(null);
    setModalOpen(true);
  }

  function openEditModal(product: Product) {
    setEditingProduct(product);
    setModalOpen(true);
  }

  async function handleSubmit(data: ProductFormData) {
    // `itemType` solo viaja cuando el formulario lo decidió: al editar un
    // elemento heredado no se manda, para no cambiarlo sin querer ni chocar
    // con la regla del servidor.
    const payload = {
      ...(data.itemType ? { itemType: data.itemType } : {}),
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
    if (!confirm(`¿Retirar este ${vocabulario.singular} del catálogo?`)) return;
    await deactivateProduct(id);
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function refrescarCatalogo() {
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {vocabulario.title}
          </h2>
          <p className="text-xs text-neutral-500">{catalogSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportModalOpen(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 sm:flex-none"
          >
            <FileSpreadsheet size={16} />
            Importar Excel
          </button>
          <button
            onClick={openCreateModal}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm text-white hover:bg-primary-900 sm:flex-none"
          >
            <Plus size={16} />
            {vocabulario.newItem}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Etiqueta oculta y no solo `placeholder`: el marcador desaparece al
            escribir y no es un nombre accesible. */}
        <Field
          label="Buscar en el catálogo"
          labelOculta
          className="relative w-full flex-1 sm:max-w-xs"
        >
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-2.5 z-10 text-neutral-400"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en el catálogo"
            className="pl-8"
          />
        </Field>

        <Field label="Filtrar por categoría" labelOculta className="w-full sm:w-auto">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        {/* El filtro por tipo solo tiene sentido si la empresa crea de los
            dos; con uno solo, los heredados se ven igual en la lista. */}
        {vocabulario.showTypeChooser && (
          <Field label="Filtrar por tipo" labelOculta className="w-full sm:w-auto">
            <Select
              value={itemType}
              onChange={(e) =>
                setItemType(e.target.value as "" | CatalogItemType)
              }
            >
              <option value="">Productos y servicios</option>
              <option value="PRODUCT">Solo productos</option>
              <option value="SERVICE">Solo servicios</option>
            </Select>
          </Field>
        )}
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-neutral-400">
          Cargando catálogo...
        </p>
      )}

      {!isLoading && filtered.length === 0 && hayFiltros && (
        <EmptyState
          icon={Package}
          message={`Ningún ${vocabulario.singular} coincide con la búsqueda.`}
        />
      )}

      {!isLoading && filtered.length === 0 && !hayFiltros && (
        <EmptyState
          icon={Package}
          message={vocabulario.emptyTitle}
          action={
            <p className="max-w-sm text-center text-xs text-neutral-400">
              {vocabulario.emptyHint}
            </p>
          }
        />
      )}

      {!isLoading && hayHeredados && (
        <p className="mb-3 text-xs text-neutral-500" data-testid="nota-heredados">
          {NOTA_HEREDADOS}
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => (
            <div
              key={product.id}
              className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
            >
              <div className="flex h-36 items-center justify-center bg-neutral-50">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package
                    size={32}
                    strokeWidth={1.5}
                    className="text-neutral-300"
                  />
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-neutral-900">
                    {product.name}
                  </h3>
                  {!product.isActive && (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                      Inactivo
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Producto o servicio; un elemento anterior a la Fase 2
                      sin tipo guardado se muestra como Producto. */}
                  <Badge
                    tone={
                      effectiveItemType(product.itemType) === "SERVICE"
                        ? "accent"
                        : "info"
                    }
                  >
                    {ITEM_TYPE_LABELS[effectiveItemType(product.itemType)]}
                  </Badge>
                  {/* De un tipo que la empresa ya no crea: se dice con
                      texto, no con un color que nadie sabe leer. */}
                  {esHeredado(product) && (
                    <Badge tone="neutral" title={NOTA_HEREDADOS}>
                      Heredado
                    </Badge>
                  )}
                  {product.category && (
                    <span className="w-fit rounded-full bg-status-warning-surface px-2 py-0.5 text-[10px] font-medium text-status-warning-strong">
                      {product.category}
                    </span>
                  )}
                </div>

                {product.description && (
                  <p className="line-clamp-2 text-xs text-neutral-500">
                    {product.description}
                  </p>
                )}

                <p className="mt-1 text-base font-semibold text-neutral-900">
                  {dinero(product.price)}
                </p>

                {/*
                  Los dos son iconos sin texto. Sin `aria-label`, un lector de
                  pantalla los anuncia como «botón» y «botón», así que quien
                  navega sin ver no puede saber cuál edita y cuál retira: son
                  dos acciones muy distintas para adivinarlas. El nombre lleva
                  el producto para que se distingan también entre tarjetas.
                */}
                <div className="mt-auto flex justify-end gap-1 pt-2">
                  <button
                    onClick={() => openEditModal(product)}
                    aria-label={`Editar ${product.name}`}
                    title="Editar"
                    className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeactivate(product.id)}
                    aria-label={`Retirar ${product.name} del catálogo`}
                    title="Retirar del catálogo"
                    className="rounded p-1.5 text-neutral-400 hover:bg-status-error-surface hover:text-status-error"
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
          categories={categoryOptions}
          allowedItemTypes={reglasCatalogo?.allowedItemTypes}
          defaultItemType={tipoPropuesto}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {importModalOpen && (
        <ProductImportModal
          onClose={() => setImportModalOpen(false)}
          onFinished={() => void refrescarCatalogo()}
        />
      )}
    </div>
  );
}

/**
 * `useSearchParams` obliga a un limite de Suspense para que la pagina pueda
 * prerenderizarse. Mismo patron que cotizaciones y conversaciones.
 */
export default function ProductsPage() {
  return (
    <RequireTenantCapability capability="catalog">
      <Suspense
        fallback={
          <p className="py-10 text-center text-sm text-neutral-400">Cargando...</p>
        }
      >
        <ProductsPageContent />
      </Suspense>
    </RequireTenantCapability>
  );
}
