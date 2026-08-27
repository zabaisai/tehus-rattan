import { IsBoolean, IsOptional } from 'class-validator';

// Cuerpo de POST /conversations/:id/handoff/resolve. Antes objeto inline
// `{ resumeBot?: boolean }` (sin validar por el pipe global). Como DTO activa
// whitelist + rechazo de campos desconocidos.
export class ResolverHandoffDto {
  @IsOptional()
  @IsBoolean()
  resumeBot?: boolean;
}
