-- Eliminacion definitiva de contactos CON historia: se anonimiza, no se borra.
--
-- ADITIVA. Una columna nueva, opcional y sin valor por defecto: las filas
-- existentes quedan en NULL, que es exactamente lo que significan ("este
-- contacto no ha sido anonimizado"). No reescribe la tabla ni bloquea.
--
-- ROLLBACK:
--   ALTER TABLE "contacts" DROP COLUMN "anonymizedAt";
-- Solo pierde la marca de que alguien ejercio su derecho de supresion; los
-- datos personales ya no estarian de vuelta, porque esos se van de verdad.

ALTER TABLE "contacts" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- Sirve para listar «lo ya anonimizado» sin recorrer la tabla entera. Parcial
-- porque la inmensa mayoria de las filas seran NULL para siempre.
CREATE INDEX "contacts_anonymized_idx"
  ON "contacts" ("companyId", "anonymizedAt")
  WHERE "anonymizedAt" IS NOT NULL;
