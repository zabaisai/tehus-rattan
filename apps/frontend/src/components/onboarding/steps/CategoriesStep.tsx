"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { SuggestionHeader } from "@/components/onboarding/SuggestionHeader";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { hasCategory, normalizeCategoryList } from "@/lib/company-settings";

interface CategoriesStepProps {
  value: string[];
  onChange: (categories: string[]) => void;
  /** Sugerencias de la plantilla elegida (o de la industria). */
  suggestions: string[];
  limits: { maxLength: number; maxCount: number };
  edited: boolean;
  canRestore: boolean;
  onRestore: () => void;
}

/**
 * Categorías del catálogo: sugeridas por la plantilla, editables (marcar,
 * quitar, agregar, renombrar), sin duplicados ni vacíos, con las propias del
 * negocio. Solo aparece cuando el módulo de catálogo está activo.
 */
export function CategoriesStep({
  value,
  onChange,
  suggestions,
  limits,
  edited,
  canRestore,
  onRestore,
}: CategoriesStepProps) {
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [renameError, setRenameError] = useState("");

  const extras = value.filter((c) => !hasCategory(suggestions, c));

  function toggle(category: string) {
    if (hasCategory(value, category)) {
      onChange(value.filter((c) => c.toLocaleLowerCase("es") !== category.toLocaleLowerCase("es")));
    } else {
      onChange([...value, category]);
    }
  }

  function addCustom() {
    const { categories, error } = normalizeCategoryList([custom], limits);
    if (error) {
      setCustomError(error);
      return;
    }
    const candidate = categories[0];
    if (!candidate) {
      setCustomError("Escribe un nombre de categoría.");
      return;
    }
    if (hasCategory(value, candidate)) {
      setCustomError("Esa categoría ya está en la lista.");
      return;
    }
    if (value.length >= limits.maxCount) {
      setCustomError(`Puedes tener como máximo ${limits.maxCount} categorías.`);
      return;
    }
    setCustomError("");
    onChange([...value, candidate]);
    setCustom("");
  }

  function confirmRename() {
    if (!renaming) return;
    const { categories, error } = normalizeCategoryList([renaming.to], limits);
    if (error) {
      setRenameError(error);
      return;
    }
    const next = categories[0];
    if (!next) {
      setRenameError("Escribe un nombre de categoría.");
      return;
    }
    const others = value.filter((c) => c !== renaming.from);
    if (hasCategory(others, next)) {
      setRenameError("Ya existe una categoría con ese nombre.");
      return;
    }
    // Se conserva la posición: renombrar no reordena.
    onChange(value.map((c) => (c === renaming.from ? next : c)));
    setRenaming(null);
    setRenameError("");
  }

  const chipBase =
    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none " +
    "outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1";
  // Naranja de FONDO con texto navy: la regla del manual.
  const chipOn = "bg-brand-secondary text-brand-primary";
  const chipOff = "border border-neutral-300 text-content-secondary hover:bg-neutral-50";

  return (
    <div>
      <SuggestionHeader
        title="Categorías del catálogo"
        description="Sirven para organizar y filtrar tus productos o servicios. Marca las que apliquen, agrega las tuyas o renómbralas."
        edited={edited}
        canRestore={canRestore}
        onRestore={onRestore}
      />

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-neutral-700">
          {suggestions.length > 0 ? "Sugeridas" : "Tus categorías"}
        </p>
        {/* `aria-pressed`: el chip es un interruptor, y sin esto su estado
            solo existe como color. */}
        <div className="flex flex-wrap gap-2">
          {suggestions.map((category) => {
            const selected = hasCategory(value, category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(category)}
                className={`${chipBase} ${selected ? chipOn : chipOff}`}
              >
                {category}
              </button>
            );
          })}
          {extras.map((category) => (
            <button
              key={category}
              type="button"
              aria-label={`Quitar categoría ${category}`}
              onClick={() => toggle(category)}
              className={`${chipBase} ${chipOn} flex items-center gap-1`}
            >
              {category}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          {suggestions.length === 0 && extras.length === 0 && (
            <p className="text-sm text-content-secondary">Aún no hay categorías. Agrega la primera abajo.</p>
          )}
        </div>

        {value.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-sm font-medium text-neutral-700">Tu lista, en orden</p>
            <ol aria-label="Categorías elegidas" className="space-y-1">
              {value.map((category) => (
                <li key={category} className="flex items-center justify-between gap-2 text-sm">
                  {renaming?.from === category ? (
                    <div className="flex w-full flex-col gap-1 sm:flex-row sm:items-start">
                      <Field label={`Nuevo nombre para ${category}`} labelOculta error={renameError} className="w-full">
                        <Input
                          type="text"
                          autoFocus
                          maxLength={limits.maxLength}
                          value={renaming.to}
                          onChange={(e) => {
                            setRenaming({ from: category, to: e.target.value });
                            if (renameError) setRenameError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              confirmRename();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRenaming(null);
                              setRenameError("");
                            }
                          }}
                        />
                      </Field>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" onClick={confirmRename}>
                          Guardar nombre
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => {
                            setRenaming(null);
                            setRenameError("");
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-content-primary">{category}</span>
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label={`Renombrar categoría ${category}`}
                        onClick={() => setRenaming({ from: category, to: category })}
                        className="p-1.5"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2">
          <Field label="Categoría personalizada" labelOculta error={customError} className="w-full">
            <Input
              type="text"
              value={custom}
              maxLength={limits.maxLength}
              onChange={(e) => {
                setCustom(e.target.value);
                if (customError) setCustomError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Categoría personalizada"
            />
          </Field>
          <Button variant="secondary" onClick={addCustom} className="shrink-0">
            Agregar
          </Button>
        </div>
        <p className="mt-2 text-xs text-content-secondary">
          {value.length} de {limits.maxCount} · máximo {limits.maxLength} caracteres por categoría.
        </p>
      </div>
    </div>
  );
}
