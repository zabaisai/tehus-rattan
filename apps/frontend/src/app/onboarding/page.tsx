"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { useAuthStore } from "@/store/auth.store";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { InviteCodeStep } from "@/components/onboarding/steps/InviteCodeStep";
import { CompanyInfoStep } from "@/components/onboarding/steps/CompanyInfoStep";
import { RegionStep } from "@/components/onboarding/steps/RegionStep";
import { SellingModeStep } from "@/components/onboarding/steps/SellingModeStep";
import { RecommendationStep } from "@/components/onboarding/steps/RecommendationStep";
import { ModulesStep } from "@/components/onboarding/steps/ModulesStep";
import { CategoriesStep } from "@/components/onboarding/steps/CategoriesStep";
import { PipelineStep, validatePipeline } from "@/components/onboarding/steps/PipelineStep";
import { BrandingStep, EMPTY_BRANDING_COLORS } from "@/components/onboarding/steps/BrandingStep";
import { AdminStep } from "@/components/onboarding/steps/AdminStep";
import { AgentsStep } from "@/components/onboarding/steps/AgentsStep";
import {
  ConfirmationStep,
  type EditableSection,
} from "@/components/onboarding/steps/ConfirmationStep";
import { SuccessScreen } from "@/components/onboarding/SuccessScreen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import {
  checkInvitationCode,
  createCompanyOnboarding,
  validateLogoFile,
  type OnboardingResult,
} from "@/lib/onboarding";
import {
  DEFAULT_BUSINESS_TYPE_MAX_LENGTH,
  findBusinessType,
  findIndustry,
  getOnboardingTemplates,
  type BusinessModel,
  type ModulesTemplate,
  type OnboardingTemplates,
} from "@/lib/onboarding-templates";
import { EMPTY_REGION, presetForCountry, type CountryPreset } from "@/lib/onboarding-regions";
import {
  buildOnboardingPayload,
  categorySuggestions,
  MANUAL_MODULES,
  NOTHING_EDITED,
  recommendedBusinessType,
  recommendedModelFor,
  suggestionsFrom,
  type AdminState,
  type AgentDraft,
  type BrandingColorState,
  type CompanyInfoState,
  type EditedFlags,
  type PipelineState,
  type WizardState,
} from "@/lib/onboarding-wizard";
import { normalizeCategoryList } from "@/lib/company-settings";
import { PASSWORD_RULES } from "@/lib/password-policy";
import {
  DEFAULT_REGIONAL_LIMITS,
  validateRegionalDraft,
  type RegionalDraft,
  type RegionalDraftErrors,
} from "@/lib/tenant-configuration";

// Misma política que `IsStrongPassword` en el backend; el mensaje nombra lo
// que falta para que la persona sepa qué corregir sin adivinar.
function passwordProblem(password: string): string | null {
  const unmet = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label.toLowerCase());
  if (unmet.length === 0) return null;
  return `La contraseña debe cumplir: ${unmet.join(", ")}.`;
}

type StepKey =
  | "invite"
  | "company"
  | "region"
  | "selling"
  | "recommendation"
  | "modules"
  | "categories"
  | "pipeline"
  | "branding"
  | "admin"
  | "agents"
  | "confirm";

