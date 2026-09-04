"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { COMPANY_SETTINGS_QUERY_KEY } from "@/lib/company-settings";
import { STAGE_TYPE_LABELS } from "@/lib/onboarding-templates";
import {
  BUSINESS_MODEL_TEXT,
  CORE_MODULE_LABELS,
  DEFAULT_REGIONAL_LIMITS,
  LOCALE_SUGGESTIONS,
  TENANT_CONFIGURATION_QUERY_KEY,
  businessModelFrom,
  normalizeRegionalDraft,
  timezoneSuggestions,
  updateMyTenantConfiguration,
  useTenantConfiguration,
  validateRegionalDraft,
  type RegionalDraft,
  type RegionalDraftErrors,
  type TenantConfiguration,
  type UpdateTenantConfigurationPayload,
} from "@/lib/tenant-configuration";

type ApiError = {
  response?: { status?: number; data?: { message?: string | string[] } };
};

interface Draft {
  regional: RegionalDraft;
  sellsProducts: boolean;
  sellsServices: boolean;
  catalog: boolean;
  quotes: boolean;
  tasks: boolean;
}

type FieldErrors = RegionalDraftErrors & { commercial?: string };

const OPTIONAL_MODULES = [
  {
    key: "catalog",
    label: "Catálogo",
    hint: "Lista de productos o servicios con precio y categorías.",
  },
  {
    key: "quotes",
    label: "Cotizaciones",
    hint: "Documentos de venta a partir de una oportunidad.",
  },
  {
    key: "tasks",
    label: "Tareas",
    hint: "Seguimientos y recordatorios del equipo.",
  },
] as const;

function draftFrom(config: TenantConfiguration): Draft {
  return {
    regional: {
      country: config.regional.country ?? "",
      timezone: config.regional.timezone,
      currency: config.regional.currency,
      locale: config.regional.locale,
    },
    // Una empresa legacy con el modelo sin definir se muestra con ambas
    // casillas vacías; el usuario decide, y el servidor exige al menos una.
    sellsProducts:
      config.identity.businessModel === "products" ||
      config.identity.businessModel === "mixed",
    sellsServices:
      config.identity.businessModel === "services" ||
      config.identity.businessModel === "mixed",
    catalog: config.modules.catalog,
    quotes: config.modules.quotes,
    tasks: config.modules.tasks,
  };
}

/** Solo lo que cambió respecto a lo guardado: un PATCH parcial de verdad. */
function payloadFrom(
  server: TenantConfiguration,
  draft: Draft,
): UpdateTenantConfigurationPayload {
  const base = draftFrom(server);
  const regional = normalizeRegionalDraft(draft.regional);
  const payload: UpdateTenantConfigurationPayload = {};

  const regionalPatch: NonNullable<UpdateTenantConfigurationPayload["regional"]> =
    {};
  if (regional.country !== base.regional.country) {
    regionalPatch.country = regional.country || null;
  }
  if (regional.timezone !== base.regional.timezone) {
    regionalPatch.timezone = regional.timezone;
  }
  if (regional.currency !== base.regional.currency) {
    regionalPatch.currency = regional.currency;
  }
  if (regional.locale !== base.regional.locale) {
    regionalPatch.locale = regional.locale;
  }
  if (Object.keys(regionalPatch).length > 0) payload.regional = regionalPatch;

  const commercial: NonNullable<UpdateTenantConfigurationPayload["commercial"]> =
    {};
  if (draft.sellsProducts !== base.sellsProducts) {
    commercial.sellsProducts = draft.sellsProducts;
  }
  if (draft.sellsServices !== base.sellsServices) {
    commercial.sellsServices = draft.sellsServices;
  }
  if (Object.keys(commercial).length > 0) payload.commercial = commercial;

  const modules: NonNullable<UpdateTenantConfigurationPayload["modules"]> = {};
  if (draft.catalog !== base.catalog) modules.catalog = draft.catalog;
  if (draft.quotes !== base.quotes) modules.quotes = draft.quotes;
  if (draft.tasks !== base.tasks) modules.tasks = draft.tasks;
  if (Object.keys(modules).length > 0) payload.modules = modules;

  return payload;
}

/**
 * Un error del servidor se muestra JUNTO al campo que lo causó. Los mensajes
 * del backend empiezan por la ruta del campo (`regional.timezone …`), así que
 * se reparten por prefijo; lo que no encaja va al mensaje general.
 */
function mapServerError(err: unknown): { fields: FieldErrors; general: string } {
  const response = (err as ApiError).response;
  const raw = response?.data?.message;
  const messages = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (response?.status === 401 || response?.status === 403) {
    return {
      fields: {},
      general: "Tu sesión expiró o no tienes permiso para esta acción.",
    };
  }
  const fields: FieldErrors = {};
  const rest: string[] = [];
  for (const m of messages) {
    if (m.startsWith("regional.timezone")) fields.timezone = m;
    else if (m.startsWith("regional.currency")) fields.currency = m;
    else if (m.startsWith("regional.locale")) fields.locale = m;
    else if (m.startsWith("regional.country")) fields.country = m;
    else if (/vender productos, servicios o ambos/i.test(m)) fields.commercial = m;
    else rest.push(m);
  }
  const general =
    rest[0] ??
    (Object.keys(fields).length > 0
      ? "Revisa los campos marcados."
      : "No se pudo guardar la configuración. Intenta de nuevo.");
  return { fields, general: Object.keys(fields).length > 0 && rest.length === 0 ? "" : general };
}

