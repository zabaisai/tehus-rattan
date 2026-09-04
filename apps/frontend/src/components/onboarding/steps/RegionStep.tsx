"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  COUNTRY_PRESETS,
  OTHER_COUNTRY,
  presetForCountry,
  type CountryPreset,
} from "@/lib/onboarding-regions";
import {
  LOCALE_SUGGESTIONS,
  timezoneSuggestions,
  type RegionalDraft,
  type RegionalDraftErrors,
  type RegionalLimits,
} from "@/lib/tenant-configuration";

interface RegionStepProps {
  value: RegionalDraft;
  errors: RegionalDraftErrors;
  limits: RegionalLimits;
  /** La persona ya cambió zona, moneda o idioma a mano. */
  edited: boolean;
  /** Elegir un país: si no hay ediciones, aplica sus valores; si las hay, el padre pregunta. */
  onCountryChange: (country: string, preset: CountryPreset | undefined) => void;
  onFieldChange: (field: Exclude<keyof RegionalDraft, "country">, value: string) => void;
  /** Volver a los valores que propone el país elegido. */
  onApplyPreset: () => void;
  /** Propuesta pendiente (país cambiado con ediciones): dos acciones explícitas. */
  pendingPreset: CountryPreset | null;
  onKeepMine: () => void;
  onApplyPending: () => void;
}

/**
 * País → zona horaria, moneda e idioma propuestos y editables. Lo que se
 * guarda son las columnas regionales de la empresa (Fase 2), con las mismas
 * reglas que Configuración → Empresa: IANA, ISO 4217 y BCP 47.
 */
export function RegionStep({
  value,
  errors,
  limits,
  edited,
  onCountryChange,
  onFieldChange,
  onApplyPreset,
  pendingPreset,
  onKeepMine,
  onApplyPending,
}: RegionStepProps) {
  const ids = useId();
  const preset = presetForCountry(value.country);
  const [otherCountry, setOtherCountry] = useState(!preset && value.country !== "");
  const selectValue = preset ? preset.name : otherCountry || value.country ? OTHER_COUNTRY : "";

  function handleSelect(next: string) {
    if (next === OTHER_COUNTRY) {
      setOtherCountry(true);
      onCountryChange("", undefined);
      return;
    }
    setOtherCountry(false);
    const p = presetForCountry(next);
    onCountryChange(p?.name ?? "", p);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-content-primary">¿Dónde opera tu empresa?</h3>
        <Badge tone={edited ? "warning" : "info"}>{edited ? "Editado" : "Sugerido por el país"}</Badge>
      </div>
      <p className="mt-1.5 text-sm text-content-secondary">
        Con el país proponemos zona horaria, moneda e idioma. Puedes cambiarlos; se usan en
        fechas, montos y documentos de tu empresa.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="País" required hint="Elige uno de la lista o «Otro país» para escribirlo.">
          <Select required value={selectValue} onChange={(e) => handleSelect(e.target.value)}>
            <option value="">Selecciona un país</option>
            {COUNTRY_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
            <option value={OTHER_COUNTRY}>Otro país</option>
          </Select>
        </Field>

        {selectValue === OTHER_COUNTRY && (
          <Field label="Nombre del país" required error={errors.country}>
            <Input
              type="text"
              required
              maxLength={limits.country.maxLength}
              value={value.country}
              onChange={(e) => onCountryChange(e.target.value, undefined)}
              placeholder="Escribe el país"
            />
          </Field>
        )}

        {pendingPreset && (
          <div
            role="group"
            aria-labelledby={`${ids}-pending`}
            className="rounded-md border border-status-warning/40 bg-status-warning-surface px-3 py-2.5 text-sm"
          >
            <p id={`${ids}-pending`} className="text-content-primary">
              Ya cambiaste zona, moneda o idioma a mano. ¿Quieres aplicar los valores de{" "}
              <strong>{pendingPreset.name}</strong> ({pendingPreset.timezone}, {pendingPreset.currency},{" "}
              {pendingPreset.locale}) o conservar los tuyos?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onKeepMine}>
                Conservar mis cambios
              </Button>
              <Button size="sm" onClick={onApplyPending}>
                Aplicar los valores del país
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Zona horaria" required hint="Ej.: America/Bogota" error={errors.timezone}>
            <Input
              type="text"
              required
              list={`${ids}-tz`}
              maxLength={limits.timezone.maxLength}
              value={value.timezone}
              onChange={(e) => onFieldChange("timezone", e.target.value)}
              placeholder="America/Bogota"
              spellCheck={false}
            />
            <datalist id={`${ids}-tz`}>
              {timezoneSuggestions().map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label="Moneda" required hint="Código de tres letras" error={errors.currency}>
            <Input
              type="text"
              required
              maxLength={limits.currency.length}
              value={value.currency}
              onChange={(e) => onFieldChange("currency", e.target.value.toUpperCase())}
              placeholder="COP"
              className="uppercase"
              spellCheck={false}
            />
          </Field>
          <Field label="Idioma" required hint="Ej.: es-CO" error={errors.locale}>
            <Input
              type="text"
              required
              list={`${ids}-locale`}
              maxLength={limits.locale.maxLength}
              value={value.locale}
              onChange={(e) => onFieldChange("locale", e.target.value)}
              placeholder="es-CO"
              spellCheck={false}
            />
            <datalist id={`${ids}-locale`}>
              {LOCALE_SUGGESTIONS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
        </div>

        {preset && edited && !pendingPreset && (
          <Button variant="quiet" size="sm" onClick={onApplyPreset}>
            Volver a los valores de {preset.name}
          </Button>
        )}
      </div>
    </div>
  );
}
