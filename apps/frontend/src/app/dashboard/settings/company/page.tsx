"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { getMyCompany, updateMyCompany, uploadCompanyLogo, resolveCompanyAssetUrl } from "@/lib/companies";
import { validateLogoFile } from "@/lib/onboarding";
import { Company, UpdateCompanyPayload } from "@/types";
import { useAuthStore } from "@/store/auth.store";

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

const inputClass =
  "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500";
const labelClass = "mb-1.5 block text-xs font-medium text-stone-600";

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
      <label className="flex h-28 w-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 text-center hover:bg-stone-100">
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayUrl} alt={label} className="h-16 w-16 rounded object-contain" />
        ) : (
          <>
            <Upload size={16} className="text-stone-400" />
            <span className="px-2 text-[10px] text-stone-400">PNG, JPG o WEBP</span>
          </>
        )}
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleSelect(file);
            e.target.value = "";
          }}
        />
      </label>
      {uploading && <p className="mt-1 text-xs text-stone-400">Subiendo...</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
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
        legalName: form.legalName.trim() || undefined,
        taxId: form.taxId.trim() || undefined,
        address: form.address.trim() || undefined,
        quoteFooter: form.quoteFooter.trim() || undefined,
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
      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-stone-800">Logo de la empresa</h3>
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

      <form onSubmit={handleSubmit} className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-stone-800">Datos de la empresa</h3>
        <p className="mb-4 text-xs text-stone-400">
          Perfil comercial de tu empresa dentro del CRM. Los datos fiscales para
          cotizaciones se configuran en la sección de abajo.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Nombre comercial *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Tipo de negocio</label>
            <input
              type="text"
              value={form.businessType}
              onChange={(e) => patch({ businessType: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Ciudad</label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => patch({ city: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>País</label>
            <input
              type="text"
              value={form.country}
              onChange={(e) => patch({ country: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Teléfono</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Sitio web o Instagram</label>
            <input
              type="text"
              value={form.website}
              onChange={(e) => patch({ website: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={labelClass}>Descripción corta</label>
          <textarea
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
            className={inputClass}
          />
        </div>

        <div className="mt-8 border-t border-stone-100 pt-6">
          <h3 className="mb-1 text-sm font-semibold text-stone-800">
            Identidad fiscal (para cotizaciones)
          </h3>
          <p className="mb-4 text-xs text-stone-400">
            Todos los campos son opcionales. Se usan para el encabezado y el pie
            de las cotizaciones impresas de tu empresa. Los que dejes vacíos
            simplemente no aparecen en el documento.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Razón social (opcional)</label>
              <input
                type="text"
                value={form.legalName}
                onChange={(e) => patch({ legalName: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>NIT / Identificación fiscal (opcional)</label>
              <input
                type="text"
                value={form.taxId}
                onChange={(e) => patch({ taxId: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className={labelClass}>Dirección (opcional)</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => patch({ address: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="mt-4">
            <label className={labelClass}>
              Condiciones / texto del pie de cotización (opcional)
            </label>
            <textarea
              value={form.quoteFooter}
              onChange={(e) => patch({ quoteFooter: e.target.value })}
              rows={3}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 border-t border-stone-100 pt-6 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Color principal</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => patch({ primaryColor: e.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5"
              />
              <input
                type="text"
                value={form.primaryColor}
                onChange={(e) => patch({ primaryColor: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Color de acento</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => patch({ accentColor: e.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5"
              />
              <input
                type="text"
                value={form.accentColor}
                onChange={(e) => patch({ accentColor: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Fondo claro</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.backgroundColor}
                onChange={(e) => patch({ backgroundColor: e.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5"
              />
              <input
                type="text"
                value={form.backgroundColor}
                onChange={(e) => patch({ backgroundColor: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
        {success && <p className="mt-4 text-xs text-emerald-600">{success}</p>}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
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
      <h2 className="text-xl font-semibold text-stone-900">Empresa</h2>
      <p className="mt-1 text-sm text-stone-500">
        Edita el perfil, branding y logo de tu empresa dentro del CRM.
      </p>

      <div className="mt-6">
        {!canManage && (
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-600">
              No tienes permiso para administrar la configuración de la empresa.
            </p>
          </div>
        )}

        {canManage && isLoading && (
          <p className="text-sm text-stone-400">Cargando...</p>
        )}

        {canManage && isError && (
          <p className="text-sm text-red-600">
            No se pudo cargar la información de la empresa.
          </p>
        )}

        {canManage && company && <CompanySettingsForm company={company} />}
      </div>
    </div>
  );
}
