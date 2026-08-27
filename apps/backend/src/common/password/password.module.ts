import { Global, Module } from '@nestjs/common';
import { PasswordHashService } from './password-hash.service';

// Global: el hashing de contraseñas lo usan auth, users, onboarding, plataforma
// y recuperación. Uno solo, con el coste objetivo y el rehash progresivo en un
// único sitio.
@Global()
@Module({
  providers: [PasswordHashService],
  exports: [PasswordHashService],
})
export class PasswordModule {}
