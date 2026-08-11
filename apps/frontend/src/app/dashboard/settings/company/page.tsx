"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { getMyCompany, updateMyCompany, uploadCompanyLogo, resolveCompanyAssetUrl } from "@/lib/companies";
import { validateLogoFile } from "@/lib/onboarding";
import { Company, UpdateCompanyPayload } from "@/types";
import { useAuthStore } from "@/store/auth.store";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

type ApiError = {
  response?: {
    status?: number;
    data?: { message?: string | string[] };
  };
};

function mapCompanyError(err: unknown): string {
  const response = (err as ApiError).response;
  const status = response?.status;
  const message = response?.data?.message;
  const readable = Array.isArray(message) ? message[0] : message;

  if (status === 401 || status === 403) {
    return "Tu sesión expiró o no tienes permiso para esta acción.";
  }
  if (status === 400) {
    return readable || "Revisa la información ingresada.";
  }
  return readable || "Ocurrió un error. Intenta de nuevo.";
}

const labelClass = "mb-1.5 block text-sm font-medium text-neutral-700";

/**
 * Muestra de color + campo hexadecimal para el MISMO dato.
 *
 * La etiqueta visible apunta a la muestra; el campo de texto lleva la suya
 * oculta, porque dos controles no pueden compartir una etiqueta y sin ella el
 * hexadecimal se anunciaba como un cuadro de texto sin nombre.
 */
function SelectorDeColor({
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
      <label htmlFor={idMuestra} className={labelClass}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={idMuestra}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-neutral-300 bg-transparent p-0.5"
        />
        <Field label={`${label} en hexadecimal`} labelOculta className="w-full">
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function LogoUploader({
  label,
  currentUrl,
  type,
  onUploaded,
}: {
  label: string;
  currentUrl: string | null;
  type: "primary" | "secondary";
  onUploaded: () => void;
}) {
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const previewUrl = useMemo(
    () => (previewFile ? URL.createObjectURL(previewFile) : null),
    [previewFile],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleSelect(file: File) {
    const validationError = validateLogoFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setPreviewFile(file);
    setUploading(true);
    try {
      await uploadCompanyLogo(file, type);
      onUploaded();
    } catch (err) {
      setError(mapCompanyError(err));
    } finally {
      setUploading(false);
    }
  }

  const displayUrl = previewUrl ?? (currentUrl ? resolveCompanyAssetUrl(currentUrl) : null);

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <label className="flex h-28 w-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-center hover:bg-neutral-100">
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayUrl} alt={label} className="h-16 w-16 rounded object-contain" />
        ) : (
          <>
            <Upload size={16} className="text-neutral-400" />
            <span className="px-2 text-[10px] text-neutral-400">PNG, JPG o WEBP</span>
          </>
        )}
        {/* `sr-only` y no `hidden`: un `display:none` saca al campo del orden
            de tabulación, así que la zona de subida dejaba de alcanzarse por
            teclado. Con `aria-label` además tiene nombre propio. */}
        <input
          type="file"
          aria-label={label}
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleSelect(file);
            e.target.value = "";
          }}
        />
      </label>
      {uploading && <p className="mt-1 text-xs text-neutral-400">Subiendo...</p>}
      {error && <p className="mt-1 text-xs text-status-error">{error}</p>}
    </div>
  );
}

