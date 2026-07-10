"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { InviteCodeStep } from "@/components/onboarding/steps/InviteCodeStep";
import { CompanyInfoStep, CompanyInfoState } from "@/components/onboarding/steps/CompanyInfoStep";
import { BrandingStep, BrandingColorState } from "@/components/onboarding/steps/BrandingStep";
import { CommercialStep, CommercialState } from "@/components/onboarding/steps/CommercialStep";
import { PipelineStep, PipelineState } from "@/components/onboarding/steps/PipelineStep";
import { AdminStep, AdminState } from "@/components/onboarding/steps/AdminStep";
import { AgentsStep, AgentDraft } from "@/components/onboarding/steps/AgentsStep";
import { ConfirmationStep } from "@/components/onboarding/steps/ConfirmationStep";
import { SuccessScreen } from "@/components/onboarding/SuccessScreen";
import {
  createCompanyOnboarding,
  validateLogoFile,
  OnboardingResult,
} from "@/lib/onboarding";

const STEP_LABELS = [
  "Código de invitación",
  "Datos de empresa",
  "Branding",
  "Configuración comercial",
  "Pipeline inicial",
  "Administrador",
  "Asesores",
  "Confirmación",
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
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
  const [colors, setColors] = useState<BrandingColorState>({
    primaryColor: "#A57014",
    accentColor: "#FDDC7F",
    backgroundColor: "#FAF8F3",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [secondaryLogoFile, setSecondaryLogoFile] = useState<File | null>(null);
  const [commercial, setCommercial] = useState<CommercialState>({
    sellsProducts: true,
    sellsServices: false,
    usesCatalog: true,
    usesQuotes: false,
    usesTasks: true,
    categories: [],
  });
  const [pipeline, setPipeline] = useState<PipelineState>({
    name: "Ventas",
    stages: [
      "Nuevo lead",
      "Contactado",
      "Asesoría en proceso",
      "Cotización",
      "Seguimiento",
      "Cerrado ganado",
      "Cerrado perdido",
    ],
  });
  const [admin, setAdmin] = useState<AdminState>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [agents, setAgents] = useState<AgentDraft[]>([]);

  function patchCompany(patch: Partial<CompanyInfoState>) {
    setCompany((prev) => ({ ...prev, ...patch }));
  }
  function patchColors(patch: Partial<BrandingColorState>) {
    setColors((prev) => ({ ...prev, ...patch }));
  }
  function patchCommercial(patch: Partial<CommercialState>) {
    setCommercial((prev) => ({ ...prev, ...patch }));
  }
  function patchPipeline(patch: Partial<PipelineState>) {
    setPipeline((prev) => ({ ...prev, ...patch }));
  }
  function patchAdmin(patch: Partial<AdminState>) {
    setAdmin((prev) => ({ ...prev, ...patch }));
  }

  function validateCurrentStep(): string | null {
    switch (step) {
      case 0:
        if (!inviteCode.trim()) return "Ingresa el código de invitación.";
        return null;
      case 1:
        if (!company.name.trim()) return "El nombre de la empresa es requerido.";
        return null;
      case 2: {
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
      case 3:
        return null;
      case 4:
        if (!pipeline.name.trim()) return "El nombre del pipeline es requerido.";
        if (pipeline.stages.filter((s) => s.trim()).length < 1) {
          return "El pipeline debe tener al menos una etapa.";
        }
        return null;
      case 5:
        if (!admin.name.trim()) return "El nombre del administrador es requerido.";
        if (!EMAIL_REGEX.test(admin.email.trim())) return "El email del administrador no es válido.";
        if (admin.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
        if (admin.password !== admin.confirmPassword) return "Las contraseñas no coinciden.";
        return null;
      case 6:
        for (const agent of agents) {
          if (!agent.name.trim() || !agent.email.trim() || !agent.password) {
            return "Completa nombre, email y contraseña de cada asesor, o elimínalo.";
          }
          if (!EMAIL_REGEX.test(agent.email.trim())) {
            return `El email de "${agent.name || "un asesor"}" no es válido.`;
          }
          if (agent.password.length < 8) {
            return `La contraseña de "${agent.name || "un asesor"}" debe tener al menos 8 caracteres.`;
          }
        }
        return null;
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
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStepError("");
    setStep((s) => Math.max(s - 1, 0));
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
        branding: {
          primaryColor: colors.primaryColor || undefined,
          accentColor: colors.accentColor || undefined,
          backgroundColor: colors.backgroundColor || undefined,
        },
        commercial: {
          sellsProducts: commercial.sellsProducts,
          sellsServices: commercial.sellsServices,
          usesCatalog: commercial.usesCatalog,
          usesQuotes: commercial.usesQuotes,
          usesTasks: commercial.usesTasks,
          categories: commercial.categories,
        },
        pipeline: {
          name: pipeline.name.trim(),
          stages: pipeline.stages.map((s) => s.trim()).filter(Boolean),
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

  const isLastStep = step === STEP_LABELS.length - 1;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#FAF8F3] lg:flex-row">
      <OnboardingProgress current={step} labels={STEP_LABELS} />

      <div className="flex flex-1 items-start justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-xl rounded-xl border border-[#0B0F10]/10 bg-white p-6 shadow-sm sm:p-8">
          {step === 0 && <InviteCodeStep value={inviteCode} onChange={setInviteCode} />}
          {step === 1 && <CompanyInfoStep value={company} onChange={patchCompany} />}
          {step === 2 && (
            <BrandingStep
              colors={colors}
              onColorsChange={patchColors}
              logoFile={logoFile}
              onLogoChange={setLogoFile}
              secondaryLogoFile={secondaryLogoFile}
              onSecondaryLogoChange={setSecondaryLogoFile}
            />
          )}
          {step === 3 && <CommercialStep value={commercial} onChange={patchCommercial} />}
          {step === 4 && <PipelineStep value={pipeline} onChange={patchPipeline} />}
          {step === 5 && <AdminStep value={admin} onChange={patchAdmin} />}
          {step === 6 && <AgentsStep value={agents} onChange={setAgents} />}
          {step === 7 && (
            <ConfirmationStep
              companyName={company.name}
              businessType={company.businessType}
              city={company.city}
              country={company.country}
              hasLogo={!!logoFile}
              hasSecondaryLogo={!!secondaryLogoFile}
              primaryColor={colors.primaryColor}
              accentColor={colors.accentColor}
              commercial={commercial}
              pipeline={pipeline}
              adminName={admin.name}
              adminEmail={admin.email}
              agentsCount={agents.length}
            />
          )}

          {stepError && <p className="mt-4 text-sm text-red-600">{stepError}</p>}
          {submitError && <p className="mt-4 text-sm text-red-600">{submitError}</p>}

          <div className="mt-8 flex items-center justify-between border-t border-[#0B0F10]/10 pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0 || submitting}
              className="rounded-md px-4 py-2 text-sm font-medium text-[#0B0F10]/60 hover:bg-[#F4EFE6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Atrás
            </button>

            {isLastStep ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-md bg-[#A57014] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#8c5f10] disabled:opacity-50"
              >
                {submitting ? "Creando empresa..." : "Crear empresa"}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="rounded-md bg-[#A57014] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#8c5f10]"
              >
                Siguiente
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
