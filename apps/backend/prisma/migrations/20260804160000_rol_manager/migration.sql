-- Rol MANAGER.
--
-- ADITIVO: anade un valor al enum sin tocar ninguna fila. Nadie lo tiene
-- todavia, asi que el comportamiento de los usuarios existentes no cambia.
--
-- `BEFORE 'AGENT'` mantiene el orden logico de privilegio en el tipo. Ninguna
-- consulta del producto ordena por rol, pero si alguna lo hiciera, tenerlo al
-- final daria un orden que no significa nada.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER' BEFORE 'AGENT';