/**
 * Configuración por empresa (Fase 2): región, modelo comercial y módulos, con
 * los datos de origen (industria, tipo, pipeline) solo informativos.
 *
 * Nada se guarda al cargar: el borrador parte de lo guardado y solo se envía
 * lo que cambió, al pulsar Guardar. Un asesor ve la configuración (la
 * necesita para operar) pero con los controles deshabilitados y sin botón.
 */
export function TenantConfigurationSection({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: config, isLoading, isError } = useTenantConfiguration();
  const limits = config?.limits.regional ?? DEFAULT_REGIONAL_LIMITS;
  const ids = useId();
  const tzListId = `${ids}-tz`;
  const localeListId = `${ids}-locale`;
  const headingId = `${ids}-heading`;

  // Mismo patrón que CompanyCategoriesEditor: el borrador se reinicia solo
  // cuando llega una versión nueva del servidor, y se ajusta en el render.
  const [synced, setSynced] = useState<{
    source: TenantConfiguration | null;
    draft: Draft | null;
  }>({ source: null, draft: null });
  if (config && config !== synced.source) {
    setSynced({ source: config, draft: draftFrom(config) });
  }
  const draft = synced.draft;
  const setDraft = (fn: (d: Draft) => Draft) =>
    setSynced((s) => (s.draft ? { ...s, draft: fn(s.draft) } : s));

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const dirty =
    config !== undefined &&
    draft !== null &&
    Object.keys(payloadFrom(config, draft)).length > 0;

  const model = draft
    ? businessModelFrom({
        sellsProducts: draft.sellsProducts,
        sellsServices: draft.sellsServices,
      })
    : null;

  function setRegional(field: keyof RegionalDraft, value: string) {
    setDraft((d) => ({ ...d, regional: { ...d.regional, [field]: value } }));
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
    setSuccess("");
  }

  function setFlag(
    field: "sellsProducts" | "sellsServices" | "catalog" | "quotes" | "tasks",
    value: boolean,
  ) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (fieldErrors.commercial) {
      setFieldErrors((e) => ({ ...e, commercial: undefined }));
    }
    setSuccess("");
  }

  async function save() {
    if (!config || !draft || readOnly) return;
    setError("");
    setSuccess("");

    const errors: FieldErrors = validateRegionalDraft(draft.regional, limits);
    if (!draft.sellsProducts && !draft.sellsServices) {
      errors.commercial =
        "Indica si la empresa vende productos, servicios o ambos.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const payload = payloadFrom(config, draft);
    if (Object.keys(payload).length === 0) return;

    setSaving(true);
    try {
      await updateMyTenantConfiguration(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TENANT_CONFIGURATION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY }),
      ]);
      setSuccess("Configuración guardada.");
    } catch (err) {
      const mapped = mapServerError(err);
      setFieldErrors(mapped.fields);
      setError(mapped.general);
    } finally {
      setSaving(false);
    }
  }

  const disabled = readOnly || saving;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-neutral-200 bg-white p-5"
    >
      <h3 id={headingId} className="mb-1 text-sm font-semibold text-neutral-800">
        Configuración de la empresa
      </h3>
      <p className="mb-4 text-xs text-neutral-400">
        Región, modelo comercial y módulos con los que opera esta empresa.
        Nada se guarda hasta que pulses «Guardar configuración».
      </p>

      {isLoading && <p className="text-sm text-neutral-400">Cargando...</p>}
      {isError && (
        <p role="alert" className="text-sm text-status-error">
          No se pudo cargar la configuración de la empresa.
        </p>
      )}

      {config && draft && (
        <div className="space-y-6">
          {/* ── Región ─────────────────────────────────────────────── */}
          <fieldset disabled={disabled} className="min-w-0">
            <legend className="mb-2 text-sm font-medium text-neutral-800">
              Región
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="País" error={fieldErrors.country}>
                <Input
                  type="text"
                  value={draft.regional.country}
                  maxLength={limits.country.maxLength}
                  onChange={(e) => setRegional("country", e.target.value)}
                  placeholder="Colombia"
                  autoComplete="country-name"
                />
              </Field>
              <Field
                label="Zona horaria"
                hint="Identificador IANA, por ejemplo America/Bogota."
                error={fieldErrors.timezone}
                required
              >
                <Input
                  type="text"
                  required
                  list={tzListId}
                  value={draft.regional.timezone}
                  maxLength={limits.timezone.maxLength}
                  onChange={(e) => setRegional("timezone", e.target.value)}
                  placeholder="America/Bogota"
                  spellCheck={false}
                />
                <datalist id={tzListId}>
                  {timezoneSuggestions().map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
              <Field
                label="Moneda"
                hint="Código ISO de tres letras: COP, USD, CRC…"
                error={fieldErrors.currency}
                required
              >
                <Input
                  type="text"
                  required
                  value={draft.regional.currency}
                  maxLength={limits.currency.length}
                  onChange={(e) =>
                    setRegional("currency", e.target.value.toUpperCase())
                  }
                  placeholder="COP"
                  className="uppercase"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Idioma y región"
                hint="Etiqueta de idioma, por ejemplo es-CO o es-CR."
                error={fieldErrors.locale}
                required
              >
                <Input
                  type="text"
                  required
                  list={localeListId}
                  value={draft.regional.locale}
                  maxLength={limits.locale.maxLength}
                  onChange={(e) => setRegional("locale", e.target.value)}
                  placeholder="es-CO"
                  spellCheck={false}
                />
                <datalist id={localeListId}>
                  {LOCALE_SUGGESTIONS.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </Field>
            </div>
          </fieldset>

          {/* ── Modelo comercial ───────────────────────────────────── */}
          <fieldset disabled={disabled}>
            <legend className="mb-2 text-sm font-medium text-neutral-800">
              Modelo comercial
            </legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={draft.sellsProducts}
                  onChange={(e) => setFlag("sellsProducts", e.target.checked)}
                  aria-invalid={fieldErrors.commercial ? true : undefined}
                  className="h-4 w-4 rounded border-neutral-300 accent-brand-primary"
                />
                Vende productos
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={draft.sellsServices}
                  onChange={(e) => setFlag("sellsServices", e.target.checked)}
                  aria-invalid={fieldErrors.commercial ? true : undefined}
                  className="h-4 w-4 rounded border-neutral-300 accent-brand-primary"
                />
                Vende servicios
              </label>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Modelo:{" "}
              <strong className="font-medium text-neutral-700">
                {model ? BUSINESS_MODEL_TEXT[model] : "Sin definir"}
              </strong>
              . El catálogo propone «Servicio» al crear un elemento cuando la
              empresa vende solo servicios.
            </p>
            {fieldErrors.commercial && (
              <p role="alert" className="mt-1 text-xs text-status-error">
                {fieldErrors.commercial}
              </p>
            )}
          </fieldset>

          {/* ── Módulos ────────────────────────────────────────────── */}
          <fieldset disabled={disabled}>
            <legend className="mb-2 text-sm font-medium text-neutral-800">
              Módulos
            </legend>
            <ul
              aria-label="Módulos centrales"
              className="mb-3 flex flex-wrap gap-2"
            >
              {(
                Object.keys(CORE_MODULE_LABELS) as Array<
                  keyof typeof CORE_MODULE_LABELS
                >
              ).map((key) => (
                <li
                  key={key}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700"
                >
                  {CORE_MODULE_LABELS[key]}
                  <Badge tone="success">Siempre activo</Badge>
                </li>
              ))}
            </ul>
            <ul aria-label="Módulos opcionales" className="space-y-2">
              {OPTIONAL_MODULES.map((m) => (
                <li key={m.key}>
                  <label className="flex items-start gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={draft[m.key]}
                      onChange={(e) => setFlag(m.key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-brand-primary"
                    />
                    <span>
                      {m.label}
                      <span className="block text-xs text-neutral-400">
                        {m.hint}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-400">
              Desactivar un módulo no borra categorías, productos, cotizaciones
              ni tareas: solo deja de proponerse.
            </p>
          </fieldset>

          {/* ── Informativo ────────────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-sm font-medium text-neutral-800">
              Datos de origen
            </h4>
            <dl
              aria-label="Datos informativos"
              className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3"
            >
              <div>
                <dt className="text-xs text-neutral-500">Industria</dt>
                <dd className="text-neutral-800">
                  {config.identity.industry ?? "Sin plantilla"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Tipo de negocio</dt>
                <dd className="text-neutral-800">
                  {config.identity.businessType ?? "Sin definir"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">
                  Pipeline predeterminado
                </dt>
                <dd className="text-neutral-800">
                  {config.pipeline ? (
                    <>
                      {config.pipeline.name}
                      <span className="block text-xs text-neutral-500">
                        {config.pipeline.stages
                          .map(
                            (s) =>
                              `${s.name}${s.type !== "OPEN" ? ` (${STAGE_TYPE_LABELS[s.type]})` : ""}`,
                          )
                          .join(" · ")}
                      </span>
                    </>
                  ) : (
                    "Sin pipeline"
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-neutral-400">
              La industria y la plantilla describen cómo se creó la empresa. El
              pipeline se edita en su propia pantalla.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-status-error">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-xs text-status-success-strong">
              {success}
            </p>
          )}

          {readOnly ? (
            <p className="text-xs text-neutral-500">
              Solo un administrador puede modificar la configuración.
            </p>
          ) : (
            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? "Guardando..." : "Guardar configuración"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
