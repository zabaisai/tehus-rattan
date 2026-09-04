"use client";

import { useId, useState } from "react";
import { CatalogItemType, Product } from "@/types";
import { effectiveItemType, ITEM_TYPE_LABELS } from "@/lib/tenant-configuration";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

export interface ProductFormData {
  /** Obligatorio: Producto o Servicio. */
  itemType: CatalogItemType;
  name: string;
  description: string;
  price: string;
  category: string;
  imageUrl: string;
  isActive: boolean;
}

interface ProductModalProps {
  product: Product | null;
  /** Categorías de la empresa (sugerencias); el campo admite texto libre. */
  categories?: string[];
  /**
   * Tipo PROPUESTO al crear: Servicio solo si la empresa vende exclusivamente
   * servicios; Producto en cualquier otro caso. Se muestra y se confirma; el
   * backend sigue mandando.
   */
  suggestedItemType?: CatalogItemType;
  onClose: () => void;
  onSubmit: (data: ProductFormData) => Promise<void>;
}

export function ProductModal({
  product,
  categories = [],
  suggestedItemType = "PRODUCT",
  onClose,
  onSubmit,
}: ProductModalProps) {
  const isEditing = !!product;
  const categoriesListId = useId();
  const originalType = effectiveItemType(product?.itemType);
  const [itemType, setItemType] = useState<CatalogItemType>(
    product ? originalType : suggestedItemType,
  );

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        itemType,
        name,
        description,
        price,
        category,
        imageUrl,
        isActive,
      });
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || "Ocurrió un error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={
        isEditing
          ? `Editar ${ITEM_TYPE_LABELS[originalType].toLowerCase()}`
          : "Nuevo elemento del catálogo"
      }
      onClose={onClose}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit}>
        {/* Producto o servicio (Fase 2). Obligatorio y visible: al crear se
            propone según el modelo comercial de la empresa, pero quien crea
            lo ve y lo confirma. */}
        <fieldset className="mb-3">
          <legend className="mb-1.5 block text-sm font-medium text-neutral-700">
            Tipo de elemento{" "}
            <span aria-hidden="true" className="text-status-error">
              *
            </span>
          </legend>
          <div className="flex gap-2">
            {(["PRODUCT", "SERVICE"] as const).map((t) => (
              <label
                key={t}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  itemType === t
                    ? "border-brand-primary bg-brand-secondary text-brand-primary"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <input
                  type="radio"
                  name="itemType"
                  value={t}
                  required
                  checked={itemType === t}
                  onChange={() => setItemType(t)}
                  className="h-3.5 w-3.5 accent-brand-primary"
                />
                {ITEM_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
          {!isEditing && suggestedItemType === "SERVICE" && (
            <p className="mt-1 text-xs text-neutral-500">
              Tu empresa vende solo servicios, así que se propone «Servicio».
              Puedes cambiarlo.
            </p>
          )}
          {isEditing && (
            <p className="mt-1 text-xs text-neutral-400">
              Cambiar el tipo no borra el precio, el stock ni el SKU.
            </p>
          )}
        </fieldset>

        <Field label="Nombre" required className="mb-3">
          <Input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del producto o servicio"
          />
        </Field>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {/* Texto libre con las categorías de LA EMPRESA como sugerencia
              (datalist): así un producto nunca se ve obligado a encajar en
              una lista fija de la plataforma. */}
          <Field label="Categoría" hint="Opcional. Elige una o escribe una nueva.">
            <Input
              type="text"
              list={categoriesListId}
              value={category}
              maxLength={60}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Sin categoría"
            />
            <datalist id={categoriesListId}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Precio base" required>
            <Input
              type="number"
              required
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <Field
          label="Descripción"
          hint="Incluye material y medidas como parte de la descripción."
          className="mb-3"
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Detalles que ayudan a vender: material, medidas, duración, incluye…"
          />
        </Field>

        <Field label="Imagen (URL)" className="mb-3">
          <Input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
          />
        </Field>

        {isEditing && (
          <label className="mb-4 flex items-center gap-2 text-xs font-medium text-neutral-600">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-neutral-300 accent-brand-primary"
            />
            Activo en el catálogo
          </label>
        )}

        {error && (
          <p role="alert" className="mb-3 text-xs text-status-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose} className="px-3 py-1.5">
            Cancelar
          </Button>
          <Button type="submit" disabled={saving} className="px-3 py-1.5">
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
