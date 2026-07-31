-- ─────────────────────────────────────────────────────────────────────────
-- Un unico numero PRINCIPAL por empresa, garantizado en base.
--
-- POR QUE ANTES DE RETIRAR EL UNIQUE
-- Hoy `companyId` es unico, asi que "una principal por empresa" se cumple
-- trivialmente. En cuanto se retire ese constraint, dejaria de cumplirse solo
-- y el envio podria encontrar dos principales sin criterio para elegir. Este
-- indice se crea ANTES, mientras todavia no puede fallar, de modo que la
-- migracion destructiva posterior no tenga que introducir dos cambios de
-- semantica a la vez.
--
-- DEFENSIVO
-- Antes de crear el indice se normaliza el estado: si alguna empresa tuviera
-- varias principales se conserva la mas antigua; si tuviera integraciones
-- pero ninguna principal, se marca la primera. Hoy no hay datos sucios
-- (verificado), pero el indice no debe poder fallar por datos preexistentes.
--
-- NOTA DE MANTENIMIENTO: Prisma no soporta indices parciales en el schema,
-- asi que este vive SOLO aqui, igual que pipelines_one_default_per_company.
-- `prisma migrate dev` puede proponer eliminarlo al detectar deriva. NUNCA
-- aceptar ese DROP.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Deja una sola principal por empresa (conserva la mas antigua).
UPDATE "whatsapp_integrations" w
SET "isPrimary" = false
WHERE w."isPrimary"
  AND w."id" <> (
    SELECT w2."id" FROM "whatsapp_integrations" w2
    WHERE w2."companyId" = w."companyId" AND w2."isPrimary"
    ORDER BY w2."createdAt" ASC, w2."id" ASC
    LIMIT 1
  );

-- 2) Toda empresa con integraciones debe tener una principal.
UPDATE "whatsapp_integrations" w
SET "isPrimary" = true
WHERE w."id" IN (
  SELECT DISTINCT ON (w2."companyId") w2."id"
  FROM "whatsapp_integrations" w2
  WHERE NOT EXISTS (
    SELECT 1 FROM "whatsapp_integrations" w3
    WHERE w3."companyId" = w2."companyId" AND w3."isPrimary"
  )
  ORDER BY w2."companyId", w2."createdAt" ASC, w2."id" ASC
);

-- 3) Constraint definitivo.
CREATE UNIQUE INDEX "whatsapp_one_primary_per_company"
  ON "whatsapp_integrations" ("companyId")
  WHERE "isPrimary";
