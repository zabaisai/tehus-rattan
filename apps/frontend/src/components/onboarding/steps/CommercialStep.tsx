"use client";

import { useState } from "react";
import { X } from "lucide-react";

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
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-[#0B0F10]/10 bg-white px-3.5 py-3">
      <span className="text-sm text-[#0B0F10]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#A57014]"
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

  return (
    <div>
      <h3 className="text-lg font-semibold text-[#0B0F10]">Configuración comercial</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
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
        <label className="mb-2 block text-xs font-medium text-[#0B0F10]/70">
          Categorías principales
        </label>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_CATEGORIES.map((category) => {
            const selected = value.categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleCategory(category)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? "bg-[#A57014] text-white"
                    : "border border-[#0B0F10]/15 text-[#0B0F10]/70 hover:bg-[#F4EFE6]"
                }`}
              >
                {category}
              </button>
            );
          })}
          {extraCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => toggleCategory(category)}
              className="flex items-center gap-1 rounded-full bg-[#A57014] px-3 py-1.5 text-xs font-medium text-white"
            >
              {category}
              <X size={12} />
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
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
            className="w-full rounded-md border border-[#0B0F10]/15 px-3 py-2 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]"
          />
          <button
            type="button"
            onClick={addCustomCategory}
            className="shrink-0 rounded-md border border-[#0B0F10]/15 px-3 py-2 text-sm text-[#0B0F10] hover:bg-[#F4EFE6]"
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
