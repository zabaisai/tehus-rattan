-- ─────────────────────────────────────────────────────────────────────────
-- BACKFILL — teléfonos existentes a forma canónica E.164.
--
-- CONTEXTO
-- Meta entrega `wa_id` sin "+" (573001112233) y el CRM lo guardaba tal cual.
-- Los 4 contactos reales de staging están en esa forma. Desde el bloque 3 el
-- servicio ya normaliza al crear, pero las filas anteriores siguen sin "+",
-- de modo que un contacto guardado por el webhook y el mismo número tecleado
-- por un asesor seguirían siendo dos filas distintas.
--
-- ALCANCE DELIBERADAMENTE ESTRECHO
-- Esta migración NO reimplementa en SQL la lógica de indicativos del
-- utilitario TypeScript. Solo antepone "+" a los números que YA son dígitos
-- E.164 válidos, que es exactamente el caso observado. Un número nacional sin
-- indicativo (10 dígitos) NO se toca aquí: convertirlo exigiría asumir el país
-- en SQL, y esa decisión ya vive en `e164.util.ts`, donde está probada.
-- Esas filas las corregirá el servicio la próxima vez que las escriba.
--
-- NUNCA SOBRESCRIBE UNA COLISIÓN
-- Si al anteponer "+" el número chocara con otro contacto YA existente de la
-- misma empresa, la fila se deja intacta. Fusionar dos contactos es una
-- decisión de negocio (¿qué nombre gana? ¿qué pasa con sus conversaciones?),
-- no algo que una migración deba resolver en silencio. Quedan visibles con:
--
--   SELECT "companyId", '+' || phone FROM contacts c1
--   WHERE phone ~ '^[0-9]{8,15}$'
--     AND EXISTS (SELECT 1 FROM contacts c2
--                 WHERE c2."companyId" = c1."companyId"
--                   AND c2.phone = '+' || c1.phone);
--
-- IDEMPOTENTE: reejecutarla no cambia nada, porque tras la primera pasada
-- ninguna fila cumple ya el patrón de solo dígitos.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE "contacts" c1
SET "phone" = '+' || c1."phone"
WHERE c1."phone" ~ '^[0-9]{8,15}$'
  AND NOT EXISTS (
    SELECT 1 FROM "contacts" c2
    WHERE c2."companyId" = c1."companyId"
      AND c2."phone" = '+' || c1."phone"
  );
