# Support Mode

## 1. Resumen

Support Mode es el mecanismo por el cual un `SUPER_ADMIN` **global** de la
plataforma (`role === 'SUPER_ADMIN' && companyId === null`) puede asistir a
una empresa cliente entrando temporalmente en el contexto de su
mensajería, sin usar credenciales de esa empresa y sin acceso permanente.

Existe para dar soporte técnico o de producto (por ejemplo: revisar por qué
una conversación no avanzó, confirmar que un mensaje llegó, diagnosticar un
problema reportado por el cliente) sin necesidad de pedirle contraseñas ni
de que un `ADMIN` de la empresa tenga que compartir pantalla.

Es de **solo lectura** y **temporal**: no hay impersonation, no se puede
responder ni editar mensajes, y toda sesión expira sola.

Se divide en dos niveles de acceso, ambos dentro de la misma sesión de
soporte:

- **Nivel 1 — Lista superficial de conversaciones**: qué conversaciones
  existen en la empresa, sin contenido de mensajes.
- **Nivel 2 — Detalle de conversación**: contenido real de los mensajes de
  una conversación puntual, elegida explícitamente por el SUPER_ADMIN.

Ambos niveles requieren una `SupportSession` activa, propia y no vencida.
No hay forma de saltar directo al Nivel 2 sin haber pasado por el Nivel 1
(la sesión y la empresa son las mismas para ambos).

## 2. Roles y permisos

- Solo puede usar Support Mode un usuario con:
  - `role: 'SUPER_ADMIN'`
  - `companyId: null`
- `ADMIN` y `AGENT` no pueden acceder a ningún endpoint de
  `/api/platform/*` — `PlatformGuard` los rechaza.
- Un `SUPER_ADMIN` con `companyId` distinto de `null` (es decir, un
  SUPER_ADMIN "de empresa", si existiera) tampoco puede acceder — cuenta
  igual que un `ADMIN` normal para `PlatformGuard`.
- `BusinessTenantGuard` hace el bloqueo inverso: impide que un
  `SUPER_ADMIN` global (con `companyId: null`) use los endpoints normales
  de negocio (contactos, conversaciones de negocio, etc.), que exigen un
  `companyId` de empresa real. Confirmado por test e2e: un SUPER_ADMIN
  global recibe 403 en `GET /api/contacts`, mientras que un ADMIN con
  `companyId` recibe 200.
- Los endpoints de plataforma (`/api/platform/*`) y los endpoints de
  negocio son mundos separados en cuanto a autorización: uno nunca abre
  acceso al otro.

Ver también [`PLATFORM_ADMIN.md`](./PLATFORM_ADMIN.md) para cómo se crea
la cuenta SUPER_ADMIN global.

## 3. Support Sessions

Archivos: `apps/backend/src/modules/platform/support-sessions.controller.ts`,
`support-sessions.service.ts`, `dto/create-support-session.dto.ts`.

**Crear sesión** — `POST /api/platform/support-sessions`

- Body requiere `companyId` y `reason`, ambos obligatorios
  (`@IsNotEmpty`). `reason` tiene además `@MaxLength(500)`; vacío o mayor a
  500 caracteres devuelve 400.
