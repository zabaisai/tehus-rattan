# TAKTO CRM — Punto oficial de pausa y reanudación

**Fecha del punto de control:** 10 de agosto de 2026  
**Zona horaria:** America/Bogota  
**Proyecto:** TAKTO CRM / repositorio `zabaisai/tehus-rattan`  
**Estado:** trabajo pausado de forma deliberada, sin tarea activa pendiente de terminar

> Este documento es la fuente de verdad para retomar el proyecto después de la pausa.  
> No reiniciar auditorías ya cerradas, no repetir migraciones y no asumir que un reporte antiguo representa el estado actual.  
> Antes de escribir código, verificar el estado real contra Git, CI y staging.

---

## 1. Resumen ejecutivo

La base funcional del CRM quedó estable y comprobada en staging. Las correcciones de importaciones, cotizaciones, PDF económico y claridad del estado operativo de TAKTO Pulso están fusionadas, publicadas y desplegadas.

El próximo trabajo previsto es exclusivamente la integración visual del branding oficial de TAKTO. No se ha creado todavía la rama de branding ni se ha modificado el paquete de marca.

### Estado oficial al pausar

| Elemento | Estado |
|---|---|
| Rama principal | `main` |
| `main` local/remoto | `b19217c` (verificar SHA completo al reanudar) |
| Release efectivo en staging | `b19217c` |
| CI del release | Backend 18/18 y Frontend 11/11 en verde |
| Migraciones en staging | 56 aplicadas, 0 fallidas, 0 pendientes |
| Salud | Backend, worker y frontend healthy; smoke test 18/18 |
| Producción | No desplegada ni modificada |
| Branding | Desbloqueado, todavía no integrado |
| Rama siguiente prevista | `feature/takto-brand-ui-integration` |
| WhatsApp real de FlowBot | Bloqueado deliberadamente |
| Kill switch | Activo |
| Dry-run/transporte protegido | Activo |
| Allowlists | Vacías |
| Envíos reales durante QA | 0 |

Frase de cierre funcional ya emitida:

> **BASE FUNCIONAL ESTABLE — BRANDING DESBLOQUEADO**

Frase de cierre de TAKTO Pulso ya emitida:

> **ESTADO DE TAKTO PULSO ACLARADO — SEGURIDAD INTACTA — BRANDING CONTINÚA DESBLOQUEADO**

---

## 2. Ubicaciones y reglas operativas

### Repositorio local del usuario

`C:\Users\Usuario\Desktop\Tehus_Rattan`

### Repositorio remoto

`https://github.com/zabaisai/tehus-rattan`

### Checkout de staging

`/opt/tehus-crm`

### Dominio de staging

`https://crm-staging.tehusrattan.com`

### Reglas permanentes

1. Leer primero los runbooks y este documento.
2. Usar `git pull --ff-only`; nunca force push, rebase destructivo, reset duro o clean indiscriminado.
3. No tocar `brand/` salvo en el trabajo de branding autorizado.
4. No versionar el paquete completo de marca.
5. No usar ningún activo dentro de `99-NO-USAR/`.
6. No desplegar a producción sin autorización separada.
7. No activar WhatsApp real, bots reales, Meta, DNS o credenciales sin autorización separada.
8. No recrear PostgreSQL, Caddy, Redis o `takto-web` en despliegues normales.
9. Cuando backend y worker comparten imagen, mantenerlos en el mismo release.
10. Antes de migraciones o despliegues: backup verificado, restore drill y rollback preparado.
11. No borrar auditorías para “dejar limpio” el resultado.
12. Los datos QA deben llevar prefijo explícito y eliminarse únicamente por ID exacto.
13. Nunca incluir contraseñas, tokens, cookies, JWT, valores `.env` o secretos en documentos, prompts o commits.

---

## 3. Arquitectura actual relevante

- Monorepo con `apps/backend` (NestJS + Prisma) y `apps/frontend` (Next.js).
- PostgreSQL como fuente de verdad.
- Redis + BullMQ para colas y trabajo durable.
- Worker separado del backend.
- Caddy como entrada pública; backend y frontend no dependen de puertos directos del host.
- FlowBot/TAKTO Pulso usa ejecución durable, outbox, leases, reanudación y reconciliador.
- El transporte real de WhatsApp existe, pero está protegido por modo, allowlists, kill switch, límites y circuit breaker.
- El backend y el worker comparten el volumen de importaciones `product_imports`.