const STEP_LABELS: Record<StepKey, string> = {
  invite: "Código de invitación",
  company: "Datos de empresa",
  region: "Región",
  selling: "Forma de vender",
  recommendation: "Recomendación",
  modules: "Módulos",
  categories: "Categorías",
  pipeline: "Pipeline inicial",
  branding: "Branding (opcional)",
  admin: "Administrador",
  agents: "Asesores",
  confirm: "Confirmación",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FALLBACK_LIMITS = {
  categories: { maxLength: 60, maxCount: 30 },
  stages: { maxNameLength: 40, maxCount: 20 },
  businessType: { maxLength: DEFAULT_BUSINESS_TYPE_MAX_LENGTH },
};

type ApiError = {
  response?: {
    status?: number;
    data?: { message?: string | string[] };
  };
};

function readableMessage(err: unknown): string | undefined {
  const message = (err as ApiError).response?.data?.message;
  return Array.isArray(message) ? message[0] : message;
}

function mapOnboardingError(err: unknown): string {
  const status = (err as ApiError).response?.status;
  const readable = readableMessage(err);
  if (status === 403) {
    return "El código de invitación no es válido o el registro no está disponible.";
  }
  if (status === 409) return readable || "Ya existe un usuario con ese correo.";
  if (status === 400) {
    return readable || "Hay un problema con la información enviada. Revísala e intenta de nuevo.";
  }
  return "No pudimos crear la empresa. Revisa la información e inténtalo nuevamente.";
}

function mapInviteError(err: unknown): string {
  const status = (err as ApiError).response?.status;
  if (status === 400 || status === 403) {
    return readableMessage(err) || "El código de invitación no es válido.";
  }
  if (status === 429) return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
  return "No pudimos comprobar el código. Revisa tu conexión e inténtalo de nuevo.";
}

const SECTION_STEP: Record<EditableSection, StepKey> = {
  company: "company",
  region: "region",
  selling: "selling",
  recommendation: "recommendation",
  modules: "modules",
  categories: "categories",
  pipeline: "pipeline",
  branding: "branding",
  admin: "admin",
  agents: "agents",
};

export default function OnboardingPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const setUser = useAuthStore((s) => s.setUser);

  // ── Plantillas (fuente de verdad: el backend).
  const templatesQuery = useQuery<OnboardingTemplates>({
    queryKey: ["onboarding-templates"],
    queryFn: getOnboardingTemplates,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
  const templates = templatesQuery.data ?? null;
  const templatesLoading = templatesQuery.isPending;
  const templatesError = templatesQuery.isError
    ? "No pudimos cargar las opciones de configuración. Revisa tu conexión e inténtalo de nuevo."
    : "";
  const limits = templates?.limits ?? FALLBACK_LIMITS;
  const businessTypeMaxLength = limits.businessType?.maxLength ?? DEFAULT_BUSINESS_TYPE_MAX_LENGTH;
  const coreModules = templates?.coreModules ?? ["conversations", "contacts", "leads", "pipeline"];

  // ── Estado del asistente (en memoria: atrás/adelante no pierde nada, un
  // error del servidor no reinicia, y recargar la página empieza de cero a
  // propósito: aquí no se guarda ni el código ni ninguna contraseña).
  const [step, setStep] = useState<StepKey>("invite");
  const [stepError, setStepError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const submittingRef = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  const [inviteCode, setInviteCode] = useState("");
  const [company, setCompany] = useState<CompanyInfoState>({
    name: "",
    city: "",
    phone: "",
    email: "",
    website: "",
    description: "",
  });
  const [industry, setIndustry] = useState("generic");
  const [regional, setRegional] = useState<RegionalDraft>({ ...EMPTY_REGION });
  const [regionErrors, setRegionErrors] = useState<RegionalDraftErrors>({});
  const [pendingPreset, setPendingPreset] = useState<CountryPreset | null>(null);
  const [businessModel, setBusinessModel] = useState<BusinessModel>("mixed");
  const [businessType, setBusinessType] = useState("");
  const [typeChosen, setTypeChosen] = useState(false);
  const [customBusinessType, setCustomBusinessType] = useState("");
  const [modules, setModules] = useState<ModulesTemplate>({ ...MANUAL_MODULES });
  const [categories, setCategories] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<PipelineState>({ name: "Ventas", stages: [] });
  // Procedencia por sección: lo que decide si un cambio anterior puede
  // reemplazar el contenido en silencio o debe preguntar.
  const [edited, setEdited] = useState<EditedFlags>({ ...NOTHING_EDITED });
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);

  const [colors, setColors] = useState<BrandingColorState>({ ...EMPTY_BRANDING_COLORS });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [secondaryLogoFile, setSecondaryLogoFile] = useState<File | null>(null);
  const [admin, setAdmin] = useState<AdminState>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [agents, setAgents] = useState<AgentDraft[]>([]);

  const industryTemplate = findIndustry(templates, industry);
  const selectedType = findBusinessType(templates, industry, businessType);
  const recommendedType = recommendedBusinessType(industryTemplate, businessModel);
  const canRestore = Boolean(selectedType && !selectedType.manual);
  // Lo que una plantilla nueva REEMPLAZARÍA: módulos, categorías y etapas. La
  // forma de vender elegida se conserva siempre, así que no motiva la pregunta.
  const sectionsEdited = edited.modules || edited.categories || edited.pipeline;
  const anySectionEdited = sectionsEdited || edited.businessModel;

  const state: WizardState = {
    company,
    industry,
    regional,
    businessModel,
    businessType,
    customBusinessType,
    modules,
    categories,
    pipeline,
    colors,
    admin,
    agents,
  };
  const suggestions = categorySuggestions(templates, state);

  // Pasos visibles: «Categorías» solo existe cuando hay catálogo.
  const steps = useMemo<StepKey[]>(
    () => [
      "invite",
      "company",
      "region",
      "selling",
      "recommendation",
      "modules",
      ...(modules.catalog ? (["categories"] as StepKey[]) : []),
      "pipeline",
      "branding",
      "admin",
      "agents",
      "confirm",
    ],
    [modules.catalog],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLastStep = stepIndex === steps.length - 1;

  // El error se anuncia y recibe el foco: sin esto, quien navega con teclado
  // o lector de pantalla pulsa «Siguiente» y no pasa nada visible.
  useEffect(() => {
    if (stepError || submitError) alertRef.current?.focus();
  }, [stepError, submitError]);

  // Al cambiar de paso, el foco va al encabezado del paso nuevo.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // ── Recomendaciones y protección de ediciones ────────────────────────────

  function applySelection(typeKey: string, replaceEdited: boolean) {
    const type = findBusinessType(templates, industry, typeKey);
    const s = suggestionsFrom(type);
    setBusinessType(typeKey);
    if (!type?.manual) setCustomBusinessType("");
    if (type && (replaceEdited || !edited.businessModel)) setBusinessModel(type.businessModel);
    if (replaceEdited || !edited.modules) setModules(s.modules);
    if (replaceEdited || !edited.categories) setCategories(s.categories);
    if (replaceEdited || !edited.pipeline) setPipeline(s.pipeline);
    if (replaceEdited) setEdited((e) => ({ ...NOTHING_EDITED, regional: e.regional }));
  }

  function requestSelection(typeKey: string) {
    setStepError("");
    if (sectionsEdited) {
      // No se reemplaza en silencio lo que la persona ya cambió.
      setPendingSelection(typeKey);
      return;
    }
    applySelection(typeKey, true);
  }

  function handleIndustryChange(nextIndustry: string) {
    const nextTemplate = findIndustry(templates, nextIndustry);
    setIndustry(nextIndustry);
    setTypeChosen(false);
    const model = edited.businessModel ? businessModel : recommendedModelFor(nextTemplate);
    if (!edited.businessModel) setBusinessModel(model);
    const rec = recommendedBusinessType(nextTemplate, model);
    if (rec) requestSelectionFor(nextIndustry, rec.key);
    else setBusinessType("");
  }

  // Igual que requestSelection pero para una industria recién elegida (el
  // estado `industry` aún no está actualizado en este render).
  function requestSelectionFor(industryKey: string, typeKey: string) {
    const type = findBusinessType(templates, industryKey, typeKey);
    if (sectionsEdited) {
      setPendingSelection(typeKey);
      return;
    }
    const s = suggestionsFrom(type);
    setBusinessType(typeKey);
    setCustomBusinessType("");
    if (type && !edited.businessModel) setBusinessModel(type.businessModel);
    setModules(s.modules);
    setCategories(s.categories);
    setPipeline(s.pipeline);
    setEdited((e) => ({ ...NOTHING_EDITED, regional: e.regional }));
  }

  function handleModelChange(model: BusinessModel) {
    setBusinessModel(model);
    setEdited((e) => ({ ...e, businessModel: true }));
    setStepError("");
    // Si la persona aún no eligió plantilla, la recomendación sigue a su
    // forma de vender.
    if (!typeChosen) {
      const rec = recommendedBusinessType(industryTemplate, model);
      if (rec && rec.key !== businessType) {
        if (edited.modules || edited.categories || edited.pipeline) setPendingSelection(rec.key);
        else applySelectionKeepingModel(rec.key, model);
      }
    }
  }

  function applySelectionKeepingModel(typeKey: string, model: BusinessModel) {
    const type = findBusinessType(templates, industry, typeKey);
    const s = suggestionsFrom(type);
    setBusinessType(typeKey);
    if (!type?.manual) setCustomBusinessType("");
    setBusinessModel(model);
    setModules(s.modules);
    setCategories(s.categories);
    setPipeline(s.pipeline);
    setEdited((e) => ({ ...NOTHING_EDITED, regional: e.regional, businessModel: true }));
  }

  function handleSelectType(typeKey: string) {
    setTypeChosen(true);
    requestSelection(typeKey);
  }

  function resetAll() {
    const key = businessType || recommendedType?.key;
    if (!key) return;
    setTypeChosen(false);
    applySelection(key, true);
  }

  function restore(section: "modules" | "categories" | "pipeline") {
    const s = suggestionsFrom(selectedType);
    if (section === "modules") setModules(s.modules);
    if (section === "categories") setCategories(s.categories);
    if (section === "pipeline") setPipeline(s.pipeline);
    setEdited((e) => ({ ...e, [section]: false }));
  }

  function patchModules(patch: Partial<ModulesTemplate>) {
    setModules((prev) => ({ ...prev, ...patch }));
    setEdited((e) => ({ ...e, modules: true }));
  }
  function changeCategories(next: string[]) {
    setCategories(next);
    setEdited((e) => ({ ...e, categories: true }));
  }
  function patchPipeline(patch: Partial<PipelineState>) {
    setPipeline((prev) => ({ ...prev, ...patch }));
    setEdited((e) => ({ ...e, pipeline: true }));
  }
  function patchCompany(patch: Partial<CompanyInfoState>) {
    setCompany((prev) => ({ ...prev, ...patch }));
  }
  function patchColors(patch: Partial<BrandingColorState>) {
    setColors((prev) => ({ ...prev, ...patch }));
  }
  function patchAdmin(patch: Partial<AdminState>) {
    setAdmin((prev) => ({ ...prev, ...patch }));
  }

  // ── Región: el país propone; lo editado a mano no se pisa en silencio.
  function handleCountryChange(country: string, preset: CountryPreset | undefined) {
    setStepError("");
    setRegionErrors((e) => ({ ...e, country: undefined }));
    if (!preset) {
      setRegional((r) => ({ ...r, country }));
      return;
    }
    if (edited.regional) {
      setRegional((r) => ({ ...r, country: preset.name }));
      setPendingPreset(preset);
      return;
    }
    setPendingPreset(null);
    setRegional({ country: preset.name, timezone: preset.timezone, currency: preset.currency, locale: preset.locale });
  }
  function handleRegionalField(field: Exclude<keyof RegionalDraft, "country">, value: string) {
    setRegional((r) => ({ ...r, [field]: value }));
    setEdited((e) => ({ ...e, regional: true }));
    setRegionErrors((e) => ({ ...e, [field]: undefined }));
  }
  function applyPreset(preset: CountryPreset) {
    setRegional({ country: preset.name, timezone: preset.timezone, currency: preset.currency, locale: preset.locale });
    setEdited((e) => ({ ...e, regional: false }));
    setRegionErrors({});
    setPendingPreset(null);
  }

  // ── Validación por paso ─────────────────────────────────────────────────

  function validateCurrentStep(): string | null {
    switch (step) {
      case "invite":
        if (!inviteCode.trim()) return "Ingresa el código de invitación.";
        return null;
      case "company":
        if (!company.name.trim()) return "El nombre de la empresa es requerido.";
        if (!templates) return "Espera a que carguen las opciones o reintenta.";
        if (!industryTemplate) return "Elige una industria.";
        return null;
      case "region": {
        if (!regional.country.trim()) {
          setRegionErrors({ country: "Elige o escribe el país." });
          return "Elige el país donde opera tu empresa.";
        }
        const errors = validateRegionalDraft(regional, DEFAULT_REGIONAL_LIMITS);
        setRegionErrors(errors);
        if (Object.keys(errors).length > 0) return "Revisa los campos de región marcados.";
        return null;
      }
      case "selling":
        return null;
      case "recommendation": {
        if (!templates) return "Espera a que carguen las opciones o reintenta.";
        const current = selectedType ?? recommendedType;
        if (!current) return "Elige una plantilla (o «Configurar manualmente»).";
        if (current.manual) {
          const text = customBusinessType.replace(/\s+/g, " ").trim();
          if (!text) return "Describe tu tipo de negocio para continuar con la configuración manual.";
          if (text.length > businessTypeMaxLength) {
            return `La descripción del tipo de negocio debe tener como máximo ${businessTypeMaxLength} caracteres.`;
          }
        }
        return null;
      }
      case "modules":
        return null;
      case "categories": {
        const { error } = normalizeCategoryList(categories, limits.categories);
        return error;
      }
      case "pipeline":
        return validatePipeline(pipeline, limits.stages);
      case "branding": {
        if (logoFile) {
          const error = validateLogoFile(logoFile);
          if (error) return error;
        }
        if (secondaryLogoFile) {
          const error = validateLogoFile(secondaryLogoFile);
          if (error) return error;
        }
        return null;
      }
      case "admin":
        if (!admin.name.trim()) return "El nombre del administrador es requerido.";
        if (!EMAIL_REGEX.test(admin.email.trim())) return "El email del administrador no es válido.";
        {
          const problem = passwordProblem(admin.password);
          if (problem) return problem;
        }
        if (admin.password !== admin.confirmPassword) return "Las contraseñas no coinciden.";
        return null;
      case "agents": {
        const seen = new Set([admin.email.trim().toLowerCase()]);
        for (const agent of agents) {
          if (!agent.name.trim() || !agent.email.trim() || !agent.password) {
            return "Completa nombre, email y contraseña de cada asesor, o elimínalo.";
          }
          const email = agent.email.trim().toLowerCase();
          if (!EMAIL_REGEX.test(email)) return `El email de "${agent.name || "un asesor"}" no es válido.`;
          if (seen.has(email)) return `El email "${agent.email.trim()}" está repetido.`;
          seen.add(email);
          const problem = passwordProblem(agent.password);
          if (problem) {
            return `Asesor ${agents.indexOf(agent) + 1} (${agent.name.trim() || "sin nombre"}): ${problem}`;
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  async function goNext() {
    const error = validateCurrentStep();
    if (error) {
      setStepError(error);
      return;
    }
    setStepError("");

    if (step === "invite") {
      // Se comprueba SIN consumir: un código malo se descubre aquí y no tras
      // rellenar todo el asistente. Nunca viaja en la URL ni se guarda.
      setBusy(true);
      try {
        await checkInvitationCode(inviteCode.trim());
      } catch (err) {
        setStepError(mapInviteError(err));
        return;
      } finally {
        setBusy(false);
      }
    }

    if (step === "region" && !edited.businessModel) {
      // La forma de vender arranca con lo que la industria suele hacer; si la
      // persona no la tocó, no hay nada que proteger.
      setBusinessModel(recommendedModelFor(industryTemplate));
    }

    if (step === "selling" && !typeChosen && recommendedType && recommendedType.key !== businessType) {
      // Entrar a la recomendación: la plantilla recomendada se aplica a las
      // secciones que la persona aún no ha tocado.
      applySelection(recommendedType.key, false);
    }

    setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  }

  function goBack() {
    setStepError("");
    setStep(steps[Math.max(stepIndex - 1, 0)]);
  }

  function goToSection(section: EditableSection) {
    setStepError("");
    setSubmitError("");
    setStep(SECTION_STEP[section]);
  }

  const payload = useMemo(
    () => buildOnboardingPayload(state, templates, limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company, industry, regional, businessModel, businessType, customBusinessType, modules, categories, pipeline, colors, admin, agents, templates, limits],
  );

  async function handleSubmit() {
    // Guarda de reentrada además del botón deshabilitado: dos clics seguidos
    // o Enter repetido no pueden mandar dos peticiones.
    if (submittingRef.current) return;
    const error = validateCurrentStep();
    if (error) {
      setStepError(error);
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setSubmitError("");
    try {
      const response = await createCompanyOnboarding(
        payload,
        { logo: logoFile ?? undefined, secondaryLogo: secondaryLogoFile ?? undefined },
        inviteCode.trim(),
      );

      if (response.token && response.user) {
        setSession(response.user, response.token);
        try {
          // Igual que el login: el resultado solo trae id/email/name; el rol
          // y la empresa se completan con /auth/me antes de entrar.
          const fullUser = await getMe();
          setUser(fullUser);
          router.push("/dashboard");
          return;
        } catch {
          // La empresa YA existe: no se muestra un error de creación falso;
          // se ofrece iniciar sesión.
          setResult(response);
          return;
        }
      }
      setResult(response);
    } catch (err) {
      // El estado del asistente se conserva tal cual para corregir y reintentar.
      setSubmitError(mapOnboardingError(err));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (result) {
    return (
      <SuccessScreen
        companyName={result.company.name}
        slug={result.company.slug}
        logoUrl={result.company.logoUrl}
        onGoToLogin={() => router.push("/login?created=1")}
      />
    );
  }

  const pendingType = pendingSelection ? findBusinessType(templates, industry, pendingSelection) : undefined;

  return (
    // El alta de una empresa ocurre ANTES de que exista esa empresa: aquí no
    // hay identidad de cliente que respetar todavía, así que manda TAKTO.
    <div className="flex min-h-screen flex-1 flex-col bg-neutral-50 lg:flex-row">
      <OnboardingProgress current={stepIndex} labels={steps.map((k) => STEP_LABELS[k])} />

      <div className="flex flex-1 items-start justify-center px-4 py-6 sm:px-8 sm:py-8">
        <Card padding="lg" className="w-full max-w-xl">
          <div ref={headingRef} tabIndex={-1} className="outline-none" aria-live="polite">
            <p className="text-xs font-medium uppercase tracking-wide text-content-secondary">
              Paso {stepIndex + 1} de {steps.length}
            </p>
          </div>

          {step === "invite" && <InviteCodeStep value={inviteCode} onChange={setInviteCode} />}
          {step === "company" && (
            <CompanyInfoStep
              value={company}
              onChange={patchCompany}
              templates={templates}
              templatesLoading={templatesLoading}
              templatesError={templatesError}
              onRetryTemplates={() => void templatesQuery.refetch()}
              industry={industry}
              onIndustryChange={handleIndustryChange}
            />
          )}
          {step === "region" && (
            <RegionStep
              value={regional}
              errors={regionErrors}
              limits={DEFAULT_REGIONAL_LIMITS}
              edited={edited.regional}
              onCountryChange={handleCountryChange}
              onFieldChange={handleRegionalField}
              onApplyPreset={() => {
                const preset = presetForCountry(regional.country);
                if (preset) applyPreset(preset);
              }}
              pendingPreset={pendingPreset}
              onKeepMine={() => setPendingPreset(null)}
              onApplyPending={() => pendingPreset && applyPreset(pendingPreset)}
            />
          )}
          {step === "selling" && (
            <SellingModeStep
              value={businessModel}
              recommended={recommendedModelFor(industryTemplate)}
              onChange={handleModelChange}
            />
          )}
          {step === "recommendation" && (
            <RecommendationStep
              industry={industryTemplate}
              selected={selectedType}
              recommended={recommendedType}
              model={businessModel}
              customBusinessType={customBusinessType}
              businessTypeMaxLength={businessTypeMaxLength}
              anyEdited={anySectionEdited}
              onSelectType={handleSelectType}
              onCustomBusinessTypeChange={setCustomBusinessType}
              onResetAll={resetAll}
            />
          )}
          {step === "modules" && (
            <ModulesStep
              value={modules}
              onChange={patchModules}
              coreModules={coreModules}
              edited={edited.modules}
              canRestore={canRestore}
              onRestore={() => restore("modules")}
            />
          )}
          {step === "categories" && (
            <CategoriesStep
              value={categories}
              onChange={changeCategories}
              suggestions={suggestions}
              limits={limits.categories}
              edited={edited.categories}
              canRestore={canRestore}
              onRestore={() => restore("categories")}
            />
          )}
          {step === "pipeline" && (
            <PipelineStep
              value={pipeline}
              onChange={patchPipeline}
              limits={limits.stages}
              edited={edited.pipeline}
              canRestore={canRestore}
              onRestore={() => restore("pipeline")}
            />
          )}
          {step === "branding" && (
            <BrandingStep
              colors={colors}
              onColorsChange={patchColors}
              logoFile={logoFile}
              onLogoChange={setLogoFile}
              secondaryLogoFile={secondaryLogoFile}
              onSecondaryLogoChange={setSecondaryLogoFile}
            />
          )}
          {step === "admin" && <AdminStep value={admin} onChange={patchAdmin} />}
          {step === "agents" && <AgentsStep value={agents} onChange={setAgents} />}
          {step === "confirm" && (
            <ConfirmationStep
              payload={payload}
              templates={templates}
              coreModules={coreModules}
              hasLogo={!!logoFile}
              hasSecondaryLogo={!!secondaryLogoFile}
              onEdit={goToSection}
            />
          )}

          {/* `role="alert"` y foco: el error aparece al intentar avanzar y se
              anuncia; el foco va al mensaje para que no pase inadvertido. */}
          {(stepError || submitError) && (
            <p
              ref={alertRef}
              tabIndex={-1}
              role="alert"
              className="mt-4 rounded-md border border-status-error/30 bg-status-error-surface px-3 py-2 text-sm text-status-error outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              {stepError || submitError}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-line-default pt-5">
            <Button variant="quiet" onClick={goBack} disabled={stepIndex === 0 || busy} className="px-4 py-2">
              Atrás
            </Button>

            {isLastStep ? (
              <Button onClick={() => void handleSubmit()} disabled={busy} className="px-6 py-2.5">
                {busy ? "Creando empresa..." : "Crear empresa"}
              </Button>
            ) : (
              <Button onClick={() => void goNext()} disabled={busy} className="px-6 py-2.5">
                {busy && step === "invite" ? "Comprobando..." : "Siguiente"}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {pendingSelection && (
        <Modal
          title="¿Aplicar las nuevas recomendaciones?"
          onClose={() => {
            applySelection(pendingSelection, false);
            setPendingSelection(null);
          }}
          maxWidth="sm"
          stackedZIndex
        >
          <p className="text-sm text-content-secondary">
            Ya personalizaste tu forma de vender, módulos, categorías o etapas. Con la plantilla{" "}
            <strong>{pendingType?.name ?? "elegida"}</strong> puedes conservar esos cambios (solo se
            actualizará lo que no hayas editado) o reemplazarlos por las nuevas recomendaciones.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                applySelection(pendingSelection, false);
                setPendingSelection(null);
              }}
            >
              Conservar mis cambios
            </Button>
            <Button
              onClick={() => {
                applySelection(pendingSelection, true);
                setPendingSelection(null);
              }}
            >
              Aplicar las nuevas recomendaciones
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
