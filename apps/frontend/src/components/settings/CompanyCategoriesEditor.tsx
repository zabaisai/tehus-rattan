"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import {
  COMPANY_SETTINGS_QUERY_KEY,
  DEFAULT_CATEGORY_LIMITS,
  hasCategory,
  normalizeCategoryList,
  updateMyCompanySettings,
  useCompanySettings,
} from "@/lib/company-settings";
import { TENANT_CONFIGURATION_QUERY_KEY } from "@/lib/tenant-configuration";

type ApiError = {
  response?: { status?: number; data?: { message?: string | string[] } };
};

function mapError(err: unknown): string {
  const response = (err as ApiError).response;
  const message = response?.data?.message;
  const readable = Array.isArray(message) ? message[0] : message;
  if (response?.status === 401 || response?.status === 403) {
    return "Tu sesión expiró o no tienes permiso para esta acción.";
  }
  return readable || "No se pudieron guardar las categorías. Intenta de nuevo.";
}

/**
 * Categorías del catálogo de LA EMPRESA. Es lo que el onboarding guardó (o lo
 * que la empresa haya definido después) y lo que leen el filtro y el selector
 * del catálogo. Sin duplicados, sin vacíos, con los límites del servidor.
 */
export function CompanyCategoriesEditor() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isError } = useCompanySettings();
  const limits = settings?.limits.categories ?? DEFAULT_CATEGORY_LIMITS;

  // El borrador arranca desde lo guardado y solo se reinicia cuando llega
  // una versión nueva del servidor (tras guardar), nunca mientras se edita.
  // Se ajusta EN EL RENDER y no en un efecto: un efecto con setState provoca
  // un segundo render en cascada; este es el patrón que React documenta para
  // derivar estado de una prop que cambia.
  const [synced, setSynced] = useState<{
    source: string[] | null;
    draft: string[];
  }>({ source: null, draft: [] });
  const serverCategories = settings?.catalog.categories ?? null;
  if (serverCategories && serverCategories !== synced.source) {
    setSynced({ source: serverCategories, draft: serverCategories });
  }
  const setDraft = (draft: string[]) => setSynced((s) => ({ ...s, draft }));

  const [custom, setCustom] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const list = synced.draft;
  const dirty =
    settings !== undefined &&
    JSON.stringify(list) !== JSON.stringify(settings.catalog.categories);

  function add() {
    const { categories, error: normError } = normalizeCategoryList([custom], limits);
    if (normError) {
      setFieldError(normError);
      return;
    }
    const candidate = categories[0];
    if (!candidate) {
      setFieldError("Escribe un nombre de categoría.");
      return;
    }
    if (hasCategory(list, candidate)) {
      setFieldError("Esa categoría ya está en la lista.");
      return;
    }
    if (list.length >= limits.maxCount) {
      setFieldError(`Puedes tener como máximo ${limits.maxCount} categorías.`);
      return;
    }
    setFieldError("");
    setDraft([...list, candidate]);
    setCustom("");
    setSuccess("");
  }

  function remove(category: string) {
    setDraft(list.filter((c) => c !== category));
    setSuccess("");
  }

  async function save() {
    setError("");
    setSuccess("");
    const { categories, error: normError } = normalizeCategoryList(list, limits);
    if (normError) {
      setError(normError);
      return;
    }
    setSaving(true);
    try {
      await updateMyCompanySettings({ catalog: { categories } });
      await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
      // El contrato agregado también lleva las categorías.
      await queryClient.invalidateQueries({ queryKey: TENANT_CONFIGURATION_QUERY_KEY });
      setSuccess("Categorías guardadas.");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h3 className="mb-1 text-sm font-semibold text-neutral-800">
        Categorías del catálogo
      </h3>
      <p className="mb-4 text-xs text-neutral-400">
        Organizan y filtran tus productos o servicios. Los productos ya
        creados conservan su categoría aunque la quites de esta lista.
      </p>

      {isLoading && <p className="text-sm text-neutral-400">Cargando...</p>}
      {isError && (
        <p className="text-sm text-status-error">
          No se pudo cargar la configuración del catálogo.
        </p>
      )}

      {settings && (
        <>
          <ul className="flex flex-wrap gap-2" aria-label="Categorías actuales">
            {list.map((category) => (
              <li key={category}>
                <span className="flex items-center gap-1 rounded-full bg-brand-secondary px-3 py-1.5 text-xs font-medium text-brand-primary">
                  {category}
                  <button
                    type="button"
                    onClick={() => remove(category)}
                    aria-label={`Quitar categoría ${category}`}
                    className="rounded outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
            {list.length === 0 && (
              <li className="text-sm text-neutral-500">
                Sin categorías. El catálogo acepta cualquier texto igualmente.
              </li>
            )}
          </ul>

          <div className="mt-3 flex items-start gap-2">
            <Field label="Nueva categoría" labelOculta error={fieldError} className="w-full">
              <Input
                type="text"
                value={custom}
                maxLength={limits.maxLength}
                onChange={(e) => {
                  setCustom(e.target.value);
                  if (fieldError) setFieldError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder="Nueva categoría"
              />
            </Field>
            <Button variant="secondary" onClick={add} className="shrink-0">
              Agregar
            </Button>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            {list.length} de {limits.maxCount} · máximo {limits.maxLength} caracteres.
          </p>

          {error && <p className="mt-3 text-xs text-status-error">{error}</p>}
          {success && (
            <p role="status" className="mt-3 text-xs text-status-success-strong">
              {success}
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? "Guardando..." : "Guardar categorías"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
