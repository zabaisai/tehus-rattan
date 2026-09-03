import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from '../../common/throttle/throttle.config';
import { ONBOARDING_TEMPLATES } from './templates/onboarding-templates';
import {
  BUSINESS_TYPE_LIMITS,
  CATEGORY_LIMITS,
  STAGE_LIMITS,
} from '../companies/company-settings';

/**
 * Plantillas de onboarding para el asistente de alta.
 *
 * Público a propósito: el alta de una empresa ocurre ANTES de que exista un
 * usuario autenticado. No expone nada sensible (son sugerencias estáticas
 * versionadas en código) y va limitado por IP como el resto del onboarding.
 * Sin esto el frontend tendría que duplicar las plantillas y, con dos copias,
 * la sugerencia y la validación acabarían divergiendo.
 */
@Controller('onboarding')
export class OnboardingTemplatesController {
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.default },
  })
  @Get('templates')
  templates() {
    return {
      ...ONBOARDING_TEMPLATES,
      limits: {
        categories: CATEGORY_LIMITS,
        stages: STAGE_LIMITS,
        businessType: BUSINESS_TYPE_LIMITS,
      },
    };
  }
}
