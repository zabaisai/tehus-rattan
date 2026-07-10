"use client";

import { useEffect, useMemo, useState } from "react";
import { Upload, X } from "lucide-react";
import { validateLogoFile } from "@/lib/onboarding";

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
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-[#0B0F10]/70">{label}</label>
      <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#0B0F10]/20 bg-[#F4EFE6] px-4 text-center hover:bg-[#efe8d9]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-20 w-20 rounded object-contain" />
        ) : (
          <>
            <Upload size={18} className="text-[#0B0F10]/40" />
            <span className="text-xs text-[#0B0F10]/50">PNG, JPG o WEBP · máx. 2MB</span>
          </>
        )}
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="hidden"
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
          className="mt-1.5 flex items-center gap-1 text-xs text-[#0B0F10]/50 hover:text-[#0B0F10]"
        >
          <X size={12} /> Quitar
        </button>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
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
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-[#0B0F10]/70">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#A57014"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-[#0B0F10]/15 bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#A57014"
          className="w-full rounded-md border border-[#0B0F10]/15 px-3 py-2 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]"
        />
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
      <h3 className="text-lg font-semibold text-[#0B0F10]">Branding</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
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

      <div className="mt-6 rounded-lg border border-[#0B0F10]/10 bg-[#F4EFE6] p-4">
        <p className="text-xs font-medium text-[#0B0F10]/50">Vista previa</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md bg-[#0B0F10] px-3 py-2">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-white/10" />
            )}
            <span className="text-xs text-white">Sidebar</span>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-[#0B0F10]/10 bg-white px-3 py-2">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-stone-200" />
            )}
            <span className="text-xs text-[#0B0F10]">Login</span>
          </div>

          <button
            type="button"
            style={{ backgroundColor: colors.primaryColor || "#A57014" }}
            className="rounded-md px-3 py-2 text-xs font-medium text-white"
          >
            Botón principal
          </button>
          <button
            type="button"
            style={{ backgroundColor: colors.accentColor || "#FDDC7F", color: "#0B0F10" }}
            className="rounded-md px-3 py-2 text-xs font-medium"
          >
            Botón de acento
          </button>
        </div>
      </div>
    </div>
  );
}
