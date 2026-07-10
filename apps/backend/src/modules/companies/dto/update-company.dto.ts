import { Prisma } from '@prisma/client';
import { IsEmail, IsObject, IsOptional, IsString, Matches } from 'class-validator';

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

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
  @IsEmail({}, { message: 'El email no es válido' })
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Matches(HEX_COLOR_REGEX, {
    message: 'primaryColor debe ser un color hex válido (#RGB o #RRGGBB)',
  })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR_REGEX, {
    message: 'accentColor debe ser un color hex válido (#RGB o #RRGGBB)',
  })
  accentColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR_REGEX, {
    message: 'backgroundColor debe ser un color hex válido (#RGB o #RRGGBB)',
  })
  backgroundColor?: string;

  @IsOptional()
  @IsObject()
  settings?: Prisma.InputJsonValue;

  // Deliberately NOT declared here: id, status, slug, companyId, createdAt,
  // updatedAt, logoUrl, secondaryLogoUrl. The global ValidationPipe
  // (whitelist + forbidNonWhitelisted) rejects a request that includes any
  // of them with a 400 — logoUrl/secondaryLogoUrl only ever change via
  // POST /companies/me/logo.
}