function CompanySettingsForm({ company }: { company: Company }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: company.name,
    businessType: company.businessType ?? "",
    city: company.city ?? "",
    country: company.country ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    description: company.description ?? "",
    legalName: company.legalName ?? "",
    taxId: company.taxId ?? "",
    address: company.address ?? "",
    quoteFooter: company.quoteFooter ?? "",
    primaryColor: company.primaryColor ?? "#A57014",
    accentColor: company.accentColor ?? "#FDDC7F",
    backgroundColor: company.backgroundColor ?? "#FAF8F3",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function patch(fields: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...fields }));
  }

  function invalidateCompany() {
    queryClient.invalidateQueries({ queryKey: ["company-me"] });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const payload: UpdateCompanyPayload = {
        name: form.name.trim(),
        businessType: form.businessType.trim() || undefined,
        city: form.city.trim() || undefined,
        country: form.country.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        website: form.website.trim() || undefined,
        description: form.description.trim() || undefined,
        // Fiscal fields send `null` (not `undefined`) when cleared, so emptying
        // one actually clears it server-side instead of being omitted from the
        // PATCH and silently keeping its previous value.
        legalName: form.legalName.trim() || null,
        taxId: form.taxId.trim() || null,
        address: form.address.trim() || null,
        quoteFooter: form.quoteFooter.trim() || null,
        primaryColor: form.primaryColor || undefined,
        accentColor: form.accentColor || undefined,
        backgroundColor: form.backgroundColor || undefined,
      };
      await updateMyCompany(payload);
      invalidateCompany();
      setSuccess("Cambios guardados correctamente.");
    } catch (err) {
      setError(mapCompanyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-neutral-800">Logo de la empresa</h3>
        <div className="flex flex-wrap gap-6">
          <LogoUploader
            label="Logo principal"
            currentUrl={company.logoUrl}
            type="primary"
            onUploaded={invalidateCompany}
          />
          <LogoUploader
            label="Logo secundario"
            currentUrl={company.secondaryLogoUrl}
            type="secondary"
            onUploaded={invalidateCompany}
          />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-neutral-800">Datos de la empresa</h3>
        <p className="mb-4 text-xs text-neutral-400">
          Perfil comercial de tu empresa dentro del CRM. Los datos fiscales para
          cotizaciones se configuran en la sección de abajo.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre comercial" required>
            <Input
              type="text"
              required
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Tipo de negocio">
            <Input
              type="text"
              value={form.businessType}
              onChange={(e) => patch({ businessType: e.target.value })}
            />
          </Field>
          <Field label="Ciudad">
            <Input
              type="text"
              value={form.city}
              onChange={(e) => patch({ city: e.target.value })}
            />
          </Field>
          <Field label="País">
            <Input
              type="text"
              value={form.country}
              onChange={(e) => patch({ country: e.target.value })}
            />
          </Field>
          <Field label="Teléfono">
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </Field>
          <Field label="Sitio web o Instagram">
            <Input
              type="text"
              value={form.website}
              onChange={(e) => patch({ website: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Descripción corta" className="mt-4">
          <Textarea
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
          />
        </Field>

        <div className="mt-8 border-t border-neutral-100 pt-6">
          <h3 className="mb-1 text-sm font-semibold text-neutral-800">
            Identidad fiscal (para cotizaciones)
          </h3>
          <p className="mb-4 text-xs text-neutral-400">
            Todos los campos son opcionales. Se usan para el encabezado y el pie
            de las cotizaciones impresas de tu empresa. Los que dejes vacíos
            simplemente no aparecen en el documento.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Razón social (opcional)">
              <Input
                type="text"
                value={form.legalName}
                onChange={(e) => patch({ legalName: e.target.value })}
              />
            </Field>
            <Field label="NIT / Identificación fiscal (opcional)">
              <Input
                type="text"
                value={form.taxId}
                onChange={(e) => patch({ taxId: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Dirección (opcional)" className="mt-4">
            <Input
              type="text"
              value={form.address}
              onChange={(e) => patch({ address: e.target.value })}
            />
          </Field>

          <Field
            label="Condiciones / texto del pie de cotización (opcional)"
            className="mt-4"
          >
            <Textarea
              value={form.quoteFooter}
              onChange={(e) => patch({ quoteFooter: e.target.value })}
              rows={3}
            />
          </Field>
        </div>

        {/* Colores DE LA EMPRESA, no de TAKTO: aquí la plataforma solo pone el
            armazón. Lo que se elige dentro es identidad del cliente. */}
        <div className="mt-8 grid grid-cols-1 gap-4 border-t border-neutral-100 pt-6 sm:grid-cols-3">
          <SelectorDeColor
            label="Color principal"
            value={form.primaryColor}
            onChange={(v) => patch({ primaryColor: v })}
          />
          <SelectorDeColor
            label="Color de acento"
            value={form.accentColor}
            onChange={(v) => patch({ accentColor: v })}
          />
          <SelectorDeColor
            label="Fondo claro"
            value={form.backgroundColor}
            onChange={(v) => patch({ backgroundColor: v })}
          />
        </div>

        {error && <p className="mt-4 text-xs text-status-error">{error}</p>}
        {success && <p className="mt-4 text-xs text-status-success-strong">{success}</p>}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-900 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CompanySettingsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const { data: company, isLoading, isError } = useQuery({
    queryKey: ["company-me"],
    queryFn: getMyCompany,
  });

  return (
    <div>
      <h2 className="text-xl font-semibold text-neutral-900">Empresa</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Edita el perfil, branding y logo de tu empresa dentro del CRM.
      </p>

      <div className="mt-6">
        {!canManage && (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm text-neutral-600">
              No tienes permiso para administrar la configuración de la empresa.
            </p>
          </div>
        )}

        {canManage && isLoading && (
          <p className="text-sm text-neutral-400">Cargando...</p>
        )}

        {canManage && isError && (
          <p className="text-sm text-status-error">
            No se pudo cargar la información de la empresa.
          </p>
        )}

        {canManage && company && <CompanySettingsForm company={company} />}
      </div>
    </div>
  );
}
