-- Clave de idempotencia de los mensajes SALIENTES que genera el sistema.
--
-- `wamid` no sirve para esto: lo asigna Meta y solo se conoce DESPUÉS de
-- enviar, así que no puede impedir el envío duplicado que ocurre justo antes.
--
-- ADITIVO Y SEGURO SOBRE DATOS EXISTENTES: la columna nace nula, y en
-- PostgreSQL los NULL no chocan entre sí en un índice único, así que las filas
-- que ya están no pueden hacer fallar la restricción.
ALTER TABLE "messages" ADD COLUMN "externalKey" TEXT;

CREATE UNIQUE INDEX "messages_externalKey_key" ON "messages"("externalKey");
