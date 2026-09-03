"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { useAuthStore } from "@/store/auth.store";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { InviteCodeStep } from "@/components/onboarding/steps/InviteCodeStep";
import { CompanyInfoStep, CompanyInfoState } from "@/components/onboarding/steps/CompanyInfoStep";
import { IndustryStep, IndustrySelection } from "@/components/onboarding/steps/IndustryStep";
import { ModulesStep } from "@/components/onboarding/steps/ModulesStep";
import { CategoriesStep } from "@/components/onboarding/steps/CategoriesStep";
import {
  PipelineStep,
  PipelineState,
  validatePipeline,
} from "@/components/onboarding/steps/PipelineStep";
import {
  BrandingStep,
  BrandingColorState,
  EMPTY_BRANDING_COLORS,
} from "@/components/onboarding/steps/BrandingStep";
import { AdminStep, AdminState } from "@/components/onboarding/steps/AdminStep";
import { AgentsStep, AgentDraft } from "@/components/onboarding/steps/AgentsStep";
import { ConfirmationStep } from "@/components/onboarding/steps/ConfirmationStep";
import { SuccessScreen } from "@/components/onboarding/SuccessScreen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  createCompanyOnboarding,
  validateLogoFile,
  OnboardingResult,
} from "@/lib/onboarding";
import {
  categorySuggestionsFor,
  findBusinessType,
  findIndustry,
  flagsForModel,
  getOnboardingTemplates,
  type BusinessModel,
  type BusinessTypeTemplate,
  type ModulesTemplate,
  type OnboardingTemplates,
} from "@/lib/onboarding-templates";
import { normalizeCategoryList } from "@/lib/company-settings";

type StepKey =
  | "invite"
  | "company"
  | "industry"
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
  industry: "Industria y tipo de negocio",
  modules: "Módulos",
  categories: "Categorías",
  pipeline: "Pipeline inicial",
  branding: "Branding (opcional)",
  admin: "Administrador",
  agents: "Asesores",
  confirm: "Confirmación",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sin plantilla todavía (o «Configurar manualmente»): lo mínimo, todo editable.
const MANUAL_MODULES: ModulesTemplate = { catalog: false, quotes: false, tasks: true };
const FALLBACK_LIMITS = {
  categories: { maxLength: 60, maxCount: 30 },
  stages: { maxNameLength: 40, maxCount: 20 },
};

type ApiError = {
  response?: {
    status?: number;
    data?: { message?: string | string[] };
  };
};

function mapOnboardingError(err: unknown): string {
  const response = (err as ApiError).response;
  const status = response?.status;
  const message = response?.data?.message;
  const readable = Array.isArray(message) ? message[0] : message;

  if (status === 403) {
    return "El código de invitación no es válido o el registro no está disponible.";
  }
  if (status === 409) {
    return readable || "Ya existe un usuario con ese correo.";
  }
  if (status === 400) {
    return readable || "Hay un problema con la información enviada. Revísala e intenta de nuevo.";
  }
  return "No pudimos crear la empresa. Revisa la información e inténtalo nuevamente.";
}

