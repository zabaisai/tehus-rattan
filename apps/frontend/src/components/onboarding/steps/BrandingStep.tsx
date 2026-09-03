"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Upload, X } from "lucide-react";
import { validateLogoFile } from "@/lib/onboarding";
import { displayColor, PLATFORM_BRAND } from "@/lib/brand";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/**
 * Colores DE LA EMPRESA. Empiezan VACÍOS a propósito: la apariencia inicial
 * de una empresa nueva es la neutral de TAKTO, y solo se guarda un color si la
 * empresa lo elige. Antes venían pre-rellenados con los colores de un tenant
 * concreto, que así se colaban como valor por defecto de todo el mundo.
 */
export interface BrandingColorState {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
}

export const EMPTY_BRANDING_COLORS: BrandingColorState = {
  primaryColor: "",
  accentColor: "",
  backgroundColor: "",
};

interface BrandingStepProps {
  colors: BrandingColorState;
  onColorsChange: (patch: Partial<BrandingColorState>) => void;
  logoFile: File | null;
  onLogoChange: (file: File | null) => void;
  secondaryLogoFile: File | null;
  onSecondaryLogoChange: (file: File | null) => void;
}

function useObjectUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}

function LogoPicker({
  label,
  preview,
  onSelect,
  onClear,
  error,
}: {
  label: string;
  preview: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  error: string;
}) {
  const idError = useId();

  return (
    <div>
      {/* La etiqueta envuelve al `<input type="file">`, así que nombra al
          control sin necesitar `htmlFor`. El foco visible es imprescindible
          aquí: el input real está oculto y sin anillo no hay forma de saber
          por teclado que la zona está seleccionada. */}
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-subtle px-4 text-center transition-colors hover:bg-neutral-100 focus-within:ring-2 focus-within:ring-line-focus focus-within:ring-offset-1">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-20 w-20 rounded object-contain" />
        ) : (
          <>
            <Upload size={18} aria-hidden="true" className="text-content-disabled" />
            <span className="text-xs text-content-secondary">
              PNG, JPG o WEBP · máx. 2MB
            </span>
          </>
        )}
        <input
          type="file"
          aria-label={label}
          aria-describedby={error ? idError : undefined}
          aria-invalid={error ? true : undefined}
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSelect(file);
            e.target.value = "";
          }}
        />
      </label>
      {preview && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1.5 flex items-center gap-1 rounded text-xs text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
        >
          <X size={12} aria-hidden="true" /> Quitar
        </button>
      )}
      {error && (
        <p
          id={idError}
          role="alert"
          className="mt-1.5 text-xs font-medium text-status-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function ColorPicker({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  const idMuestra = useId();

  return (
    <div>
      <label
        htmlFor={idMuestra}
        className="mb-1.5 block text-sm font-medium text-neutral-700"
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* La muestra necesita SIEMPRE un valor; cuando la empresa no ha
            elegido nada se enseña el neutro de la plataforma, pero el estado
            sigue vacío y no se envía. */}
        <input
          id={idMuestra}
          type="color"
          value={displayColor(value, fallback)}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-neutral-300 bg-transparent p-0.5"
        />
        <Field label={`${label} en hexadecimal`} labelOculta className="w-full">
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Sin definir"
          />
        </Field>
      </div>
    </div>
  );
}

export function BrandingStep({
  colors,
  onColorsChange,
  logoFile,
  onLogoChange,
  secondaryLogoFile,
  onSecondaryLogoChange,
}: BrandingStepProps) {
  const logoPreview = useObjectUrl(logoFile);
  const secondaryPreview = useObjectUrl(secondaryLogoFile);
  const [logoError, setLogoError] = useState("");
  const [secondaryError, setSecondaryError] = useState("");

  function handleLogoSelect(file: File) {
    const error = validateLogoFile(file);
    if (error) {
      setLogoError(error);
      return;
    }
    setLogoError("");
    onLogoChange(file);
  }

  function handleSecondarySelect(file: File) {
    const error = validateLogoFile(file);
    if (error) {
      setSecondaryError(error);
      return;
    }
    setSecondaryError("");
    onSecondaryLogoChange(file);
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary">Branding</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Este paso es opcional. Si no eliges nada, tu empresa empieza con la
        apariencia neutral de TAKTO y podrás personalizarla después en
        Configuración → Empresa.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <LogoPicker
          label="Logo principal"
          preview={logoPreview}
          onSelect={handleLogoSelect}
          onClear={() => {
            onLogoChange(null);
            setLogoError("");
          }}
          error={logoError}
        />
        <LogoPicker
          label="Logo secundario (opcional)"
          preview={secondaryPreview}
          onSelect={handleSecondarySelect}
          onClear={() => {
            onSecondaryLogoChange(null);
            setSecondaryError("");
          }}
          error={secondaryError}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ColorPicker
          label="Color principal"
          value={colors.primaryColor}
          fallback={PLATFORM_BRAND.primaryColor}
          onChange={(v) => onColorsChange({ primaryColor: v })}
        />
        <ColorPicker
          label="Color de acento"
          value={colors.accentColor}
          fallback={PLATFORM_BRAND.accentColor}
          onChange={(v) => onColorsChange({ accentColor: v })}
        />
        <ColorPicker
          label="Fondo claro"
          value={colors.backgroundColor}
          fallback={PLATFORM_BRAND.backgroundColor}
          onChange={(v) => onColorsChange({ backgroundColor: v })}
        />
      </div>

      <div className="mt-6 rounded-lg border border-line-default bg-surface-subtle p-4">
        <p className="text-sm font-medium text-content-primary">
          Identidad de tu empresa
        </p>
        <p className="mt-1 text-xs text-content-secondary">
          Tu logotipo y colores se utilizarán en cotizaciones, documentos y
          comunicaciones de tu empresa. La pantalla de acceso conserva la
          identidad de TAKTO.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-white/10" />
            )}
            <span className="text-xs text-white">Menú lateral</span>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-line-default bg-surface-default px-3 py-2">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-neutral-200" />
            )}
            <span className="text-xs text-content-primary">Cotizaciones</span>
          </div>

          <span
            style={{ backgroundColor: displayColor(colors.primaryColor, PLATFORM_BRAND.primaryColor) }}
            className="rounded-md px-3 py-2 text-xs font-medium text-white"
          >
            Botón principal
          </span>
          <span
            style={{
              backgroundColor: displayColor(colors.accentColor, PLATFORM_BRAND.accentColor),
              color: PLATFORM_BRAND.primaryColor,
            }}
            className="rounded-md px-3 py-2 text-xs font-medium"
          >
            Botón de acento
          </span>
        </div>
      </div>
    </div>
  );
}
