import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/password/password-policy';
import {
  CATEGORY_LIMITS,
  STAGE_LIMITS,
} from '../../companies/company-settings';
import {
  BUSINESS_MODELS,
  INDUSTRY_KEYS,
  type BusinessModel,
  type StageType,
} from '../templates/onboarding-templates';

export class OnboardingCompanyInfoDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la empresa es requerido' })
  name!: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email comercial no es válido' })
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class OnboardingBrandingDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  secondaryLogoUrl?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  accentColor?: string;

  @IsOptional()
  @IsString()
  backgroundColor?: string;
}

export class OnboardingCommercialDto {
  @IsBoolean()
  sellsProducts!: boolean;

  @IsBoolean()
  sellsServices!: boolean;

  @IsBoolean()
  usesCatalog!: boolean;

  @IsBoolean()
  usesQuotes!: boolean;

  @IsBoolean()
  usesTasks!: boolean;

  // Forma acotada aquí; la normalización (recorte, duplicados sin distinguir
  // mayúsculas) la hace `normalizeCategories` en el servicio.
  @IsArray()
  @ArrayMaxSize(CATEGORY_LIMITS.maxCount, {
    message: `Máximo ${CATEGORY_LIMITS.maxCount} categorías`,
  })
  @IsString({ each: true })
  @MaxLength(CATEGORY_LIMITS.maxLength, {
    each: true,
    message: `Cada categoría debe tener como máximo ${CATEGORY_LIMITS.maxLength} caracteres`,
  })
  categories!: string[];

  // ── Vertical elegida en el asistente (Fase 1). Opcional para no romper a
  // ningún cliente que envíe la forma anterior; cuando llega, se valida
  // contra las plantillas versionadas y se guarda en settings.vertical.
  @IsOptional()
  @IsString()
  @IsIn(INDUSTRY_KEYS, { message: 'industry no es una industria conocida' })
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  businessType?: string;

  @IsOptional()
  @IsIn(BUSINESS_MODELS, {
    message: 'businessModel debe ser products, services o mixed',
  })
  businessModel?: BusinessModel;
}

export class OnboardingTypedStageDto {
  @IsString()
  @IsNotEmpty({ message: 'Cada etapa debe tener nombre' })
  @MaxLength(STAGE_LIMITS.maxNameLength, {
    message: `Cada etapa debe tener como máximo ${STAGE_LIMITS.maxNameLength} caracteres`,
  })
  name!: string;

  @IsIn(['OPEN', 'WON', 'LOST'], { message: 'type debe ser OPEN, WON o LOST' })
  type!: StageType;
}

export class OnboardingPipelineDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del pipeline es requerido' })
  name!: string;

  // Forma anterior: solo nombres, todas OPEN. Sigue aceptándose cuando no
  // llegan etapas tipadas.
  @ValidateIf((o: OnboardingPipelineDto) => !o.typedStages)
  @IsArray()
  @ArrayMinSize(1, { message: 'El pipeline debe tener al menos una etapa' })
  @IsString({ each: true })
  stages?: string[];

  // Forma de la Fase 1: etapas con tipo explícito (OPEN/WON/LOST). Las
  // invariantes (≥1 OPEN, exactamente 1 WON y 1 LOST, sin duplicados) se
  // comprueban en el servicio con `validateTypedStages`.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'El pipeline debe tener al menos una etapa' })
  @ArrayMaxSize(STAGE_LIMITS.maxCount, {
    message: `El pipeline admite como máximo ${STAGE_LIMITS.maxCount} etapas`,
  })
  @ValidateNested({ each: true })
  @Type(() => OnboardingTypedStageDto)
  typedStages?: OnboardingTypedStageDto[];

  // Clave de la plantilla de pipeline usada como punto de partida (solo
  // informativa; se guarda en settings.pipelineDefaults).
  @IsOptional()
  @IsString()
  @MaxLength(60)
  templateKey?: string;
}

export class OnboardingAdminDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del administrador es requerido' })
  name!: string;

  @IsEmail({}, { message: 'El email del administrador no es válido' })
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;
}

export class OnboardingAgentDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del asesor es requerido' })
  name!: string;

  @IsEmail({}, { message: 'El email del asesor no es válido' })
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsIn(['AGENT'], { message: 'El rol de asesores debe ser AGENT' })
  role?: 'AGENT';
}

export class CreateOnboardingCompanyDto {
  @IsDefined({ message: 'company es requerido' })
  @ValidateNested()
  @Type(() => OnboardingCompanyInfoDto)
  company!: OnboardingCompanyInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingBrandingDto)
  branding?: OnboardingBrandingDto;

  @IsDefined({ message: 'commercial es requerido' })
  @ValidateNested()
  @Type(() => OnboardingCommercialDto)
  commercial!: OnboardingCommercialDto;

  @IsDefined({ message: 'pipeline es requerido' })
  @ValidateNested()
  @Type(() => OnboardingPipelineDto)
  pipeline!: OnboardingPipelineDto;

  @IsDefined({ message: 'admin es requerido' })
  @ValidateNested()
  @Type(() => OnboardingAdminDto)
  admin!: OnboardingAdminDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingAgentDto)
  agents?: OnboardingAgentDto[];

  // Accepted here too (in addition to the X-Onboarding-Invite-Code header)
  // purely so ValidationPipe's forbidNonWhitelisted doesn't 400 a request
  // that includes it in the body. OnboardingInviteGuard reads it directly
  // from the raw request — never from the validated DTO instance.
  @IsOptional()
  @IsString()
  inviteCode?: string;
}