### Servicios que no deben recrearse sin necesidad

- PostgreSQL
- Caddy
- Redis
- `takto-web`

Los identificadores exactos deben volver a registrarse en cada preflight; no confiar ciegamente en valores antiguos.

---

## 4. Historial de releases clave

| SHA corto | Hito |
|---|---|
| `58dfb76` | Conexión manual de WhatsApp bajo sesión de soporte |
| `347b957` | Primer despliegue amplio de la reforma/FlowBot a staging |
| `c02331e` | Endurecimiento funcional y gate de release |
| `0b8ebba` | Corrección de importaciones compartidas y API económica de cotizaciones |
| `ef532c8` | Desglose económico completo y PDF de cotizaciones cuadrado |
| `b19217c` | Claridad del estado operativo de TAKTO Pulso; release actual al pausar |

Al reanudar, verificar el SHA completo de `b19217c` con Git y el endpoint de versión. Los SHAs cortos aquí sirven como trazabilidad, no como sustituto de la verificación.

---

## 5. Funcionalidad terminada y comprobada

### 5.1 Base multiempresa y seguridad

- Aislamiento por empresa caracterizado y probado en módulos críticos.
- Permisos por rol y sesión de soporte.
- Origen/cookies/rotación de refresh endurecidos.
- Auditoría preservada.
- Guardarraíles de WhatsApp y FlowBot activos.

### 5.2 Pipelines, contactos, conversaciones y tareas

- Pipelines y etapas con reglas de orden y etapa inicial.
- Creación/reutilización de oportunidad desde mensajes entrantes.
- Contactos archivables, restaurables y con papelera.
- Panel lateral y navegación conversación/pipeline implementados en el endurecimiento funcional.
- Handoff a usuario real.
- Tareas y sugerencias con confirmación, según la implementación vigente.
- Campos personalizados con historial.

### 5.3 TAKTO Pulso (antes FlowBot)

- Grafo tipado, validador, compilador y variables seguras sin `eval`.
- Motor durable con PostgreSQL, BullMQ, outbox, leases y recuperación.
- Consumidor del worker y reconciliador.
- Esperas y reanudación por mensaje/tiempo.
- Adaptadores CRM, WhatsApp, HTTP protegido contra SSRF e IA desacoplada del proveedor.
- API administrativa, versiones inmutables, disparadores, simulador, plantillas, ejecuciones y métricas.
- Constructor visual y pantallas administrativas integradas previamente.
- Transporte real protegido por:
  - kill switch;
  - modo falso/dry-run/real;
  - allowlists de empresa, número y destinatario;
  - contador de frecuencia;
  - circuit breaker;
  - clasificación de errores y tratamiento de resultados ambiguos.

#### Estado de los cuatro bots reales preservados

- `Handoff a asesor`: archivado.
- `Auto`: borrador.
- `Captura de datos`: borrador.
- `LHJKJK`: borrador.

No cambiar esos estados durante pruebas de branding.

### 5.4 Corrección del estado operativo de TAKTO Pulso

Problema corregido: la pantalla mostraba simultáneamente `Envíos parados` y `Enviando`.

Causa real:

- `Envíos parados` representaba el kill switch.
- `Enviando` representaba en realidad un circuit breaker en estado `CLOSED`, es decir, un número sin fallos acumulados; no significaba que estuviera enviando.

Solución desplegada:

- Modelo tipado único en `flowbot-estado-operativo.ts`.
- Se separan integración, modo de transporte, permiso global y salud del número.
- En staging protegido aparece `Modo seguro de pruebas`.
- El número muestra `Número conectado` y `Envíos reales bloqueados`.
- Desaparecen `Enviando`, la falsa alarma `Envíos parados` y el SHA histórico `347b957` de la vista principal.
- El rojo queda reservado para una detención real de emergencia cuando el transporte estaría enviando de verdad.
- El detalle técnico histórico se conserva sin fingir que es el release actual.

Hallazgo de seguridad importante:

> El kill switch solo detiene el envío de WhatsApp. Un bot activo puede seguir creando oportunidades, moviendo etapas, asignando personas y creando tareas en el CRM.

Por eso el botón `Activar` ahora debe advertir que las acciones CRM son reales. Nunca llamarlo “modo de prueba” si puede modificar datos.

QA final de esta corrección:

