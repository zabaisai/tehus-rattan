import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

// Collapse surrounding whitespace so a value that is only spaces becomes an
// empty string (and blank optional fields stay blank) before validation.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

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

  // ── Per-company fiscal identity (used to render quotes) ──
  // Optional and normalized (trimmed) with sane max lengths. Empty values are
  // omitted from the printed document, never replaced by a global fallback.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  legalName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  quoteFooter?: string;

  // Deliberately NOT declared here: id, status, slug, companyId, createdAt,
  // updatedAt, logoUrl, secondaryLogoUrl. The global ValidationPipe
  // (whitelist + forbidNonWhitelisted) rejects a request that includes any
  // of them with a 400 — logoUrl/secondaryLogoUrl only ever change via
  // POST /companies/me/logo.
}
