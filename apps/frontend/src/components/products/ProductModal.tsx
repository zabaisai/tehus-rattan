"use client";

import { useState } from "react";
import { Product } from "@/types";
import { PRODUCT_CATEGORIES } from "@/lib/products";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

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

export function ProductModal({
  product,
  onClose,
  onSubmit,
}: ProductModalProps) {
  const isEditing = !!product;

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
      title={isEditing ? "Editar producto" : "Nuevo producto"}
      onClose={onClose}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit}>
        <Field label="Nombre" required className="mb-3">
          <Input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sala Primavera"
          />
        </Field>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="Categoría">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Sin categoría</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Precio base" required>
            <Input
              type="number"
              required
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="11700000"
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
            placeholder="Material: Ratán natural. Medidas: Sofá 230x93x63, poltronas 117x93."
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
            Producto activo
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
