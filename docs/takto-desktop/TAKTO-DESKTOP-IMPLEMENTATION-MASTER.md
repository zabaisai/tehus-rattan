# TAKTO Desktop — plan maestro de integración funcional y visual

## 1. Propósito y autoridad

Este documento es la fuente de verdad para integrar los mockups desktop
aprobados con el CRM real. El objetivo no es «ponerle colores» al producto: es
convertirlo en una experiencia coherente, relacionada, operable y demostrada de
extremo a extremo, conservando todo lo que hoy funciona.

Orden de autoridad ante contradicciones:

1. Seguridad, aislamiento multiempresa e integridad de datos.
2. Contratos funcionales y criterios de aceptación de este documento.
3. Mockups de `mockups/` para estructura, jerarquía e interacción.
4. `docs/DESIGN-SYSTEM.md` y los tokens oficiales del brand pack.
5. Implementación actual, que debe caracterizarse y reutilizarse.

El trabajo es **desktop primero**. Se aceptan 1920, 1440, 1280 y 1024 px en
esta etapa. El rediseño móvil se planificará cuando los gates desktop estén
verdes; no se debe improvisar una versión móvil durante estos incrementos.

## 2. Preflight obligatorio

Antes de cada sesión que escriba código:

1. Leer completos este documento y `TAKTO-DESKTOP-IMPLEMENTATION-STATE.md`.
2. Leer los documentos de continuidad existentes relacionados con el incremento.
3. Confirmar raíz, rama, HEAD, remoto, árbol, `index.lock` y CI del SHA.
4. Preservar cualquier cambio del usuario; `brand/` nunca se versiona.
5. Confirmar que existen los 26 mockups y que sus nombres coinciden con el índice.
6. Auditar la capacidad objetivo y clasificarla `HECHO`, `PARCIAL` o `FALTANTE`.
7. Ejecutar las pruebas base relevantes antes de cambiar comportamiento.
8. Confirmar que local no apunta a staging/producción y que WhatsApp, Meta, SMTP,
   HTTP e IA no pueden provocar efectos externos durante QA.

Rama de trabajo prevista: `feature/takto-brand-ui-integration`. Si existe, se
continúa solo si está limpia y su historia coincide con el estado. Si no existe,
su creación desde `main` requiere primero verificar el SHA aprobado. No se debe
fusionar, desplegar ni tocar staging desde este plan sin autorización separada.

## 3. Decisiones visuales no negociables

### 3.1 Lenguaje visual

- Navy profundo para navegación, acciones primarias y foco de jerarquía.
- Naranja TAKTO como acento selectivo, no como relleno dominante de la página.
- Fondos azul-gris muy claros para separar zonas; tarjetas blancas elevadas.
- Contraste y densidad suficientes para que la interfaz no parezca una hoja en
  blanco ni un conjunto de formularios inconexos.
- Bordes suaves, sombras contenidas, radios coherentes y espacios en una escala
  única; nada de valores arbitrarios repetidos por pantalla.
- Estados con color **y** texto/icono; nunca depender solo del color.
- Iconos de una sola familia. Los controles sin texto requieren nombre accesible.
- No usar fotos de perfil ni rostros. Para personas, usar iniciales o icono
  neutro. Las fotografías de productos sí están permitidas y son deseables.
- Los códigos hexadecimales no son la interfaz principal: para etapas y marca se
  muestran swatches, nombre del color y selector visual; el valor técnico puede
  quedar como detalle avanzado.

### 3.2 Movimiento e interacción

- Transiciones de 140–220 ms para hover, selección, drawers y cambios de estado.
- Arrastre con respuesta visible en pipeline y constructor; no animación decorativa.
- Skeletons para carga; estados vacíos orientan a la siguiente acción.
- Confirmaciones destructivas claras, con nombre y consecuencia del objeto.
- Soportar `prefers-reduced-motion`; el producto debe funcionar sin animaciones.
- Ninguna acción principal puede depender de descubrir un scroll invisible.

### 3.3 Jerarquía común de pantalla

Todas las superficies principales usan:

1. título y propósito breve;
2. una acción primaria y acciones secundarias agrupadas;
3. resumen/filtros solo cuando cambien decisiones;
4. contenido principal;
5. detalle contextual en drawer o panel, sin expulsar al usuario de su tarea;
6. estados de carga, vacío, error, sin permiso y éxito.

## 4. Modelo funcional transversal

