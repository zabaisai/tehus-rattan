"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
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
  type CapabilityDefinition,
  type OptionalModuleKey,
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

const OPTIONAL_MODULE_KEYS: OptionalModuleKey[] = ["catalog", "quotes", "tasks"];

function isOptionalModule(key: string): key is OptionalModuleKey {
  return (OPTIONAL_MODULE_KEYS as string[]).includes(key);
}

/**
 * Si el servidor no publica definiciones (versión anterior a la Fase 4), la
 * sección sigue funcionando con estas. Mismo texto que había escrito aquí.
 */
const FALLBACK_DEFINITIONS: CapabilityDefinition[] = [
  ...(
    Object.keys(CORE_MODULE_LABELS) as Array<keyof typeof CORE_MODULE_LABELS>
  ).map(
    (key): CapabilityDefinition => ({
      key,
      label: CORE_MODULE_LABELS[key],
      description: "",
      group: "core",
      alwaysOn: true,
      configurable: false,
      dependsOn: [],
      relatedTo: [],
    }),
  ),
  {
    key: "catalog",
    label: "Catálogo",
    description: "Lista de productos o servicios con precio y categorías.",
    group: "commercial",
    alwaysOn: false,
    configurable: true,
    dependsOn: [],
    relatedTo: ["quotes"],
  },
  {
    key: "quotes",
    label: "Cotizaciones",
    description: "Documentos de venta a partir de una oportunidad.",
    group: "commercial",
    alwaysOn: false,
    configurable: true,
    dependsOn: [],
    relatedTo: ["catalog"],
  },
  {
    key: "tasks",
    label: "Tareas",
    description: "Seguimientos y recordatorios del equipo.",
    group: "commercial",
    alwaysOn: false,
    configurable: true,
    dependsOn: [],
    relatedTo: [],
  },
];

function definitionsOf(config: TenantConfiguration): CapabilityDefinition[] {
  const published = config.capabilities?.definitions;
  return published && published.length > 0 ? published : FALLBACK_DEFINITIONS;
}

/**
 * Aviso cuando un módulo activo se apoya en otro apagado. La relación la
 * publica el servidor (`relatedTo`); la frase la pone la interfaz y es
 * DIRECCIONAL: una cotización se puede leer sin catálogo, pero no empezar
 * una nueva; un catálogo sin cotizaciones, en cambio, no necesita aviso.
 * Sin frase para el par, no hay aviso.
 */
const RELATED_HINTS: Partial<Record<`${OptionalModuleKey}>${OptionalModuleKey}`, string>> = {
  "quotes>catalog": "Crear cotizaciones nuevas necesita elementos del catálogo.",
};

function relatedHints(
  definitions: CapabilityDefinition[],
  active: Record<OptionalModuleKey, boolean>,
): string[] {
  const hints: string[] = [];
  for (const d of definitions) {
    if (!isOptionalModule(d.key) || !active[d.key]) continue;
    for (const r of d.relatedTo) {
      if (active[r]) continue;
      const hint = RELATED_HINTS[`${d.key}>${r}`];
      if (hint) hints.push(hint);
    }
  }
  return hints;
}

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
  // Apagar un módulo pide confirmación: la casilla no cambia hasta que se
  // confirma en el diálogo. Encenderlo es inmediato.
  const [pendingOff, setPendingOff] = useState<OptionalModuleKey | null>(null);

  const definitions = config ? definitionsOf(config) : FALLBACK_DEFINITIONS;
  const coreDefinitions = definitions.filter((d) => d.alwaysOn);
  const optionalDefinitions = definitions.filter(
    (d) => d.configurable && isOptionalModule(d.key),
  );
  const legacyDefaults = config?.capabilities?.legacyDefaultsApplied ?? [];
  const hints = draft
    ? relatedHints(definitions, {
        catalog: draft.catalog,
        quotes: draft.quotes,
        tasks: draft.tasks,
      })
    : [];
  const pendingDefinition = pendingOff
    ? definitions.find((d) => d.key === pendingOff)
    : undefined;

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

  function toggleModule(key: OptionalModuleKey, value: boolean) {
    if (value) {
      setFlag(key, true);
      return;
    }
    setPendingOff(key);
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
      const response = await updateMyTenantConfiguration(payload);
      // Primero la respuesta canónica del servidor —la barra lateral, el menú
      // «Crear» y el buscador cambian en este mismo instante—, después la
      // invalidación de todo lo que deriva de la empresa (`company-me`:
      // configuración, ajustes, perfil) para que nadie se quede con lo viejo.
      if (response) {
        queryClient.setQueryData(TENANT_CONFIGURATION_QUERY_KEY, response);
      }
      await queryClient.invalidateQueries({ queryKey: ["company-me"] });
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
              {coreDefinitions.map((d) => (
                <li
                  key={d.key}
                  title={d.description || undefined}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700"
                >
                  {d.label}
                  <Badge tone="success">Siempre activo</Badge>
                </li>
              ))}
            </ul>
            <ul aria-label="Módulos opcionales" className="space-y-2">
              {optionalDefinitions.map((d) => {
                const key = d.key as OptionalModuleKey;
                const legacy = legacyDefaults.includes(key);
                return (
                  <li key={key}>
                    <label className="flex items-start gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={draft[key]}
                        onChange={(e) => toggleModule(key, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-brand-primary"
                      />
                      <span>
                        {d.label}
                        <span className="block text-xs text-neutral-400">
                          {d.description}
                        </span>
                        {/* Activo porque la empresa nunca dijo lo contrario:
                            se avisa para que la decisión sea suya, no de la
                            compatibilidad. */}
                        {legacy && draft[key] && (
                          <span className="mt-0.5 block text-xs text-neutral-500">
                            Activo por compatibilidad: tu empresa nunca lo
                            desactivó.
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {hints.length > 0 && (
              <ul
                role="note"
                aria-label="Avisos entre módulos"
                className="mt-2 space-y-1 rounded-md bg-status-info-surface px-3 py-2 text-xs text-status-info"
              >
                {hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-neutral-400">
              Desactivar un módulo no borra categorías, productos, cotizaciones
              ni tareas: solo deja de proponerse.
            </p>
          </fieldset>

          {pendingOff && (
            <ConfirmDialog
              title={`Desactivar ${pendingDefinition?.label ?? pendingOff}`}
              message={
                <>
                  <p>
                    {pendingDefinition?.label ?? "El módulo"} dejará de verse
                    en el menú, en el buscador y en el panel «Crear» para todo
                    el equipo.
                  </p>
                  <p className="mt-2">
                    Desactivar no borra nada: los datos vuelven al reactivarlo.
                  </p>
                  <p className="mt-2">
                    El cambio se aplica al pulsar «Guardar configuración».
                  </p>
                </>
              }
              confirmLabel="Desactivar"
              confirmVariant="primary"
              onClose={() => setPendingOff(null)}
              onConfirm={async () => {
                setFlag(pendingOff, false);
                setPendingOff(null);
              }}
            />
          )}

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