- La empresa debe existir. Si `company.status === 'DELETED'`, se rechaza
  con 400 ("No se puede iniciar una sesión de soporte para una empresa
  eliminada"). `SUSPENDED` no bloquea la creación de sesión.
- Si ya existe una `SupportSession` `ACTIVE` y no vencida para el mismo
  **(actor, companyId)**, se rechaza con 409 (conflicto). El alcance es por
  par actor+empresa: el mismo SUPER_ADMIN puede tener sesiones `ACTIVE`
  simultáneas para empresas distintas.
- `expiresAt` se fija en `now + 30 minutos` (`SUPPORT_SESSION_TTL_MINUTES
  = 30`) al momento de crear la sesión. No hay expiración anticipada
  configurable por request.
- Se audita `START_SUPPORT_SESSION` dentro de la misma transacción que
  crea la sesión: si falla el audit log, la sesión tampoco se crea.

**Expiración** — no hay job en background que barra sesiones vencidas.
La expiración se evalúa de forma perezosa (`lazy`) cada vez que se usa la
sesión, comparando `expiresAt` contra `new Date()` en el momento de la
request. Una sesión vencida que nunca se vuelve a tocar queda con
`status: 'ACTIVE'` en la base de datos hasta que alguien intente usarla o
cerrarla.

**Cierre** — `POST /api/platform/support-sessions/:id/end`

- Si la sesión ya está `ENDED`, devuelve 409.
- Si está vencida (`expiresAt` pasado) o su estado real es `EXPIRED`, la
  marca `EXPIRED` en la base (si todavía figuraba `ACTIVE`) y devuelve 409
  — no se puede "cerrar" una sesión que ya expiró.
- Si el cierre es válido, calcula `durationSeconds` y audita
  `END_SUPPORT_SESSION` dentro de la misma transacción.

**Sesión activa por actor/empresa** — ver arriba (creación); es un
constraint de negocio, no un índice único en base de datos.

**Empresa DELETED bloqueada** — solo al **crear** la sesión (ver arriba).
Una sesión ya creada para una empresa que luego pasa a `DELETED` no se
revoca automáticamente por este chequeo.

**Sesión de otro actor devuelve 404 genérico** — tanto al validar una
sesión (Nivel 1 / Nivel 2) como al cerrarla (`endSession`), "sesión
inexistente" y "sesión que existe pero pertenece a otro actor" devuelven
exactamente el mismo 404 ("Sesión de soporte no encontrada"). Es
deliberado: evita que alguien pueda confirmar la existencia de una sesión
de otro SUPER_ADMIN probando IDs.

**Endpoints:**

```
POST /api/platform/support-sessions
GET  /api/platform/support-sessions
POST /api/platform/support-sessions/:id/end
```

`GET /api/platform/support-sessions` acepta filtros opcionales por query
(`companyId`, `status`) y lista las sesiones del actor autenticado.

## 4. Nivel 1 — Lista superficial de conversaciones

```
GET /api/platform/support-sessions/:id/conversations?page=&limit=
```

- Requiere `SupportSession` `ACTIVE`, propia del actor (`actorUserId`
  coincide) y no vencida (`expiresAt > now`). Esta validación es
  deliberadamente de solo lectura: a diferencia de `endSession`, **no**
  marca la sesión como `EXPIRED` en la base aunque detecte que venció —
  solo rechaza la request.
- El filtro de empresa sale exclusivamente de `session.companyId`,
  resuelto en el servidor a partir de la sesión ya validada
  (`where: { companyId: session.companyId }` sobre `Conversation`).
- El endpoint **no acepta `companyId`** por query ni por body — no existe
  ese parámetro en la firma del controller. La única forma de acotar la
  empresa es a través de la sesión.
- No devuelve `messages`, ni `lastMessage`, ni `notes`, ni tokens de
  ningún tipo. El `select` de Prisma es explícito y deliberadamente
  distinto del que usa el listado normal de conversaciones de negocio
  (que sí incluye el último mensaje).
- Campos devueltos por conversación:
  - `id`
  - `status`
  - `channel`
  - `contact` (`id`, `name`)
  - `assignedUser` (`id`, `name`)
  - `createdAt`
  - `updatedAt`
- Paginación: `page` default `1`; `limit` default `20`, máximo `50`. Un
  `page` no entero (< 1) o un `limit` fuera de `[1, 50]` devuelve 400.
- Se audita `VIEW_SUPPORT_CONVERSATIONS` (metadata: `supportSessionId`,
  `companyId`, `companyName`, `resultCount`, `page`, `limit`) antes de
  devolver la respuesta. Si el audit log falla, la request entera falla y
  nunca se devuelven datos.

## 5. Nivel 2 — Detalle de conversación con mensajes

```
GET /api/platform/support-sessions/:sessionId/conversations/:conversationId?page=&limit=
```

- Requiere la misma validación de sesión que el Nivel 1 (`ACTIVE`, propia,
  no vencida).
- La conversación se busca así, y **solo** así:

  ```ts
  prisma.conversation.findFirst({
    where: { id: conversationId, companyId: session.companyId },
    select: { /* ... */ },
  })
  ```

  **Nunca** se usa `findUnique` por `id` seguido de una comparación de
  `companyId` en memoria — eso dejaría una conversación de otro tenant
  cargada en memoria antes de rechazarla. El filtro de tenant va dentro
  del `where`.
- Si no se encuentra (porque no existe o porque es de otra empresa), se
  devuelve 404 genérico ("Conversación no encontrada") — mismo código y
  mensaje para ambos casos, por la misma lógica anti-enumeración que las
  sesiones.
- Devuelve `messages` con `body` real (contenido real del mensaje). No se
  inventa `sender` por mensaje: el modelo `Message` no tiene un campo de
  remitente individual ni `updatedAt` propio, así que ninguno de los dos
  se fabrica en la respuesta.
- Los mensajes `OUTBOUND` se muestran en el frontend como **"Equipo"**
  (genérico), nunca atribuidos al `assignedUser` de la conversación — la
  dirección (`direction`) es la única atribución disponible y no implica
  que el `assignedUser` actual haya sido quien envió cada mensaje puntual.
- No devuelve `wamid` (id externo del proveedor de WhatsApp), ni `notes`,
  ni tokens, ni `password`/`hash`/`jwt`/`secret` de ningún tipo. Cubierto
  explícitamente por tests unitarios y e2e.
- Paginación de mensajes:
  - `page` default `1`
  - `limit` default `50`, máximo `100`
  - orden: `createdAt asc`
- Se audita `VIEW_SUPPORT_CONVERSATION_DETAIL` (`entityType: 'Conversation'`,
  `entityId: conversation.id`, metadata: `supportSessionId`, `companyId`,
  `companyName`, `conversationId`, `messageCount`, `page`, `limit`). Mismo
  comportamiento fail-closed que el Nivel 1: si falla el audit log, la
  request falla y no se devuelven mensajes.

## 6. Auditoría

Servicio: `apps/backend/src/modules/platform/platform-audit-log.service.ts`
(método `record`). Modelo: `AuditLog` en `prisma/schema.prisma`.

Acciones registradas por Support Mode:

- `START_SUPPORT_SESSION`
- `VIEW_SUPPORT_CONVERSATIONS`
- `VIEW_SUPPORT_CONVERSATION_DETAIL`
- `END_SUPPORT_SESSION`

Reglas:

- Toda acción sensible de Support Mode se audita, sin excepción.
- Si falla la escritura del `AuditLog`, la request completa falla:
  - En creación/cierre de sesión, el audit log se escribe dentro de la
    misma transacción que el cambio de estado de la sesión — si falla,
    hace rollback de todo (la sesión tampoco se crea/cierra).
  - En lectura (Nivel 1 y Nivel 2), no hay escritura de dominio que
    revertir, pero el audit log se escribe y se espera (`await`) antes de
    devolver cualquier dato; si falla, se lanza `InternalServerErrorException`
    y el cliente nunca recibe conversaciones ni mensajes.
- La metadata **nunca** guarda `body`/contenido/texto de mensajes — solo
  identificadores, conteos y paginación (`resultCount`, `messageCount`,
  `page`, `limit`, `conversationId`, etc.).
- La metadata **nunca** guarda tokens ni secretos. La única excepción de
  texto libre es el `reason` de `START_SUPPORT_SESSION`, que es la
  justificación del soporte (no contenido de conversación) y se guarda a
  propósito para trazabilidad.

## 7. Seguridad

- **`PlatformGuard`** (`apps/backend/src/common/guards/platform.guard.ts`):
  exige `role === 'SUPER_ADMIN' && companyId === null`. Protege todos los
  endpoints bajo `/api/platform/*`, incluidos los de Support Mode.
- **`BusinessTenantGuard`**
  (`apps/backend/src/common/guards/business-tenant.guard.ts`): exige un
  `companyId` de empresa real (string no vacío). Protege los endpoints de
  negocio y por lo tanto bloquea a un SUPER_ADMIN global, que nunca tiene
  `companyId`.
- **Aislamiento por tenant (`companyId`)**: en Nivel 1 y Nivel 2, toda
  consulta a `Conversation` está acotada por `companyId: session.companyId`
  dentro del propio `where` de Prisma — nunca se filtra después de traer
  los datos.
- **Anti-enumeración**: sesión de otro actor, sesión inexistente, y
  conversación de otra empresa devuelven siempre el mismo 404 genérico, sin
  distinguir "no existe" de "no es tuyo".
- **Sin impersonation**: el SUPER_ADMIN nunca actúa como si fuera un
  usuario de la empresa; opera bajo su propia identidad, dentro de una
  `SupportSession` explícita y auditada.
- **Sin responder mensajes**: Support Mode no expone ningún endpoint de
  escritura sobre conversaciones o mensajes de la empresa.
- **Sin editar mensajes**: idem, no hay operación de edición.
- **Sin notas internas**: el campo `notes` de conversación nunca se
  incluye en ninguna respuesta de Support Mode.

## 8. Frontend

- Sidebar: `apps/frontend/src/components/layout/Sidebar.tsx`. La sección
  "Plataforma" (Empresas, Auditoría) solo se renderiza cuando
  `user?.role === 'SUPER_ADMIN' && user?.companyId === null` — el mismo
  chequeo que hace `PlatformGuard` en el backend. Cuando esa condición es
  verdadera, además se oculta por completo la navegación normal de CRM
  (contactos, conversaciones de negocio): un SUPER_ADMIN de plataforma
  solo ve "Plataforma".
- Flujo:

  ```
  Empresas → Ver soporte → Iniciar soporte → Ver conversaciones → Ver mensajes → Cerrar sesión
  ```

  1. `/dashboard/platform/companies` — listado de empresas, botón
     **"Ver soporte"** por fila abre `CompanySupportOverviewModal`.
  2. Si no hay sesión activa, botón **"Iniciar soporte"** abre
     `StartSupportSessionModal` (motivo obligatorio, máx. 500 caracteres,
     validación de cliente espejo de la del backend) →
     `POST /platform/support-sessions`.
  3. Con sesión activa, `SupportSessionPanel` muestra estado/expiración/
     motivo y la lista paginada (20 por página) de conversaciones vía
     `GET .../conversations`, cada fila con botón **"Ver mensajes"**.
  4. **"Ver mensajes"** abre `SupportConversationDetailModal`
     (`GET .../conversations/:conversationId`, 50 por página) — vista de
     burbujas de chat: `OUTBOUND` alineado a la derecha y etiquetado
     "Equipo", `INBOUND` alineado a la izquierda y etiquetado "Contacto".
  5. **"Cerrar sesión de soporte"** en `SupportSessionPanel` (visible solo
     mientras la sesión está activa) → `POST .../end`.

- Archivos principales: `CompanySupportOverviewModal.tsx`,
  `StartSupportSessionModal.tsx`, `SupportSessionPanel.tsx`,
  `SupportConversationDetailModal.tsx`, cliente API en `lib/platform.ts`,
  tipos en `types/index.ts`.
- **Auditoría visible en la página de auditoría**: `/dashboard/platform/*`
  incluye una vista de `AuditLog` (`platform-audit-log.controller.ts` /
  service `list()`, hasta 50 registros más recientes, filtrable por
  `action`, `affectedCompanyId`, `actorUserId`) donde aparecen las cuatro
  acciones de Support Mode junto con el resto de acciones de plataforma.

> Nota: actualmente no existen tests automatizados de frontend
> (`.test.tsx`/`.spec.tsx`) para estos componentes de Support Mode — la
> cobertura de tests está solo en el backend (ver sección 9).

## 9. Tests

**Backend — unitarios:**

- `apps/backend/src/common/guards/platform.guard.spec.ts` — permite
  SUPER_ADMIN con `companyId: null`; rechaza SUPER_ADMIN con `companyId`
  de empresa; rechaza ADMIN; rechaza AGENT; rechaza request sin `user` o
  sin `role`.
- `apps/backend/src/common/guards/business-tenant.guard.spec.ts` — permite
  ADMIN/AGENT con `companyId`; rechaza SUPER_ADMIN global (`companyId:
  null`); rechaza `companyId` faltante o vacío; rechaza request sin
  `user`.
- `apps/backend/src/modules/platform/support-sessions.controller.spec.ts`
  — cada ruta delega al método de servicio correcto con los argumentos
  correctos (actor, paginación); confirma exactamente 2 guards a nivel de
  clase, con `PlatformGuard` como el segundo.
- `apps/backend/src/modules/platform/support-sessions.service.spec.ts`
  (cobertura más profunda) — `createSession` (motivo obligatorio y límite
  de 500 caracteres, empresa inexistente/`DELETED` rechazada, sesión
  `ACTIVE` duplicada rechazada, sesiones `ENDED` no bloquean una nueva,
  `expiresAt` = +30min, audita `START_SUPPORT_SESSION`, fallo de audit
  impide crear la sesión); `endSession` (cierra y audita
  `END_SUPPORT_SESSION`, rechaza sesión de otro actor con 404, rechaza
  sesión ya `ENDED` con 409, marca perezosamente `EXPIRED` y devuelve 409);
  `validateActiveSupportSession` (permite válida, rechaza `ENDED`,
  rechaza vencida); `listSessionConversations` y
  `getSessionConversationDetail` — 403 para ADMIN, 403 para SUPER_ADMIN
  con `companyId` no nulo, 404 para conversación/sesión de otra
  empresa/actor, nunca devuelven `messages`/`notes`/`password`/`hash`/
  `wamid`/tokens en el listado, ni `wamid`/`notes`/`password`/`hash`/`jwt`/
  `secret` en el detalle, límites de paginación (50 y 100
  respectivamente), fallo de audit log bloquea la respuesta en ambos
  casos.

**Backend — e2e:**

- `apps/backend/test/support-sessions.e2e-spec.ts` — las 5 rutas
  completas a nivel HTTP: creación (201/403 ADMIN/403 SUPER_ADMIN con
  `companyId`/401 sin token/400 sin motivo/400 motivo > 500); listado
  (200 SUPER_ADMIN/403 ADMIN); cierre (403s + éxito); listado de
  conversaciones (403 ADMIN, 403 SUPER_ADMIN con `companyId`, 401 sin
  token, bloqueo por sesión inválida/vencida/`ENDED`, bloqueo por sesión
  de otro actor, nunca devuelve `messages`); detalle de conversación
  (mismo set de guards, más 404 por sesión de otro actor, 404 por
  conversación de otra empresa, confirma que `messages`+`body` sí están
  presentes, confirma que `wamid`/`notes`/tokens/`password`/`hash` nunca
  se devuelven); bloque final que confirma que las rutas de plataforma
  quedan bajo `/api` sin interferir con `BusinessTenantGuard` (SUPER_ADMIN
  global recibe 403 en `/api/contacts`, ADMIN normal recibe 200).

## 10. Operación local

```bash
# Base de datos
docker-compose up -d postgres

# Backend
cd apps/backend
npm run start:dev

# Frontend
cd apps/frontend
npm run dev

# Tests backend (unitarios)
cd apps/backend
npm test

# Tests backend (e2e)
cd apps/backend
npm run test:e2e

# Build backend
cd apps/backend
npm run build

# Lint / build frontend
cd apps/frontend
npm run lint
npm run build
```

## 11. Advertencias

- No usar `git add -A` — agregar archivos explícitamente.
- No tocar `.env`.
- No borrar volúmenes de Docker.
- No usar `docker-compose down -v`.
- Si `prisma generate` falla por `EPERM` en Windows, detener solo el
  proceso Node que está usando el puerto 3001, no el contenedor de
  Postgres ni otros procesos.
- La contraseña local temporal del SUPER_ADMIN (ver
  [`PLATFORM_ADMIN.md`](./PLATFORM_ADMIN.md)) debe rotarse antes de
  producción.

## 12. Checklist antes de producción

- [ ] Rotar contraseña del SUPER_ADMIN.
- [ ] Revisar variables de entorno.
- [ ] Revisar configuración de CORS.
- [ ] Confirmar backups de base de datos.
- [ ] Revisar logs y retención.
- [ ] Deploy.
- [ ] Pruebas con usuarios reales.