El producto debe sentirse como un solo CRM, no como módulos aislados. Estos son
los enlaces mínimos:

| Origen | Destino/relación obligatoria |
|---|---|
| Contacto | conversaciones, oportunidades, tareas, cotizaciones, documentos, campos e historial |
| Conversación | contacto, número WhatsApp, oportunidad abierta, etapa, tareas y cotizaciones |
| Oportunidad | contacto, conversación de origen, etapa, responsable, tareas, cotizaciones y actividad |
| Tarea | contacto y, cuando aplique, conversación/oportunidad/cotización que la originó |
| Cotización | contacto, oportunidad, conversación, responsable, documento enviado y estado |
| Documento | contacto/oportunidad/cotización y registro de envío/descarga |
| Pulso/regla | disparador, ejecución, conversación, efectos propuestos/realizados y auditoría |

Antes de crear columnas o tablas, auditar el esquema: algunas relaciones ya
pueden existir. No duplicar una capacidad porque la UI actual no la expone.

### 4.1 Contacto archivado o eliminado

«Eliminar» desde la UI significa mover a papelera/archivar de forma reversible,
salvo un flujo administrativo separado de eliminación definitiva y retención.
Un contacto archivado:

- desaparece del listado activo y aparece en Papelera;
- conserva mensajes, conversaciones, oportunidades, tareas, cotizaciones y
  auditorías;
- sigue mostrando su identidad histórica dentro de los chats;
- no se puede seleccionar para acciones nuevas salvo restaurarlo;
- puede restaurarse sin crear duplicados.

La fusión de duplicados requiere vista previa, elección del valor por campo,
traslado transaccional de relaciones, alias/redirección del contacto absorbido y
auditoría. Nunca borrar conversaciones para «limpiar» un contacto.

### 4.2 Tareas sugeridas por IA/bots

La automatización puede **proponer**, no ejecutar silenciosamente acciones de un
asesor. Ciclo mínimo:

`SUGERIDA → APROBADA o DESCARTADA → PROGRAMADA → COMPLETADA/CANCELADA`.

La propuesta muestra origen, conversación, contacto, acción, fecha sugerida y
razón. El asesor puede editarla antes de aprobar. Enviar una cotización, foto o
mensaje requiere además respetar permisos, ventana de WhatsApp y guardarraíles.

### 4.3 Navegación con contexto

- Desde una tarjeta de pipeline se abre la conversación vinculada, no una lista
  genérica; el contacto y oportunidad quedan seleccionados.
- Desde chat se abre el perfil 360, se crea una tarea, cotización o movimiento de
  etapa y se vuelve al mismo hilo.
- Las URLs deben ser profundas y recargables, por ejemplo mediante IDs en ruta o
  query; no guardar la selección únicamente en estado de React.

## 5. Arquitectura y guardarraíles

### 5.1 Backend

- Toda consulta y mutación acotada por `companyId` en la consulta, no filtrada en
  memoria después.
- Operaciones relacionales críticas (fusión, cambio de etapa con efectos,
  publicación, importación) transaccionales e idempotentes.
- Dinero con Decimal/NUMERIC y un único contrato de cálculo para API, pantalla y
  PDF.
- Trabajo pesado en worker durable; PostgreSQL es fuente de verdad y Redis una
  ayuda de ejecución, no el único registro.
- Auditoría para archivo/restauración/fusión, cambios de etapa, aprobación de
  sugerencias, importación, publicación de bots, envíos y roles.
- Ningún endpoint acepta un `companyId` del cliente para saltarse el tenant de la
  sesión.

### 5.2 Frontend

- Contratos tipados; centralizar claves de consulta, estados, formatos y rutas.
- Reutilizar componentes y tokens. No repetir clases extensas para 48 botones.
- Formularios accesibles, validación inline, errores accionables y preservación
  de entrada ante fallos.
- Optimismo solo cuando exista rollback visual claro. Operaciones destructivas y
  financieras esperan confirmación del servidor.
- Listados grandes paginados/virtualizados cuando corresponda.

### 5.3 Importación de catálogos grandes

El requisito comercial es admitir archivos grandes sin cargar 500 MB completos
en memoria ni depender de `/tmp` privado de un contenedor. La solución objetivo:

