"use client";

import { useId, useState } from "react";
import { CatalogItemType, Product } from "@/types";
import { effectiveItemType, ITEM_TYPE_LABELS } from "@/lib/tenant-configuration";
import { catalogVocabulary } from "@/lib/tenant-capabilities";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

type ApiError = {
  response?: {
    status?: number;
    data?: {
      message?: string | string[];
      code?: string;
    };
  };
};

export interface ProductFormData {
  /**
   * Producto o Servicio. Ausente cuando el formulario no lo decidió: al editar
   * un elemento cuyo tipo la empresa ya no crea, el tipo no viaja para no
   * cambiarlo sin querer.
   */
  itemType?: CatalogItemType;
  name: string;
  description: string;
  price: string;
  category: string;
  imageUrl: string;
  isActive: boolean;
}

const AMBOS_TIPOS: CatalogItemType[] = ["PRODUCT", "SERVICE"];

interface ProductModalProps {
  product: Product | null;
  /** Categorías de la empresa (sugerencias); el campo admite texto libre. */
  categories?: string[];
  /**
   * Tipos que la empresa puede CREAR (Fase 4). Con uno solo no se pregunta:
   * se usa ese. Por defecto, ambos (lo que admite el servidor sin modelo).
   */
  allowedItemTypes?: CatalogItemType[];
  /** Tipo propuesto al crear. Por defecto el único permitido, o Producto. */
  defaultItemType?: CatalogItemType;
  /** @deprecated Usa `defaultItemType`. Se conserva por compatibilidad. */
  suggestedItemType?: CatalogItemType;
  onClose: () => void;
  onSubmit: (data: ProductFormData) => Promise<void>;
}

/**
 * El motivo que dio el servidor, tal cual. Un 400 del catálogo trae la regla
 * incumplida en español («Esta empresa vende solo servicios…»); sustituirlo
 * por «Ocurrió un error» esconde justo lo que hay que corregir.
 */
function mensajeDelServidor(err: unknown): string {
  const respuesta = (err as ApiError)?.response;
  if (respuesta?.data?.code === "MODULE_DISABLED") {
    return "El catálogo está desactivado para tu empresa. Un administrador puede activarlo en Configuración.";
  }
  const detalle = respuesta?.data?.message;
  const texto = Array.isArray(detalle) ? detalle[0] : detalle;
  if (typeof texto === "string" && texto.trim()) return texto;
  return "No se pudo guardar. Comprueba los datos e inténtalo de nuevo.";
}

export function ProductModal({
  product,
  categories = [],
  allowedItemTypes,
  defaultItemType,
  suggestedItemType,
  onClose,
  onSubmit,
}: ProductModalProps) {
  const isEditing = !!product;
  const categoriesListId = useId();

  const permitidos = allowedItemTypes?.length ? allowedItemTypes : AMBOS_TIPOS;
  const puedeElegir = permitidos.length > 1;
  const propuesto =
    defaultItemType ??
    suggestedItemType ??
    (puedeElegir ? "PRODUCT" : permitidos[0]);
  const tipoInicial = permitidos.includes(propuesto) ? propuesto : permitidos[0];
  const vocabulario = catalogVocabulary({
    allowedItemTypes: permitidos,
    defaultItemType: tipoInicial,
  });

  const originalType = effectiveItemType(product?.itemType);
  // Heredado: de un tipo que la empresa ya no crea. Se conserva y se edita,
  // pero el tipo se muestra como texto y no se manda al guardar.
  const esHeredado = isEditing && !permitidos.includes(originalType);
  const [itemType, setItemType] = useState<CatalogItemType>(
    product ? originalType : tipoInicial,
  );
  // El tipo viaja cuando quien guarda pudo decidirlo (selector visible) o
  // cuando se crea, que es cuando el servidor lo necesita explícito.
  const enviaTipo = !esHeredado && (puedeElegir || !isEditing);

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errorId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        ...(enviaTipo ? { itemType } : {}),
        name,
        description,
        price,
        category,
        imageUrl,
        isActive,
      });
    } catch (err) {
      setError(mensajeDelServidor(err));
    } finally {
      setSaving(false);
    }
  }

  const titulo = isEditing
    ? `Editar ${ITEM_TYPE_LABELS[originalType].toLowerCase()}`
    : vocabulario.mode === "mixed"
      ? "Nuevo elemento del catálogo"
      : vocabulario.newItem;

  return (
    <Modal title={titulo} onClose={onClose} maxWidth="sm">
      <form
        onSubmit={handleSubmit}
        aria-describedby={error ? errorId : undefined}
      >
        {/* Producto o servicio (Fase 2/4). Se pregunta solo cuando la empresa
            crea de los dos; si no, el tipo está decidido y decirlo dos veces
            es ruido. Al crear se propone el tipo por defecto de la empresa,
            pero quien crea lo ve y lo confirma. */}
        {puedeElegir && (
          <fieldset className="mb-3">
            <legend className="mb-1.5 block text-sm font-medium text-neutral-700">
              Tipo de elemento{" "}
              <span aria-hidden="true" className="text-status-error">
                *
              </span>
            </legend>
            <div className="flex gap-2">
              {permitidos.map((t) => (
                <label
                  key={t}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-line-focus ${
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
            {!isEditing && tipoInicial === "SERVICE" && (
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
        )}

        {esHeredado && (
          <div className="mb-3" data-testid="tipo-heredado">
            <p className="mb-1.5 text-sm font-medium text-neutral-700">
              Tipo de elemento
            </p>
            <p className="flex flex-wrap items-center gap-1.5">
              <Badge tone={originalType === "SERVICE" ? "accent" : "info"}>
                {ITEM_TYPE_LABELS[originalType]}
              </Badge>
              <Badge tone="neutral">Heredado</Badge>
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Este {ITEM_TYPE_LABELS[originalType].toLowerCase()} viene de otra
              forma de vender de tu empresa. Se conserva y puedes editarlo, pero
              el tipo no se cambia y no se crean nuevos como este.
            </p>
          </div>
        )}

        <Field label="Nombre" required className="mb-3">
          <Input
            type="text"
            required
            maxLength={300}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Nombre del ${vocabulario.singular}`}
          />
        </Field>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {/* Texto libre con las categorías de LA EMPRESA como sugerencia
              (datalist): así un elemento nunca se ve obligado a encajar en
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
          hint="Opcional. Lo que ayuda a entender qué incluye y en qué condiciones."
          className="mb-3"
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Qué incluye, duración, condiciones, detalles útiles…"
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
          <p id={errorId} role="alert" className="mb-3 text-xs text-status-error">
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
