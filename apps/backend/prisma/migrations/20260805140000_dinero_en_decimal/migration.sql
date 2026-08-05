-- El dinero deja de ser coma flotante.
--
-- POR QUE
-- La coma flotante binaria no puede representar 0,1 exactamente. Sumar las
-- lineas de una cotizacion acumula ese error: el total no cuadra con la suma
-- de sus partes, y quien lo mira concluye —con razon— que el sistema calcula
-- mal. `numeric` es exacto en base 10, que es la base en la que se factura.
--
-- QUE HACE
-- Cambia el tipo IN SITU con `USING`, que CONSERVA los valores. No borra
-- ninguna columna, ninguna fila y ninguna tabla.
--
-- PRECISION: numeric(18,4).
--   · 18 digitos aguantan miles de millones de pesos sin acercarse al techo.
--   · 4 decimales, no 2, porque un precio unitario puede llevar mas de dos
--     (precios por unidad de medida, conversiones de divisa) y redondear a 2
--     AQUI perderia informacion que hoy existe. El redondeo a la moneda es
--     decision de presentacion, no de almacenamiento.
--
-- CONVERSION DE VALORES
-- `double precision` -> `numeric` en PostgreSQL usa la representacion decimal
-- mas corta que reproduce el float, asi que 1234.56 se guarda como 1234.56 y
-- no como 1234.5599999999999. Para importes reales no hay perdida. Un valor
-- con mas de 4 decimales SI se redondearia; no existen hoy, y el cheque de
-- abajo lo verifica antes de tocar nada.
--
-- ROLLBACK (probado):
--   ALTER TABLE "leads"       ALTER COLUMN "value"     TYPE double precision USING "value"::double precision;
--   ALTER TABLE "lead_products" ALTER COLUMN "unitPrice" TYPE double precision USING "unitPrice"::double precision;
--   ALTER TABLE "products"    ALTER COLUMN "price"     TYPE double precision USING "price"::double precision;
--   ALTER TABLE "quotes"      ALTER COLUMN "subtotal"  TYPE double precision USING "subtotal"::double precision,
--                             ALTER COLUMN "discount"  TYPE double precision USING "discount"::double precision,
--                             ALTER COLUMN "total"     TYPE double precision USING "total"::double precision;
--   ALTER TABLE "quote_items" ALTER COLUMN "unitPrice" TYPE double precision USING "unitPrice"::double precision,
--                             ALTER COLUMN "subtotal"  TYPE double precision USING "subtotal"::double precision;
-- El rollback vuelve a introducir el error de coma flotante, que es
-- exactamente el defecto que esta migracion corrige.
--
-- BLOQUEO: reescribe las tablas y toma ACCESS EXCLUSIVE. Con los volumenes
-- actuales (miles de filas) es instantaneo. En una base grande habria que
-- hacerlo por columna nueva + backfill; no es el caso y decirlo aqui evita
-- que alguien lo copie a ciegas dentro de dos años.

-- Cheque previo: si algun importe tuviera mas de 4 decimales significativos,
-- esta migracion los redondearia en silencio. Se prefiere fallar y mirarlo.
DO $$
DECLARE
  sobrantes INT;
BEGIN
  SELECT count(*) INTO sobrantes FROM (
    SELECT "value"::numeric AS v FROM "leads" WHERE "value" IS NOT NULL
    UNION ALL SELECT "unitPrice"::numeric FROM "lead_products"
    UNION ALL SELECT "price"::numeric FROM "products"
    UNION ALL SELECT "subtotal"::numeric FROM "quotes"
    UNION ALL SELECT "discount"::numeric FROM "quotes"
    UNION ALL SELECT "total"::numeric FROM "quotes"
    UNION ALL SELECT "unitPrice"::numeric FROM "quote_items"
    UNION ALL SELECT "subtotal"::numeric FROM "quote_items"
  ) t
  WHERE scale(v) > 4;

  IF sobrantes > 0 THEN
    RAISE EXCEPTION
      'Hay % importes con mas de 4 decimales. Revisalos antes de migrar: numeric(18,4) los redondearia.',
      sobrantes;
  END IF;
END $$;

ALTER TABLE "leads"
  ALTER COLUMN "value" TYPE DECIMAL(18,4) USING "value"::numeric;

ALTER TABLE "lead_products"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(18,4) USING "unitPrice"::numeric;

ALTER TABLE "products"
  ALTER COLUMN "price" TYPE DECIMAL(18,4) USING "price"::numeric;

ALTER TABLE "quotes"
  ALTER COLUMN "subtotal" TYPE DECIMAL(18,4) USING "subtotal"::numeric,
  ALTER COLUMN "discount" TYPE DECIMAL(18,4) USING "discount"::numeric,
  ALTER COLUMN "total"    TYPE DECIMAL(18,4) USING "total"::numeric;

ALTER TABLE "quote_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(18,4) USING "unitPrice"::numeric,
  ALTER COLUMN "subtotal"  TYPE DECIMAL(18,4) USING "subtotal"::numeric;
