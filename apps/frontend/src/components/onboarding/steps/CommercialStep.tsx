"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

export interface CommercialState {
  sellsProducts: boolean;
  sellsServices: boolean;
  usesCatalog: boolean;
  usesQuotes: boolean;
  usesTasks: boolean;
  categories: string[];
}

interface CommercialStepProps {
  value: CommercialState;
  onChange: (patch: Partial<CommercialState>) => void;
}

const SUGGESTED_CATEGORIES = [
  "Salas",
  "Comedores",
  "Sillas",
  "Lámparas",
  "Accesorios",
  "Columpios",
  "Asoleadoras",
  "Zonas húmedas",
  "Proyectos personalizados",
];

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-line-default bg-surface-default px-3.5 py-3">
      <span className="text-sm text-content-primary">{label}</span>
      {/* `accent-color` navy: la casilla marcada usa el color de marca en vez
          del azul del sistema, que es de otra familia. */}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-primary"
      />
    </label>
  );
}

export function CommercialStep({ value, onChange }: CommercialStepProps) {
  const [customCategory, setCustomCategory] = useState("");
  const extraCategories = value.categories.filter(
    (c) => !SUGGESTED_CATEGORIES.includes(c),
  );

  function toggleCategory(category: string) {
    if (value.categories.includes(category)) {
      onChange({ categories: value.categories.filter((c) => c !== category) });
    } else {
      onChange({ categories: [...value.categories, category] });
    }
  }

  function addCustomCategory() {
    const trimmed = customCategory.trim();
    if (!trimmed || value.categories.includes(trimmed)) return;
    onChange({ categories: [...value.categories, trimmed] });
    setCustomCategory("");
  }

  // Naranja de FONDO con texto navy: la regla del manual. Al revés —naranja
  // como texto, o blanco sobre naranja— no alcanza el contraste mínimo.
  const chipSeleccionado = "bg-brand-secondary text-brand-primary";
  const chipSuelto =
    "border border-neutral-300 text-content-secondary hover:bg-neutral-50";
  const chipBase =
    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
    "outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1";

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">
        Configuración comercial
      </h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Ayúdanos a entender cómo opera tu empresa.
      </p>

      <div className="mt-6 space-y-2.5">
        <ToggleRow
          label="¿Vende productos?"
          checked={value.sellsProducts}
          onChange={(v) => onChange({ sellsProducts: v })}
        />
        <ToggleRow
          label="¿Vende servicios?"
          checked={value.sellsServices}
          onChange={(v) => onChange({ sellsServices: v })}
        />
        <ToggleRow
          label="¿Maneja catálogo de productos?"
          checked={value.usesCatalog}
          onChange={(v) => onChange({ usesCatalog: v })}
        />
        <ToggleRow
          label="¿Maneja cotizaciones?"
          checked={value.usesQuotes}
          onChange={(v) => onChange({ usesQuotes: v })}
        />
        <ToggleRow
          label="¿Maneja seguimiento comercial por tareas?"
          checked={value.usesTasks}
          onChange={(v) => onChange({ usesTasks: v })}
        />
      </div>

      <div className="mt-6">
        <p className="mb-2 block text-sm font-medium text-neutral-700">
          Categorías principales
        </p>

        {/* `aria-pressed`: el chip es un interruptor, y sin esto su estado
            solo existe como color. */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_CATEGORIES.map((category) => {
            const selected = value.categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleCategory(category)}
                className={`${chipBase} ${selected ? chipSeleccionado : chipSuelto}`}
              >
                {category}
              </button>
            );
          })}
          {extraCategories.map((category) => (
            <button
              key={category}
              type="button"
              aria-label={`Quitar categoría ${category}`}
              onClick={() => toggleCategory(category)}
              className={`${chipBase} ${chipSeleccionado} flex items-center gap-1`}
            >
              {category}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-start gap-2">
          <Field
            label="Categoría personalizada"
            labelOculta
            className="w-full"
          >
            <Input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomCategory();
                }
              }}
              placeholder="Categoría personalizada"
            />
          </Field>
          <Button
            variant="secondary"
            onClick={addCustomCategory}
            className="shrink-0"
          >
            Agregar
          </Button>
        </div>
      </div>
    </div>
  );
}
