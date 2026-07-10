import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

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

  @IsArray()
  @IsString({ each: true })
  categories!: string[];
}

export class OnboardingPipelineDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del pipeline es requerido' })
  name!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'El pipeline debe tener al menos una etapa' })
  @IsString({ each: true })
  stages!: string[];
}

export class OnboardingAdminDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del administrador es requerido' })
  name!: string;

  @IsEmail({}, { message: 'El email del administrador no es válido' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password!: string;
}

export class OnboardingAgentDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del asesor es requerido' })
  name!: string;

  @IsEmail({}, { message: 'El email del asesor no es válido' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
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