- Cinco anchos: 1440, 1280, 1024, 768 y 390 px.
- Sin desbordes ni errores de consola.
- Kill switch activo.
- Envío real bloqueado.
- Dry-run activo.
- Allowlists vacías.
- Cero llamadas a Meta.
- Estados de los cuatro bots intactos.

### 5.5 Importaciones de productos

Problema resuelto: backend guardaba el archivo en su `/tmp`, pero el worker estaba en otro contenedor y no podía leerlo.

Solución:

- Volumen compartido `product_imports`.
- Montado solo en backend y worker.
- Ruta interna: `/var/lib/takto/importaciones`.
- Permisos 755 y propietario de la aplicación; nunca 777.
- Claves persistidas, no rutas arbitrarias.
- Protección contra path traversal.
- Temporales liberados al completar, fallar o cancelar.

Pruebas realizadas:

- 500 filas completadas.
- 2.000 filas sobrevivieron reinicio del worker y terminaron sin duplicados.
- Cancelación se detuvo y liberó temporal.
- Prueba de motor con archivo de 524.288.338 bytes y 1.524.918 filas; pico aproximado de RSS 262,9 MB.
- QA final pequeña de 120 filas en el camino real: completada, 0 fallos y volumen vacío.

Limitación vigente:

- El motor puede procesar archivos muy grandes, pero la subida web de staging está limitada por el proxy/configuración a aproximadamente 50–55 MB.
- La interfaz debe comunicar el límite real; no prometer 500 MB de carga web mientras Caddy no lo permita.

### 5.6 Cotizaciones y PDF

Problemas resueltos:

- Campos de transporte, IVA, ajuste y descuentos por línea existían, pero no eran alcanzables desde DTO/frontend.
- `adjustmentLabel` se aceptaba al crear y se descartaba.
- El total de la cotización era correcto, pero el PDF omitía conceptos y no se podía cuadrar visualmente.

Contrato económico único:

- `quote-desglose.ts` decide conceptos, orden y signo.
- PDF y frontend consumen el mismo desglose.
- Decimal/base de datos siguen siendo autoridad; el cliente no recalcula libremente.
- El PDF real se valida decodificando sus glifos comprimidos/hexadecimales.

Caso de regresión final:

| Concepto | Valor |
|---|---:|
| Subtotal bruto | $500.000 |
| Descuentos por línea | −$100.000 |
| Descuento general | −$25.000 |
| Transporte | +$50.000 |
| Ajuste `QA_HOTFIX_ rebaja` | −$15.000 |
| IVA 19 % | +$77.900 |
| **Total** | **$487.900** |

Paridad comprobada entre base de datos, API, pantalla y PDF. El PDF devuelve 200, firma válida, siete conceptos, sin `NaN` ni `undefined`, y conserva la identidad visual existente.

---

## 6. Estado de staging al pausar

- Release: `b19217c`.
- 56 migraciones aplicadas.
- 0 migraciones fallidas o pendientes.
- Backend, worker y frontend healthy.
- RestartCount 0 después del despliegue validado.
- Smoke test 18/18.
- PostgreSQL, Caddy, Redis y `takto-web` no fueron recreados.
- FlowBot/TAKTO Pulso protegido; cero llamadas reales a Meta.
- Volumen de importaciones vacío.
- Sin restos QA conocidos.
- Conteos funcionales regresaron al baseline; auditorías se conservaron.

### Último backup mencionado

- PostgreSQL: `tehus-crm-staging-20260810-110354.sql.gz`
- SHA-256: `7075cc5acbabd9df8af3cf2e9db8cba32a9f2c95c6fd55a1a1a7b21e6359e9c6`
- Permisos: 600, propietario `deploy:deploy`.
- Restore drill: exitoso e idéntico al baseline.
- Etiquetas de rollback del release anterior `ef532c8`: creadas.

No asumir que este sigue siendo el backup más reciente al reanudar. Crear uno nuevo antes de cualquier despliegue o migración.

---

## 7. Deudas y limitaciones conocidas que no bloquean el branding

1. El tar de uploads puede quedar `644 root:root` porque el `chmod` del script falla dentro del contenedor. No contiene una regresión funcional, pero el runbook/script debe corregirse en un trabajo operativo separado.
2. La carga web de catálogos no admite 500 MB mientras el proxy continúe alrededor de 50–55 MB.
3. Tras morir el worker durante una importación, BullMQ puede tardar hasta aproximadamente 10 minutos en reclamar el trabajo por `lockDuration`.
4. WhatsApp real de TAKTO Pulso no está autorizado ni activado.
5. Verificación de plantillas contra Meta continúa siendo manual.
6. Producción no ha recibido esta reforma.
7. La sociedad, políticas, contratos y documentación legal comercial de TAKTO siguen siendo un frente separado.

