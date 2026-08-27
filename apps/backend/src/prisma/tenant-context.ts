import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Contexto de empresa TRANSACTION-SCOPED para Row-Level Security.
 *
 * Fija `app.company_id` con `set_config(..., true)` — el tercer argumento `true`
 * lo ata a la transacción en curso, NO a la sesión. Esto es imprescindible con
 * un pool de conexiones: un valor session-scoped se quedaría pegado a la
 * conexión y la siguiente petición que reutilizara esa conexión heredaría la
 * empresa anterior (fuga entre empresas). Al atarlo a la transacción, el valor
 * desaparece al hacer commit/rollback y jamás se filtra a otra petición.
 *
 * Uso previsto (una vez adoptado RLS, ver prisma/rls/README.md):
 *
 *   await runWithTenant(prisma, req.user.companyId, (tx) =>
 *     tx.contact.findMany(),
 *   );
 *
 * Todas las consultas dentro del callback ven las políticas RLS resueltas con
 * ese companyId. Sin llamar a esto, con RLS activo, las consultas no devuelven
 * filas (deny-by-default), que es el fail-closed correcto.
 */
export async function runWithTenant<T>(
  prisma: PrismaClient,
  companyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!companyId?.trim()) {
    throw new Error('runWithTenant requiere un companyId no vacío');
  }
  return prisma.$transaction(async (tx) => {
    // Parametrizado: el companyId nunca se interpola en el SQL.
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    return fn(tx);
  });
}

/**
 * Ejecuta un bloque SIN contexto de empresa, de forma explícita. Para procesos
 * de sistema legítimamente cross-tenant (dispatcher del outbox, barridos de
 * SLA, limpiezas programadas) que hoy no fijan empresa. Con RLS activo, estos
 * caminos necesitan un rol con BYPASSRLS o fijar el contexto por fila; este
 * helper marca en el código dónde ocurre esa excepción para que sea auditable.
 */
export function esCaminoDeSistema(): true {
  // Punto único y buscable para localizar los accesos cross-tenant de sistema.
  return true;
}
