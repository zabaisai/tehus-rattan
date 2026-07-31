import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectDeletionDto {
  /** Rechazar sin explicar deja a quien lo pidio sin saber que corregir. */
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