Estas deudas deben permanecer documentadas, pero no deben mezclarse con la rama visual salvo que un defecto impida implementar o probar el branding.

---

## 8. Branding oficial preparado

### Paquete local

`brand/TAKTO-BRAND-PACK-V2.0.0/`

Carpeta apta para integración:

`brand/TAKTO-BRAND-PACK-V2.0.0/10-CRM-EXPORT/`

Validaciones anteriores:

- 61 archivos dentro de `10-CRM-EXPORT`.
- 205/205 checksums del paquete completo verificados.
- SVG, PNG, ICO, JSON y fuentes validados.
- Sin secretos, ejecutables o rutas peligrosas.
- `brand/` permanece sin rastrear/ignorado; no versionar el paquete completo.

### Prohibido

- Nunca usar `99-NO-USAR/`.
- No usar `RECHAZADO-isotipo-canal-abierto.svg`.
- No mezclar la identidad TAKTO con logos o colores de empresas cliente.
- No reemplazar branding de cada empresa por TAKTO dentro de espacios donde la empresa debe conservar su identidad.

### Reglas de marca

- Nombre: **TAKTO**.
- `TAK` usa el color primario.
- `TO` usa el color secundario.
- Navy principal: `#131C4A`.
- Naranja principal: `#FF6A00`.
- Para texto naranja fino sobre fondo claro, usar el naranja accesible documentado (`#C24A00`) en lugar de `#FF6A00`.
- Botones naranjas llevan texto navy `#131C4A` cuando el contraste aprobado lo indique.
- Usar tokens, tipografías, logos, favicons e iconos oficiales; no redibujarlos a ojo.
- Respetar zona de seguridad, tamaños mínimos y usos incorrectos del brand pack.
- TAKTO es la plataforma; la empresa cliente conserva su propia identidad en sus datos, documentos y espacios correspondientes.

---

## 9. Próximo trabajo autorizado después de la pausa

Crear desde el `main` actualizado:

`feature/takto-brand-ui-integration`

### Alcance previsto

- Favicon y metadatos.
- Logotipo principal y variantes responsive.
- Fuentes oficiales y estrategia de carga.
- Tokens CSS/Tailwind.
- Colores, tipografía, espaciado, radios, sombras y foco.
- Login y recuperación de acceso.
- Layout, encabezado, barra lateral y navegación.
- Botones, inputs, selects, tablas, cards, badges, modales, drawers, tooltips y estados.
- Dashboard, contactos, pipeline, conversaciones, TAKTO Pulso, tareas, productos, cotizaciones, documentos, automatizaciones, WhatsApp, empresa y datos.
- Panel de plataforma/superadministrador sin mezclar identidad de empresas.
- Estados vacíos, carga, error, desconexión y permisos.
- Responsive y accesibilidad en 1440, 1280, 1024, 768 y 390 px.
- Emails/PDF/documentos solo cuando corresponda y respetando la identidad de la empresa emisora.

### Fuera de alcance de la rama visual

- Nuevas migraciones.
- Cambios de lógica de negocio.
- Activación de WhatsApp real.
- Modificar bots o datos reales.
- Producción.
- Meta, DNS, credenciales o secretos.
- Resolver deudas operativas no visuales sin evidencia de que bloquean el branding.

### Método recomendado

1. Preflight y auditoría del paquete.
2. Inventario visual de pantallas/componentes actuales.
3. Integrar activos seleccionados desde `10-CRM-EXPORT` a rutas versionadas del frontend; no copiar `99-NO-USAR` ni todo el paquete.
4. Construir primitivas/tokens antes de migrar pantallas.
5. Migrar superficies de forma consistente.
6. Pruebas de componentes, typecheck, lint y build.
7. QA visual autenticada y no autenticada en cinco anchos.
8. CI de rama.
9. Revisión humana antes de fusionar.
10. Despliegue a staging en una autorización separada.

---

## 10. Prompt exacto para reanudar con Claude Code

Copiar y pegar este bloque al volver:

