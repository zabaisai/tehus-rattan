"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Upload, X } from "lucide-react";
import { validateLogoFile } from "@/lib/onboarding";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/**
 * Colores por defecto de UNA EMPRESA NUEVA. NO son los de TAKTO y no deben
 * sustituirse por el navy/naranja de la plataforma: el manual prohíbe
 * expresamente vestir a la empresa cliente con la marca del producto. Aquí
 * TAKTO solo pone el armazón —etiquetas, campos, tarjetas—; lo que se elige
 * dentro es identidad de la empresa.
 */
const COLOR_EMPRESA_POR_DEFECTO = "#A57014";
const ACENTO_EMPRESA_POR_DEFECTO = "#FDDC7F";

export interface BrandingColorState {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
}

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
  onChange,
}: {
  label: string;
  value: string;
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
        <input
          id={idMuestra}
          type="color"
          value={value || COLOR_EMPRESA_POR_DEFECTO}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-neutral-300 bg-transparent p-0.5"
        />
        {/* Segundo control para el mismo dato: escribir el hexadecimal a mano.
            Lleva su propia etiqueta oculta porque la visible ya está tomada
            por la muestra de color. */}
        <Field label={`${label} en hexadecimal`} labelOculta className="w-full">
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={COLOR_EMPRESA_POR_DEFECTO}
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
        Este paso es opcional. Puedes agregar tu logo y colores ahora o
        configurarlos después dentro del CRM.
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
          onChange={(v) => onColorsChange({ primaryColor: v })}
        />
        <ColorPicker
          label="Color de acento"
          value={colors.accentColor}
          onChange={(v) => onColorsChange({ accentColor: v })}
        />
        <ColorPicker
          label="Fondo claro"
          value={colors.backgroundColor}
          onChange={(v) => onColorsChange({ backgroundColor: v })}
        />
      </div>

      {/* Vista previa de la identidad DE LA EMPRESA. Los colores salen de lo
          que el usuario acaba de elegir, nunca de los tokens de TAKTO: es lo
          que se está configurando. */}
      <div className="mt-6 rounded-lg border border-line-default bg-surface-subtle p-4">
        <p className="text-xs font-medium text-content-secondary">Vista previa</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-white/10" />
            )}
            <span className="text-xs text-white">Sidebar</span>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-line-default bg-surface-default px-3 py-2">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-neutral-200" />
            )}
            <span className="text-xs text-content-primary">Login</span>
          </div>

          <span
            style={{ backgroundColor: colors.primaryColor || COLOR_EMPRESA_POR_DEFECTO }}
            className="rounded-md px-3 py-2 text-xs font-medium text-white"
          >
            Botón principal
          </span>
          <span
            style={{
              backgroundColor: colors.accentColor || ACENTO_EMPRESA_POR_DEFECTO,
              color: "#0B0F10",
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