/** Lo que una plantilla sugiere para las tres secciones editables. */
function suggestionsFrom(type: BusinessTypeTemplate | undefined): {
  modules: ModulesTemplate;
  categories: string[];
  pipeline: PipelineState;
} {
  if (!type) {
    return {
      modules: { ...MANUAL_MODULES },
      categories: [],
      pipeline: { name: "Ventas", stages: [] },
    };
  }
  return {
    modules: { ...type.modules },
    categories: [...type.categories],
    pipeline: {
      name: type.pipeline.name,
      stages: type.pipeline.stages.map((s) => ({ ...s })),
    },
  };
}

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
  const loadTemplates = () => templatesQuery.refetch();
  const limits = templates?.limits ?? FALLBACK_LIMITS;
  const coreModules = templates?.coreModules ?? ["conversations", "contacts", "leads", "pipeline"];

  // ── Estado del asistente.
  const [step, setStep] = useState<StepKey>("invite");
  const [stepError, setStepError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<OnboardingResult | null>(null);

  const [inviteCode, setInviteCode] = useState("");
  const [company, setCompany] = useState<CompanyInfoState>({
    name: "",
    businessType: "",
    city: "",
    country: "",
    phone: "",
    email: "",
    website: "",
    description: "",
  });
  const [selection, setSelection] = useState<IndustrySelection>({
    industry: "generic",
    businessType: "",
    businessModel: "mixed",
  });
  const [modules, setModules] = useState<ModulesTemplate>({ ...MANUAL_MODULES });
  const [categories, setCategories] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<PipelineState>({ name: "Ventas", stages: [] });
  // «Sugerido» frente a «editado», por sección: lo que decide si un cambio de
  // plantilla puede reemplazar el contenido en silencio o debe preguntar.
  const [edited, setEdited] = useState({ modules: false, categories: false, pipeline: false });
  const [pendingSelection, setPendingSelection] = useState<IndustrySelection | null>(null);

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

  const industry = findIndustry(templates, selection.industry);
  const businessType = findBusinessType(templates, selection.industry, selection.businessType);
  const canRestore = Boolean(businessType && !businessType.manual);
  const categorySuggestions = categorySuggestionsFor(industry, businessType);

  // Pasos visibles: «Categorías» solo existe cuando hay catálogo.
  const steps = useMemo<StepKey[]>(
    () => [
      "invite",
      "company",
      "industry",
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

  // ── Aplicar una plantilla a las secciones (todas o solo las no editadas).
  function applySelection(next: IndustrySelection, replaceEdited: boolean) {
    const type = findBusinessType(templates, next.industry, next.businessType);
    const s = suggestionsFrom(type);
    const model: BusinessModel = type ? type.businessModel : next.businessModel;
    setSelection({ ...next, businessModel: model });
    if (replaceEdited || !edited.modules) setModules(s.modules);
    if (replaceEdited || !edited.categories) setCategories(s.categories);
    if (replaceEdited || !edited.pipeline) setPipeline(s.pipeline);
    if (replaceEdited) setEdited({ modules: false, categories: false, pipeline: false });
  }

  function requestSelection(next: IndustrySelection) {
    setStepError("");
    const anyEdited = edited.modules || edited.categories || edited.pipeline;
    if (anyEdited) {
      // No se reemplaza en silencio lo que la persona ya cambió.
      setPendingSelection(next);
      return;
    }
    applySelection(next, true);
  }

  function handleIndustryChange(industryKey: string) {
    const first = findIndustry(templates, industryKey)?.businessTypes[0];
    requestSelection({
      industry: industryKey,
      businessType: first?.key ?? "",
      businessModel: first?.businessModel ?? selection.businessModel,
    });
  }

  function handleBusinessTypeChange(typeKey: string) {
    requestSelection({ ...selection, businessType: typeKey });
  }

  function restore(section: "modules" | "categories" | "pipeline") {
    const s = suggestionsFrom(businessType);
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

  function validateCurrentStep(): string | null {
    switch (step) {
      case "invite":
        if (!inviteCode.trim()) return "Ingresa el código de invitación.";
        return null;
      case "company":
        if (!company.name.trim()) return "El nombre de la empresa es requerido.";
        return null;
      case "industry":
        if (!templates) return "Espera a que carguen las opciones o reintenta.";
        if (!industry) return "Elige una industria.";
        if (!businessType) return "Elige un tipo de negocio (o «Otro / Configurar manualmente»).";
        return null;
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
        if (admin.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
        if (admin.password !== admin.confirmPassword) return "Las contraseñas no coinciden.";
        return null;
      case "agents": {
        const seen = new Set([admin.email.trim().toLowerCase()]);
        for (const agent of agents) {
          if (!agent.name.trim() || !agent.email.trim() || !agent.password) {
            return "Completa nombre, email y contraseña de cada asesor, o elimínalo.";
          }
          const email = agent.email.trim().toLowerCase();
          if (!EMAIL_REGEX.test(email)) {
            return `El email de "${agent.name || "un asesor"}" no es válido.`;
          }
          if (seen.has(email)) {
            return `El email "${agent.email.trim()}" está repetido.`;
          }
          seen.add(email);
          if (agent.password.length < 8) {
            return `La contraseña de "${agent.name || "un asesor"}" debe tener al menos 8 caracteres.`;
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  function goNext() {
    const error = validateCurrentStep();
    if (error) {
      setStepError(error);
      return;
    }
    setStepError("");
    setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  }

  function goBack() {
    setStepError("");
    setStep(steps[Math.max(stepIndex - 1, 0)]);
  }

  async function handleSubmit() {
    const error = validateCurrentStep();
    if (error) {
      setStepError(error);
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    try {
      const { categories: cleanCategories } = normalizeCategoryList(
        categories,
        limits.categories,
      );
      const payload = {
        company: {
          name: company.name.trim(),
          businessType: company.businessType.trim() || undefined,
          city: company.city.trim() || undefined,
          country: company.country.trim() || undefined,
          phone: company.phone.trim() || undefined,
          email: company.email.trim() || undefined,
          website: company.website.trim() || undefined,
          description: company.description.trim() || undefined,
        },
        // Solo se envía lo que la empresa eligió; vacío = apariencia TAKTO.
        branding: {
          primaryColor: colors.primaryColor.trim() || undefined,
          accentColor: colors.accentColor.trim() || undefined,
          backgroundColor: colors.backgroundColor.trim() || undefined,
        },
        commercial: {
          ...flagsForModel(selection.businessModel),
          usesCatalog: modules.catalog,
          usesQuotes: modules.quotes,
          usesTasks: modules.tasks,
          categories: modules.catalog ? cleanCategories : [],
          industry: selection.industry,
          businessType: selection.businessType,
          businessModel: selection.businessModel,
        },
        pipeline: {
          name: pipeline.name.trim(),
          typedStages: pipeline.stages.map((s) => ({
            name: s.name.replace(/\s+/g, " ").trim(),
            type: s.type,
          })),
          templateKey: selection.businessType,
        },
        admin: {
          name: admin.name.trim(),
          email: admin.email.trim(),
          password: admin.password,
        },
        agents: agents.map((agent) => ({
          name: agent.name.trim(),
          email: agent.email.trim(),
          password: agent.password,
          role: "AGENT" as const,
        })),
      };

      const response = await createCompanyOnboarding(
        payload,
        { logo: logoFile ?? undefined, secondaryLogo: secondaryLogoFile ?? undefined },
        inviteCode,
      );

      if (response.token && response.user) {
        // Same two-step pattern as the normal login: the onboarding response
        // only carries id/email/name, so backfill role/companyId via
        // /auth/me before sending the new admin into the dashboard.
        setSession(response.user, response.token);
        const fullUser = await getMe();
        setUser(fullUser);
        router.push("/dashboard");
        return;
      }

      setResult(response);
    } catch (err) {
      setSubmitError(mapOnboardingError(err));
    } finally {
      setSubmitting(false);
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

  const pendingType = pendingSelection
    ? findBusinessType(templates, pendingSelection.industry, pendingSelection.businessType)
    : undefined;

  return (
    // El alta de una empresa ocurre ANTES de que exista esa empresa: aquí no
    // hay identidad de cliente que respetar todavía, así que manda TAKTO.
    <div className="flex min-h-screen flex-1 flex-col bg-neutral-50 lg:flex-row">
      <OnboardingProgress current={stepIndex} labels={steps.map((k) => STEP_LABELS[k])} />

      <div className="flex flex-1 items-start justify-center px-4 py-8 sm:px-8">
        <Card padding="lg" className="w-full max-w-xl">
          {step === "invite" && <InviteCodeStep value={inviteCode} onChange={setInviteCode} />}
          {step === "company" && <CompanyInfoStep value={company} onChange={patchCompany} />}
          {step === "industry" && (
            <IndustryStep
              templates={templates}
              loading={templatesLoading}
              loadError={templatesError}
              onRetry={() => void loadTemplates()}
              value={selection}
              onIndustryChange={handleIndustryChange}
              onBusinessTypeChange={handleBusinessTypeChange}
              onBusinessModelChange={(businessModel) =>
                setSelection((prev) => ({ ...prev, businessModel }))
              }
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
              suggestions={categorySuggestions}
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
              companyName={company.name}
              businessTypeLabel={company.businessType}
              city={company.city}
              country={company.country}
              industryName={industry?.name ?? ""}
              businessTypeName={businessType?.name ?? ""}
              selection={selection}
              coreModules={coreModules}
              modules={modules}
              categories={categories}
              pipeline={pipeline}
              hasLogo={!!logoFile}
              hasSecondaryLogo={!!secondaryLogoFile}
              primaryColor={colors.primaryColor}
              accentColor={colors.accentColor}
              adminName={admin.name}
              adminEmail={admin.email}
              agentsCount={agents.length}
            />
          )}

          {/* `role="alert"`: el error aparece al intentar avanzar, y sin esto
              un lector de pantalla no lo menciona nunca. */}
          {stepError && (
            <p role="alert" className="mt-4 text-sm text-status-error">
              {stepError}
            </p>
          )}
          {submitError && (
            <p role="alert" className="mt-4 text-sm text-status-error">
              {submitError}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-line-default pt-5">
            <Button
              variant="quiet"
              onClick={goBack}
              disabled={stepIndex === 0 || submitting}
              className="px-4 py-2"
            >
              Atrás
            </Button>

            {isLastStep ? (
              <Button onClick={handleSubmit} disabled={submitting} className="px-6 py-2.5">
                {submitting ? "Creando empresa..." : "Crear empresa"}
              </Button>
            ) : (
              <Button onClick={goNext} className="px-6 py-2.5">
                Siguiente
              </Button>
            )}
          </div>
        </Card>
      </div>

      {pendingSelection && (
        <ConfirmDialog
          title="¿Reemplazar tus cambios?"
          message={
            <p>
              Ya personalizaste módulos, categorías o etapas. Si aplicas las sugerencias de
              {" "}
              <strong>{pendingType?.name ?? "la nueva plantilla"}</strong>, esos cambios se
              reemplazarán. Si prefieres conservarlos, solo se actualizará lo que no hayas
              editado.
            </p>
          }
          confirmLabel="Aplicar sugerencias"
          confirmVariant="primary"
          onClose={() => {
            applySelection(pendingSelection, false);
            setPendingSelection(null);
          }}
          onConfirm={async () => {
            applySelection(pendingSelection, true);
            setPendingSelection(null);
          }}
        />
      )}
    </div>
  );
}
