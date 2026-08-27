import { SetMetadata } from '@nestjs/common';

// Marca una ruta (o un controlador entero) como PÚBLICA: el guard global de
// autenticación (GlobalJwtAuthGuard) la deja pasar sin token. Es la ÚNICA forma
// de exceptuar el deny-by-default, y debe usarse solo en rutas realmente
// públicas (health, login, recuperación, onboarding, webhook de Meta).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