- `.xlsx` y `.csv`, con límite real mostrado antes de subir;
- carga multipart/chunked o directa a almacenamiento compartido/objeto;
- trabajo persistido con checksum, tamaño, estado, progreso y usuario;
- worker leyendo la misma fuente durable;
- mapeo de columnas y previsualización de muestra antes de confirmar;
- procesamiento por lotes, pausa/cancelación/reintento/reanudación;
- reporte descargable por fila sin incluir datos de otra empresa;
- idempotencia por importación/SKU configurable;
- imágenes por URL, imagen embebida si el formato lo permite o ZIP asociado por
  SKU; validar MIME, tamaño y destino, no ejecutar contenido del archivo;
- temporales con retención y limpieza demostrada.

Si Caddy o el hosting impiden recibir 500 MB, no prometerlo mediante un número:
usar carga directa/chunked o mostrar el límite efectivo. La prueba de cierre debe
recorrer navegador → API → almacenamiento → cola → worker → base.

### 5.4 WhatsApp, Pulso e integraciones

- Desarrollo, simulación y QA usan transporte falso/dry-run.
- Publicar un bot no equivale a activarlo; importar JSON nunca lo activa.
- Envíos reales exigen configuración, número, plantilla/ventana, permisos,
  allowlists, límites, circuit breaker y kill switch.
- Nunca incluir tokens o PII en logs, jobs, URLs, métricas o capturas.
- HTTP personalizado conserva protección SSRF y allowlist; IA permanece detrás
  de una interfaz intercambiable.

## 6. Programa de implementación por dependencias

Cada fase se divide en incrementos verticales pequeños. Un incremento incluye
contrato, datos, API, UI, pruebas, QA y estado; no se considera entregado si solo
existe el mockup o el endpoint.

### Fase 0 — auditoría, caracterización y mapa de reutilización

**Mockups:** todos, como inventario; no se implementa UI nueva todavía.

Entregables:

- matriz `HECHO/PARCIAL/FALTANTE` con rutas y pruebas reales;
- mapa de entidades y enlaces existentes;
- inventario de componentes/tokens/rutas/endpoints reutilizables;
- baseline de tests, migraciones y deuda;
- lista priorizada de gaps que requieren decisión de producto.

Cierre: estado actualizado y primer incremento de fase 1 definido con archivos y
pruebas concretas. No aceptar afirmaciones históricas sin reproducción.

### Fase 1 — fundamentos visuales y componentes de producto

**Mockups:** patrones comunes de 01–26.

Construir o consolidar:

- tokens semánticos de color, tipografía, espacio, radio, sombra y movimiento;
- `AppShell`, encabezado, navegación, superficie, tarjeta, tabs, filtros, tabla,
  drawer, modal, toast, skeleton, empty/error/forbidden state;
- botones, badges, avatar de iniciales, selector de swatches, menús y tooltips;
- layout desktop adaptable 1920–1024 y foco/teclado/reduced motion.

Cierre: Story/demo local de estados, tests de primitivas y cero colores de marca
escritos a mano fuera de tokens justificados.

### Fase 2 — shell operativo, inicio, búsqueda y notificaciones

**Mockups:** 01, 16, 17.

- dashboard con actividad, métricas accionables y próximos pasos;
- búsqueda global por contactos, conversaciones, oportunidades, productos,
  cotizaciones y documentos, aislada por empresa;
- comando de creación rápida;
- notificaciones priorizadas, leídas/no leídas y deep links.

Cierre: resultados llevan al objeto exacto; teclado funciona; dashboard no usa
datos ficticios; contadores concuerdan con las listas.

### Fase 3 — contactos, conversaciones y perfil 360

**Mockups:** 02, 03, 18, 22.

Incrementos sugeridos:

1. listado/papelera/restauración;
2. perfil 360 con historial y objetos relacionados;
3. inbox de tres paneles con perfil colapsable y URL profunda;
4. fusión transaccional de duplicados.

Cierre: archivar nunca rompe el chat; restaurar y fusionar preservan relaciones;
desde un contacto o pipeline se abre el hilo exacto; 0 fugas entre empresas.

### Fase 4 — pipeline vertical, tareas y acciones desde chat

**Mockups:** 04, 07, 19, 20, 21.

- pipeline vertical por etapa, densidad controlada y detalle contextual;
- selector de color con swatches, no hex crudo;
- mover oportunidad con validaciones, razones y actualización en tiempo real;
- tareas pendientes/completadas/sugeridas con relaciones visibles;
- crear cotización/tarea desde chat y volver al hilo;
- sugerencias automáticas con aprobación humana.

Cierre: creación de lead entrante cae en la etapa inicial configurada; ningún bot
realiza una tarea del asesor sin aprobación; cambio concurrente no duplica efectos.