```text
Vamos a reanudar TAKTO CRM desde el punto oficial de pausa.

Antes de cualquier acción, lee completamente:
docs/TAKTO-PAUSA-Y-REANUDACION-2026-08-10.md

No repitas trabajo ya cerrado. Trata ese documento como contexto de continuidad, pero verifica sus datos temporales contra Git, GitHub Actions y staging antes de escribir.

Objetivo de esta reanudación:
preparar e iniciar la integración visual oficial de TAKTO en una rama nueva, sin modificar lógica de negocio.

Preflight obligatorio, solo lectura:
1. Confirma el repositorio `C:\Users\Usuario\Desktop\Tehus_Rattan`.
2. Confirma ausencia de `.git/index.lock`.
3. Confirma working tree limpio y `brand/` sin archivos rastreados.
4. Confirma `main == origin/main` y registra el SHA completo. El punto de pausa esperaba `b19217c`; si cambió, detente y explica por qué antes de continuar.
5. Confirma CI verde sobre el SHA actual de main.
6. Confirma en solo lectura que staging sigue sano y registra su release. El punto de pausa esperaba `b19217c`.
7. Confirma 56 migraciones aplicadas, 0 fallidas y 0 pendientes, o explica cualquier diferencia.
8. Confirma que TAKTO Pulso sigue protegido: kill switch activo, envío real bloqueado, dry-run/transporte protegido y allowlists vacías.
9. Confirma los cuatro bots sin cambios: Handoff a asesor archivado; Auto, Captura de datos y LHJKJK en borrador.
10. Confirma que `brand/TAKTO-BRAND-PACK-V2.0.0/10-CRM-EXPORT` existe y que `99-NO-USAR` no se utilizará.

Si y solo si el preflight coincide:
- crea `feature/takto-brand-ui-integration` desde el `main` actualizado;
- no fusiones ni despliegues todavía;
- realiza primero el inventario visual y el plan de aplicación del brand pack;
- usa únicamente activos aprobados de `10-CRM-EXPORT`;
- no versiones el paquete completo;
- no toques backend, Prisma, migraciones, datos, WhatsApp real, Meta, DNS, credenciales ni producción;
- conserva intacta la identidad de las empresas cliente;
- registra cada decisión y avance en un archivo de estado dentro de `docs/` para poder pausar nuevamente sin perder contexto.

Antes de terminar la primera sesión de branding, deja:
- rama publicada;
- CI verde para lo implementado;
- working tree limpio;
- estado actualizado;
- próximo comando seguro;
- lista honesta de pantallas terminadas y pendientes.

Si cualquier condición no coincide, no improvises: detente y reporta la diferencia con evidencia.
```

---

## 11. Checklist de reanudación rápida

- [ ] Documento leído completo.
- [ ] Repo y rama verificados.
- [ ] `main == origin/main`.
- [ ] CI verde del SHA actual.
- [ ] Working tree limpio y sin lock.
- [ ] `brand/` no rastreado.
- [ ] Staging sano y release registrado.
- [ ] Migraciones verificadas.
- [ ] FlowBot protegido.
- [ ] Cuatro bots intactos.
- [ ] Brand pack y checksums verificados.
- [ ] `99-NO-USAR` excluido.
- [ ] Rama de branding creada desde el `main` vigente.
- [ ] Estado de continuidad nuevo preparado.

---

## 12. Qué no debe hacer quien reanude

- No ejecutar una “auditoría desde cero” ignorando este punto de control.
- No declarar que el CRM está incompleto basándose en reportes antiguos.
- No volver a implementar el motor durable, importaciones o cotizaciones ya cerrados.
- No interpretar `347b957`, `0b8ebba` o `ef532c8` como release actual sin verificar.
- No apagar el kill switch para quitar un aviso visual.
- No llamar “simulación” a la activación de un bot si sus acciones CRM son reales.
- No copiar secretos desde `.env` a logs, comandos, documentos o conversaciones.
- No borrar datos reales, bots, auditorías o backups.
- No usar comandos destructivos para “limpiar” el repositorio.
- No fusionar, desplegar o activar producción por iniciativa propia.

---

## 13. Cierre de la pausa

El proyecto queda pausado en un estado estable, reproducible y con ruta de continuación definida.

**Siguiente objetivo:** integración visual oficial de TAKTO.  
**Primera acción al volver:** leer este documento y ejecutar únicamente el preflight.  
**Acción prohibida durante la pausa:** continuar monitores, despliegues, pushes o procesos en segundo plano.

