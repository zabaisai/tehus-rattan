-- Una sola sesion de chatbot ACTIVA por conversacion.
--
-- Va como SQL en su propia migracion porque Prisma no sabe expresar indices
-- parciales: si algun dia `prisma migrate dev` propone eliminarlo, hay que
-- rechazarlo.
--
-- QUE EVITA: dos mensajes simultaneos del mismo contacto abririan dos sesiones
-- y el cliente recibiria el flujo por duplicado -dos saludos, dos veces la
-- misma pregunta-. El indice lo impide en la base, que es el unico sitio donde
-- la garantia se sostiene con varios procesos trabajando a la vez.
--
-- Es PARCIAL a proposito: las sesiones ya terminadas pueden acumularse sin
-- limite en la misma conversacion, que es lo normal cuando alguien vuelve a
-- escribir semanas despues.
CREATE UNIQUE INDEX "chatbot_sessions_one_active_per_conversation"
  ON "chatbot_sessions" ("conversationId")
  WHERE status = 'ACTIVE';
