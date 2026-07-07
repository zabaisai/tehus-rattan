import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface SuperAdminInput {
  email: string;
  name: string;
  password: string;
}

export function validateSuperAdminInput(env: {
  SUPER_ADMIN_EMAIL?: string;
  SUPER_ADMIN_NAME?: string;
  SUPER_ADMIN_PASSWORD?: string;
}): SuperAdminInput {
  const missing: string[] = [];
  if (!env.SUPER_ADMIN_EMAIL?.trim()) missing.push('SUPER_ADMIN_EMAIL');
  if (!env.SUPER_ADMIN_NAME?.trim()) missing.push('SUPER_ADMIN_NAME');
  if (!env.SUPER_ADMIN_PASSWORD) missing.push('SUPER_ADMIN_PASSWORD');

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno requeridas: ${missing.join(', ')}`,
    );
  }

  const email = env.SUPER_ADMIN_EMAIL!.trim().toLowerCase();
  const name = env.SUPER_ADMIN_NAME!.trim();
  const password = env.SUPER_ADMIN_PASSWORD!;

  if (!EMAIL_REGEX.test(email)) {
    throw new Error('SUPER_ADMIN_EMAIL no es un email válido');
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SUPER_ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    );
  }

  return { email, name, password };
}

type SuperAdminPrisma = {
  user: {
    findUnique: (args: any) => Promise<{ id: string } | null>;
    create: (args: any) => Promise<unknown>;
    update: (args: any) => Promise<unknown>;
  };
};

export async function upsertSuperAdmin(
  prisma: SuperAdminPrisma,
  input: SuperAdminInput,
): Promise<'created' | 'updated'> {
  const passwordHash = await bcrypt.hash(input.password, 10);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        password: passwordHash,
        role: 'SUPER_ADMIN',
        companyId: null,
        isActive: true,
      },
    });
    return 'updated';
  }

  await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
      isActive: true,
    },
  });
  return 'created';
}

async function main() {
  let input: SuperAdminInput;
  try {
    input = validateSuperAdminInput(process.env);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : 'entrada inválida'}`,
    );
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const outcome = await upsertSuperAdmin(prisma, input);
    console.log(
      outcome === 'created'
        ? `SUPER_ADMIN creado: ${input.email}`
        : `SUPER_ADMIN actualizado: ${input.email}`,
    );
  } catch {
    console.error(
      'Error inesperado al crear/actualizar el SUPER_ADMIN. Revisa la conexión a la base de datos.',
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