### Fase 5 — productos, imágenes e importación durable

**Mockups:** 08, 09.

- catálogo visual con subir imagen, URL segura, reemplazar/eliminar y fallback;
- almacenamiento y variantes/miniaturas con aislamiento;
- wizard de importación: carga, mapeo, muestra, validación, ejecución, progreso,
  cancelación, reanudación y reporte;
- camino probado con catálogo grande y memoria acotada.

Cierre: importación real cercana al límite comercial, reinicio de worker sin
duplicados, errores por fila y temporales eliminados; imágenes válidas visibles.

### Fase 6 — cotizaciones y documentos de marca

**Mockups:** 10, 11, 19.

- editor con línea, descuentos, transporte, ajuste, impuestos y total reconciliado;
- vista previa server-side con logotipo, color, datos de empresa y paginación;
- plantilla/versionado para que una cotización emitida no cambie retroactivamente;
- enviar/descargar desde chat, relacionar a oportunidad y mover a etapa Cotizado
  mediante una acción explícita/configurable;
- documentos filtrables, relacionados y auditados.

Cierre: base = API = pantalla = PDF; suma visible cuadra; una cotización enviada
conserva el documento exacto; sin `NaN`, desbordes ni pérdida de marca.

### Fase 7 — TAKTO Pulso y reglas automáticas

**Mockups:** 05, 06, 12, 23.

- biblioteca de bots simplificada y estado operativo relegado a un panel claro;
- editor con paleta, lienzo, minimapa, inspector, validación, simulación,
  deshacer/rehacer y autoguardado comprensible;
- importación JSON con esquema/versionado, vista previa, migración segura y reporte;
- reglas operativas separadas de bots conversacionales;
- ejecuciones y métricas legibles.

Cierre: usuario no técnico puede crear desde plantilla, corregir errores, simular,
publicar sin activar e importar sin ejecutar; JSON malicioso/incompatible se rechaza.

### Fase 8 — WhatsApp, empresa, equipo y centro de datos

**Mockups:** 13, 14, 15, 25.

- varios números por empresa con salud, nombre, uso y número predeterminado;
- configuración de marca con preview que alimenta UI y documentos;
- equipo, invitaciones y roles con permisos efectivos;
- importar/exportar, retención, privacidad, backups y auditoría visibles.

Cierre: número correcto resuelve empresa y envío; roles se prueban por endpoint y
UI; cambios de marca no alteran documentos históricos; exportaciones son del tenant.

### Fase 9 — acceso, recuperación y configuración inicial

**Mockups:** 24, 26.

- login y recuperación con mensajes seguros;
- sesiones/dispositivos y revocación;
- onboarding reanudable para empresa, equipo, WhatsApp, pipeline, catálogo y Pulso;
- checklist que diferencia configuración requerida de opcional.

Cierre: no hay enumeración de cuentas; rotación/revocación demostrada; abandonar y
reanudar onboarding no duplica empresa, pipeline ni integración.

### Fase 10 — QA desktop y gate de integración

- recorrido funcional completo en Chrome y Edge;
- 1920/1440/1280/1024, zoom 200 %, teclado y reduced motion;
- contraste WCAG AA, nombres accesibles, foco y lectura de errores;
- estados vacío/carga/error/sin permiso/offline/conflicto;
- aislamiento multiempresa y matriz de roles;
- E2E del recorrido: mensaje → contacto/conversación → lead inicial → tarea
  sugerida/aprobada → cotización → documento → etapa;
- imágenes Docker, migración desde copia de datos y rollback ensayado;
- revisión visual contra los 26 mockups y deuda explícita.

Cierre: CI verde en el SHA exacto, árbol limpio, estado final y decisión demostrada
`APTO PARA REVISIÓN DE FUSIÓN` o `NO APTO`. No fusionar ni desplegar como parte del gate.

## 7. Contratos/API que deben existir o verificarse

Los nombres concretos se adaptan a las convenciones del repositorio; no crear una
segunda API si ya existe. Capacidades mínimas:

