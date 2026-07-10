import api from './axios';

export interface OnboardingCompanyInfo {
  name: string;
  businessType?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
}

export interface OnboardingBranding {
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
}

export interface OnboardingCommercial {
  sellsProducts: boolean;
  sellsServices: boolean;
  usesCatalog: boolean;
  usesQuotes: boolean;
  usesTasks: boolean;
  categories: string[];
}

export interface OnboardingPipeline {
  name: string;
  stages: string[];
}

export interface OnboardingAdmin {
  name: string;
  email: string;
  password: string;
}

export interface OnboardingAgent {
  name: string;
  email: string;
  password: string;
  role: 'AGENT';
}

export interface OnboardingCompanyPayload {
  company: OnboardingCompanyInfo;
  branding?: OnboardingBranding;
  commercial: OnboardingCommercial;
  pipeline: OnboardingPipeline;
  admin: OnboardingAdmin;
  agents?: OnboardingAgent[];
}

export interface OnboardingFiles {
  logo?: File;
  secondaryLogo?: File;
}

const ALLOWED_LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

// Frontend-only guardrail so the wizard fails fast on an obviously wrong
// file (wrong extension, SVG, too large) — the backend's magic-byte check
// remains the real source of truth and runs regardless of this.
export function validateLogoFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";

  if (file.type === "image/svg+xml" || ext === ".svg") {
    return "No se aceptan archivos SVG.";
  }
  if (!ALLOWED_LOGO_EXTENSIONS.includes(ext)) {
    return "Formato no permitido. Usa PNG, JPG o WEBP.";
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    return "El archivo supera el tamaño máximo permitido (2MB).";
  }
  return null;
}

export interface OnboardingSafeUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface OnboardingResult {
  message: string;
  company: {
    id: string;
    name: string;
    slug: string | null;
    status: string;
    logoUrl: string | null;
    secondaryLogoUrl: string | null;
  };
  admin: OnboardingSafeUser;
  agents: OnboardingSafeUser[];
  pipeline: { id: string; name: string };
  stages: Array<{ id: string; name: string; order: number }>;
}

// The invite code travels only in the X-Onboarding-Invite-Code header, never
// in the JSON payload — the backend guard runs before multer parses the
// multipart body, so a body-embedded code wouldn't even be readable there.
export async function createCompanyOnboarding(
  payload: OnboardingCompanyPayload,
  files: OnboardingFiles,
  inviteCode: string,
): Promise<OnboardingResult> {
  const formData = new FormData();
  formData.append('data', JSON.stringify(payload));
  if (files.logo) formData.append('logo', files.logo);
  if (files.secondaryLogo) formData.append('secondaryLogo', files.secondaryLogo);

  const { data } = await api.post<OnboardingResult>('/onboarding/company', formData, {
    headers: { 'X-Onboarding-Invite-Code': inviteCode },
  });
  return data;
}
