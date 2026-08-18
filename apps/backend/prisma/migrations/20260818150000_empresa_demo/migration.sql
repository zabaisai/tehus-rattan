-- AlterTable
--
-- Marcador de EMPRESA DE DEMOSTRACION.
--
-- `NOT NULL DEFAULT false` a proposito: un `ADD COLUMN` sin default dejaria
-- NULL en todas las empresas existentes, y "no se sabe si es demo" es
-- justamente el estado que el guardarrail trata como demo y bloquea. Con el
-- default, todas las empresas anteriores entran como lo que son: NO demo, y
-- siguen pudiendo enviar exactamente igual que antes.
--
-- Aditiva: no toca ningun dato existente y no hay backfill que hacer.
ALTER TABLE "companies" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- El guardarrail consulta esta columna en cada efecto externo, siempre por id.
-- El indice parcial mantiene barato listar las empresas demo, que es lo que
-- hacen los comandos de aprovisionamiento y de restauracion.
CREATE INDEX "companies_isDemo_idx" ON "companies"("isDemo") WHERE "isDemo" = true;
