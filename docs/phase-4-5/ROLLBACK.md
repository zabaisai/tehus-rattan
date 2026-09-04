# Fase 4.5 — Rollback

## Lo primero: apagar, no revertir

La vuelta atrás normal **no** es un despliegue. Es apagar el interruptor:

```bash
cd /opt/tehus-crm
# En .env.staging: AUTH_DEVICE_VERIFICATION_ENABLED=false
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d backend
./deploy/scripts/health-check.sh
```

Con el interruptor apagado, `POST /auth/login` vuelve a responder exactamente
lo de antes (`status: 'authenticated'` con token y cookie de refresh) y ningún
dispositivo nuevo pide código. Solo se reinicia el backend; ni la base ni el
frontend necesitan tocarse, y no se pierde ninguna sesión abierta.

Es el camino recomendado ante cualquier duda: el proveedor de correo se cae,
alguien no recibe el código, se dispara el soporte. Apagar restaura el acceso
en segundos y no revierte datos.

## Si además hay que volver al código anterior

```bash
cd /opt/tehus-crm
./deploy/scripts/rollback-code.sh <sha-anterior>   # lo imprime deploy.sh como «Previous (rollback) commit»
./deploy/scripts/health-check.sh
BASE_URL=https://crm-staging.takto.online EXPECTED_RELEASE=<sha-anterior> ./deploy/scripts/smoke-test.sh
```

**No hay que revertir la migración.** Es aditiva: crea
`device_verification_challenges` y `trusted_devices` y no altera ninguna tabla,
columna ni fila existente. Con el código anterior esas tablas simplemente
quedan sin uso. Revertirlas no aporta nada y borraría el rastro de auditoría de
lo que ocurrió mientras la función estuvo activa.

## Qué queda en la base tras apagar

- Retos: filas históricas, todas con su código ya caducado o consumido. Sin
  efecto sobre el acceso.
- Dispositivos confiables: filas vigentes que dejan de consultarse. Si se
  vuelve a encender el interruptor, los dispositivos que aún no hayan vencido
  siguen siendo válidos. Para empezar de cero:

```sql
-- Solo si se quiere que TODOS vuelvan a verificar al reactivar.
UPDATE trusted_devices SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
```

Esa sentencia no borra filas ni toca sesiones: marca la revocación, que es lo
mismo que hace el producto.

## Cookies en el navegador

La cookie del dispositivo confiable caduca sola a los 30 días y, con el
interruptor apagado, nadie la lee. No hace falta pedir a nadie que borre nada.

## Secreto

`AUTH_CHALLENGE_HMAC_SECRET` puede rotarse en cualquier momento: los retos en
curso dejarán de validar (sus huellas se calcularon con el secreto anterior) y
las personas pedirán un código nuevo. No afecta a sesiones ni a dispositivos
confiables, cuyo hash no depende de ese secreto.

## Qué NO hacer

- `prisma migrate reset`, `db push` o cualquier SQL destructivo.
- Borrar las tablas nuevas para «limpiar»: se pierde la auditoría.
- Revertir el frontend por separado: el nuevo login funciona igual con el
  interruptor apagado, porque el servidor responde `status: 'authenticated'` y
  la pantalla de verificación nunca aparece.
