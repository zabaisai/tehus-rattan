import { IsString, Matches } from 'class-validator';

// Explicit connection-test send. `to` must be a full E.164 number
// (`+` followed by 7-15 digits, first digit non-zero). Whitelisted DTO —
// no other fields are accepted.
export class TestConnectionDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'El número debe estar en formato E.164 (ej. +573001234567).',
  })
  to!: string;
}