| Dominio | Capacidades |
|---|---|
| Contactos | listar activos/papelera, archivar, restaurar, perfil 360, candidatos de fusión, fusionar |
| Conversaciones | listar/filtrar, detalle con contacto/lead/tareas/cotizaciones, deep link, asignar/handoff |
| Pipeline | vistas/etapas, swatches, mover con versión, detalle relacionado, eventos tiempo real |
| Tareas | pendientes/completadas/sugeridas, aprobar/editar/descartar, relación y auditoría |
| Productos | CRUD, media upload/delete, import jobs, mapping/preview/start/progress/cancel/report |
| Cotizaciones | CRUD económico, preview/PDF versionado, enviar, relacionar y actualizar etapa |
| Documentos | listar, filtrar, descargar autorizado, relaciones y eventos |
| Pulso | catálogo, borrador/versiones, validar, simular, importar/exportar JSON, ejecuciones/métricas |
| Búsqueda | búsqueda tenant-wide, tipos, permisos, deep links y límites |
| Notificaciones | listado, unread, marcar, preferencias y deep links |
| WhatsApp | números, estado, default, plantillas y pruebas seguras |
| Empresa/equipo | marca, preferencias, roles, invitaciones, sesiones y auditoría |

## 8. Matriz de pruebas mínima por incremento

Cada incremento debe cubrir, según aplique:

### Backend

- caso feliz y errores de contrato;
- 404 sin revelar recursos ajenos y cero escrituras en otro tenant;
- rol autorizado y roles denegados;
- idempotencia/concurrencia/transacción;
- auditoría sin secretos;
- E2E contra PostgreSQL real para relaciones y constraints;
- worker/reintento/recuperación para operaciones durables.

### Frontend

- render, interacción y errores;
- teclado, foco, nombres accesibles y reduced motion;
- carga, vacío, error, sin permiso, conflicto y éxito;
- rutas profundas recargables;
- anchos 1920/1440/1280/1024 sin desborde de página;
- consola sin errores ni warnings nuevos.

### Visual

- comparar estructura y jerarquía con el mockup correspondiente;
- usar datos realistas, incluidos textos largos y listas densas;
- verificar que color, texto, iconos y acciones no se contradigan;
- capturas antes/después guardadas como evidencia, no como código del producto.

## 9. Definición de terminado

Una capacidad está `HECHA` únicamente cuando:

1. satisface el flujo observable completo, no solo su componente;
2. usa datos reales de la API y preserva relaciones;
3. respeta tenant, permisos, auditoría y seguridad;
4. tiene estados alternos y errores comprensibles;
5. pasa pruebas relevantes y el CI del SHA si está disponible;
6. fue revisada en los cuatro anchos desktop;
7. no degrada lo existente ni deja datos QA/temporales;
8. está documentada en el estado con limitaciones honestas;
9. puede reanudarse desde el siguiente comando sin repetir trabajo;
10. no depende de staging para «ver si funciona».

Un mockup, una ruta vacía, un endpoint sin consumidor, una prueba solo con mocks o
un porcentaje estimado no satisfacen esta definición.

## 10. Disciplina de Git y continuidad

- Commits pequeños por incremento comprobable; no commits de «todo el rediseño».
- Publicar solo `feature/takto-brand-ui-integration`.
- No force push, no rebase destructivo, no reset hard y no borrar ramas.
- No incluir `brand/`, `.env`, dumps, datos QA, capturas con PII ni artefactos de build.
- Actualizar el archivo de estado antes de cada pausa larga y después de cada gate.
- El informe de cierre separa: entregado, verificado, deuda, bloqueadores, SHA y
  siguiente incremento.

## 11. Cortes de entrega recomendados

Para permitir revisión visual sin esperar meses:

| Corte | Incluye | Resultado revisable |
|---|---|---|
| A | Fases 0–2 | lenguaje visual, shell, dashboard, búsqueda y notificaciones |
| B | Fases 3–4 | núcleo CRM conectado: contacto, chat, pipeline y tareas |
| C | Fases 5–6 | catálogo/importación y ciclo comercial de cotización/documento |
| D | Fases 7–9 | Pulso, reglas, WhatsApp, administración y onboarding |
| E | Fase 10 | candidato desktop completo para revisión de fusión |

Cada corte se revisa en localhost con build de producción y datos ficticios
aislados. La aprobación visual de un corte no autoriza su despliegue.

## 12. Fuera de alcance de esta etapa

- Rediseño móvil definitivo.
- Activación o envío real de WhatsApp/Meta.
- Despliegue a staging/producción y fusión a `main`.
- Reemplazar infraestructura funcional sin evidencia de necesidad.
- Entrenar modelos propios de IA.
- Eliminación definitiva masiva de datos reales.

Estas tareas requieren planes y autorizaciones separados.

