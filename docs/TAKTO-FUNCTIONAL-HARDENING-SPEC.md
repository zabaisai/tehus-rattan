Vamos a realizar una estabilización funcional integral del CRM TAKTO antes de continuar con el rediseño visual o activar WhatsApp real.

No quiero otra entrega parcial ni una demostración superficial. Debes trabajar de forma continua, por secciones, hasta completar todo el alcance verificable. No me pidas autorización entre secciones. Solo detente ante un bloqueo real de seguridad, pérdida de datos, migración destructiva, secreto expuesto o decisión comercial imposible de inferir.

No declares “100 % libre de errores”, porque eso no es demostrable. El criterio de cierre será:

* cero defectos críticos o altos conocidos;
* cero botones visibles que no funcionen;
* cero errores silenciosos conocidos;
* todos los flujos principales probados;
* aislamiento multiempresa probado;
* frontend, backend, worker, Redis y PostgreSQL verificados;
* unitarias, E2E, typecheck, lint, build y Docker en verde;
* QA funcional y responsive;
* limitaciones residuales documentadas.

==================================================

1. REPOSITORIO, ESTADO Y CONTEXTO CONFIRMADO
   ==================================================

Repositorio:

C:\Users\Usuario\Desktop\Tehus_Rattan

Antes de escribir:

1. Lee completamente:

   * docs/TAKTO-IMPLEMENTATION-STATE.md
   * docs/TAKTO-FLOWBOT-STATE.md
   * docs/DESIGN-SYSTEM.md
   * runbook vigente de staging
   * apps/backend/prisma/schema.prisma
   * workflows de GitHub Actions
   * documentación existente de contactos, pipelines, conversaciones, tareas, productos, cotizaciones y FlowBot.

2. Verifica sin asumir:

   * main == origin/main;
   * release esperado alrededor de 347b957, pero confirma el SHA exacto;
   * árbol limpio salvo brand/ no rastreado;
   * ausencia de .git/index.lock;
   * staging sano;
   * PostgreSQL, Caddy y takto-web intactos;
   * transporte real de FlowBot apagado;
   * dry-run activo;
   * kill switch activo;
   * allowlists vacías.

3. La QA autenticada de staging ya terminó:

   * 49/49 verificaciones API;
   * 40 capturas;
   * cinco resoluciones;
   * cero desbordamientos;
   * cero errores de consola;
   * datos temporales eliminados;
   * siete contenedores sanos;
   * conteos iguales al baseline;
   * cero mensajes reales enviados.

No repitas esa QA inicial ni crees usuarios temporales durante el desarrollo local.

4. Datos reales que debes preservar:

   * existen bots creados legítimamente por [admin.crm.staging@tehusrattan.com](mailto:admin.crm.staging@tehusrattan.com);
   * no debes eliminarlos, archivarlos, publicarlos, renombrarlos ni convertirlos en datos de prueba;
   * no interpretes bots recientes como QA;
   * existe una empresa residual QA_E2E_TEMP_Co de una sesión anterior;
   * repórtala, pero no la elimines dentro de este alcance;
   * conserva todas las auditorías existentes;
   * no modifiques usuarios reales.

5. Crea o reanuda exclusivamente:

feature/takto-functional-hardening

La rama debe partir de origin/main. No trabajes directamente sobre main.

6. Crea y mantén actualizado:

docs/TAKTO-FUNCTIONAL-HARDENING-STATE.md

Debe incluir:

* SHA inicial;
* baseline;
* hallazgos;
* decisiones;
* migraciones;
* commits;
* pruebas;
* limitaciones;
* siguiente comando seguro;
* punto exacto de reanudación.

7. Si se agota la sesión:

   * termina la verificación del cambio actual;
   * deja el árbol limpio;
   * publica la rama;
   * actualiza el documento de estado;
   * indica el siguiente comando y archivo;
   * continúa en la siguiente sesión sin repetir bloques terminados.

==================================================
2. LÍMITES Y PROHIBICIONES
==========================

Durante este encargo:

* no despliegues;
* no fusiones a main;
* no modifiques staging;
* no ejecutes migraciones en staging;
* no toques producción;
* no toques DNS;
* no toques Meta Developers;
* no envíes mensajes reales;
* no desactives el kill switch;
* no habilites transporte real;
* no añadas empresas o usuarios reales;
* no borres auditorías;
* no modifiques brand/;
* no hagas force push;
* no uses reset --hard;
* no ejecutes formateos masivos;
* no mezcles archivos ajenos;
* no imprimas secretos;
* no leas .env con comandos que puedan volcar valores;
* no cambies el sistema visual completo todavía.

Puedes realizar los ajustes visuales mínimos necesarios para que las funciones sean utilizables, pero no comiences una nueva fase de branding.

Haz commits pequeños y coherentes por dominio.

==================================================
3. BASELINE Y AUDITORÍA FUNCIONAL
=================================

Antes de implementar, caracteriza el comportamiento actual con pruebas.

Audita:

* contactos;
* conversaciones;
* pipelines;
* tareas;
* productos;
* importaciones;
* cotizaciones;
* documentos PDF;
* Pulso/FlowBot;
* permisos;
* navegación;
* deep links;
* worker;
* Redis;
* colas;
* outbox;
* archivos temporales;
* compatibilidad Windows/Linux;
* smoke tests;
* errores de consola;
* respuestas 4xx/5xx;
* errores silenciosos;
* botones y menús sin efecto.

Para cada defecto registra:

* pasos de reproducción;
* resultado actual;
* resultado esperado;
* causa raíz;
* severidad;
* archivos responsables;
* prueba que evitará la regresión.

No dupliques funcionalidades que ya existen. Si algo está parcialmente implementado, corrige y reutiliza.

Corrige el smoke-test que consulta localhost si staging realmente entra por Caddy.

==================================================
4. CONTACTOS: ARCHIVO, PAPELERA Y ELIMINACIÓN
=============================================

Hallazgo confirmado:

El botón visible “Eliminar contacto” actualmente archiva el contacto. No lo trates como un fallo de persistencia.

Corrige la semántica y la experiencia:

1. Renombra la acción actual a “Archivar”.
2. Explica que el contacto saldrá de los listados activos, pero conservará su historial.
3. Añade:

   * contactos activos;
   * contactos archivados;
   * papelera;
   * restaurar;
   * eliminar definitivamente cuando sea seguro.

Antes de eliminar muestra el impacto sobre:

* conversaciones;
* mensajes;
* oportunidades;
* tareas;
* cotizaciones;
* documentos;
* campos personalizados;
* ejecuciones de Pulso;
* auditorías;
* asignaciones;
* archivos.

Política obligatoria:

* Un contacto vacío, sin relaciones ni historia, puede eliminarse físicamente.
* Un contacto con historia se archiva por defecto.
* Si se solicita eliminación definitiva con historia, preserva la integridad comercial y legal mediante anonimización de PII cuando corresponda.
* Nunca ejecutes cascadas ciegas.
* Nunca borres mensajes o auditorías accidentalmente.
* Exige confirmación reforzada para eliminación definitiva.
* Registra actor, empresa, motivo e impacto.
* Un contacto archivado que vuelva a escribir debe seguir la política configurada de restauración.
* Evita duplicados mediante teléfono normalizado.
* Toda operación debe filtrar companyId.
* Dos empresas pueden tener el mismo teléfono sin mezclarse.

Prueba:

* archivar;
* restaurar;
* eliminar contacto vacío;
* bloquear o anonimizar contacto con historial;
* concurrencia;
* repetición idempotente;
* aislamiento entre empresas.

==================================================
5. PIPELINES COMPLETAMENTE FUNCIONALES
======================================

Corrige el CRUD y retiro de pipelines.

Debe poderse:

* crear;
* editar;
* renombrar;
* reordenar;
* establecer predeterminado;
* definir etapa inicial;
* crear, editar y reordenar etapas;
* archivar;
* restaurar;
* eliminar un pipeline vacío;
* trasladar oportunidades antes de retirar uno usado.

Nunca elimines oportunidades silenciosamente.

Si un pipeline tiene oportunidades, muestra:

* cantidad afectada;
* cancelar;
* archivar pipeline;
* seleccionar pipeline y etapa de destino;
* trasladar oportunidades;
* confirmar retiro después del traslado.

Garantiza:

* un solo pipeline predeterminado por empresa;
* una sola etapa inicial por pipeline;
* restricciones transaccionales;
* concurrencia segura;
* aislamiento por companyId;
* auditoría.

No busques etapas o pipelines por nombres literales.

==================================================
6. PERFIL LATERAL Y NAVEGACIÓN PIPELINE ↔ CHAT
==============================================

Crea un contrato y componente reutilizable de perfil comercial.

En cada tarjeta del kanban:

* el clic principal abre un panel lateral plegable;
* “Abrir conversación” navega al chat exacto;
* conserva pipeline, filtros, etapa, scroll y ruta de regreso.

El panel debe mostrar:

* nombre;
* teléfono;
* empresa;
* etiquetas;
* asesor;
* pipeline;
* etapa;
* valor;
* último mensaje;
* tareas pendientes;
* cotizaciones;
* campos personalizados;
* actividad;
* acciones rápidas.

En Conversaciones usa el mismo panel:

* lateral en escritorio;
* drawer en móvil;
* abrir/cerrar sin perder el chat;
* URL estable con conversationId;
* soportar recarga;
* deep link directo;
* volver al pipeline conservando estado.

Acciones disponibles:

* archivar/restaurar contacto;
* proponer o crear tarea según permisos;
* crear cotización;
* mover etapa;
* cambiar asesor;
* abrir oportunidad;
* ver historial.

No dupliques consultas ni lógica en Pipeline y Conversaciones.

==================================================
7. TAREAS AUTOMÁTICAS CON APROBACIÓN DEL ASESOR
===============================================

No permitas que Pulso o una automatización cree tareas humanas directamente sin aprobación inicial.

Implementa una entidad durable, por ejemplo TaskSuggestion, con:

* PENDING;
* APPROVED;
* REJECTED;
* EXPIRED;
* CANCELLED.

Debe registrar:

* companyId;
* contactId;
* conversationId;
* leadId;
* flowbotId o regla;
* motivo;
* extracto mínimo necesario;
* título;
* descripción;
* prioridad;
* vencimiento;
* asesor sugerido;
* clave de idempotencia;
* actor que aprobó/rechazó;
* timestamps.

Fuentes:

* mensaje entrante;
* intención detectada;
* Pulso;
* cambio de etapa;
* ausencia de respuesta;
* cotización enviada;
* cotización próxima a vencer;
* solicitud de llamada;
* compromiso del asesor;
* seguimiento pendiente.

Flujo:

1. Se genera una propuesta.
2. El asesor recibe notificación.
3. La ve en conversación, contacto, pipeline y tareas.
4. Puede editarla.
5. Puede aprobarla o rechazarla.
6. Solo la aprobación crea la tarea real.
7. Dos aprobaciones concurrentes crean una sola tarea.
8. La decisión queda auditada.

Añade un nodo de Pulso “Sugerir tarea”, distinto de “Crear tarea”.

La configuración inicial por empresa debe exigir aprobación. La IA debe ser opcional: el flujo básico debe funcionar con reglas.

==================================================
8. IMPORTACIÓN DE PRODUCTOS HASTA 500 MB
========================================

La importación debe soportar catálogos grandes.

Formatos:

* CSV;
* XLSX;
* límite de protocolo configurable hasta 500 MB.

No cargues el archivo completo en el navegador ni en memoria del backend.

Arquitectura:

* multipart o carga por fragmentos;
* almacenamiento temporal controlado;
* procesamiento asíncrono;
* worker y cola;
* progreso;
* cancelación;
* estado durable;
* reanudación cuando sea viable;
* vista previa;
* mapeo de columnas;
* validación por fila;
* inserción/upsert por lotes;
* deduplicación por SKU dentro de la empresa;
* reporte descargable;
* creados;
* actualizados;
* omitidos;
* fallidos;
* idempotencia por importación;
* limpieza de temporales.

Seguridad:

* rechaza XLSM y macros;
* no ejecutes fórmulas;
* protege contra zip bombs;
* limita tamaño descomprimido;
* limita filas y columnas;
* limita longitud de celda;
* sanitiza CSV;
* evita CSV injection;
* verifica espacio libre;
* limita concurrencia;
* nunca mezcles empresas.

Usa lectura streaming para CSV y XLSX.

No subas archivos grandes al repositorio. Genera archivos temporales para pruebas.

Realiza una prueba de carga grande y reporta:

* tamaño;
* filas;
* tiempo;
* memoria máxima;
* velocidad;
* errores;
* uso de disco;
* limpieza final.

Si el VPS no soporta de manera segura 500 MB, no lo ocultes. Mantén el límite configurable y documenta el límite operativo medido.

==================================================
9. COTIZACIONES Y DOCUMENTOS FUNCIONALES
========================================

El cálculo monetario del backend será la autoridad.

Usa Decimal, nunca Float ni aritmética monetaria con number de JavaScript.

Soporta:

* cantidad;
* precio unitario;
* subtotal de línea;
* descuento por línea;
* descuento general;
* ajustes positivos;
* ajustes negativos;
* transporte;
* impuestos configurables;
* IVA incluido o adicional;
* subtotal;
* descuentos totales;
* impuestos totales;
* total;
* moneda;
* redondeo por empresa.

El frontend puede calcular para vista inmediata, pero el servidor recalcula y valida.

Implementa:

* borrador;
* numeración;
* versiones/revisiones;
* PDF en servidor;
* branding correcto;
* paginación;
* condiciones;
* vigencia;
* envío;
* historial;
* idempotencia;
* aceptación;
* rechazo;
* vencimiento;
* cancelación.

Toda cotización debe poder vincularse a:

* contacto;
* conversación;
* oportunidad;
* empresa;
* asesor.

Al crear o enviar:

* mueve o crea la oportunidad en el pipeline y etapa de cotizaciones configurados;
* nunca uses el nombre literal “Cotizaciones”;
* si falta configuración, explica cómo resolverlo;
* registra auditoría;
* evita oportunidades duplicadas.

En pruebas, WhatsApp debe permanecer dry-run. No envíes correos reales.

Prueba cálculos con:

* varios productos;
* cantidades;
* descuento por línea;
* descuento general;
* transporte;
* IVA;
* ajuste negativo;
* redondeo;
* revisión;
* PDF;
* asociación al pipeline;
* reintento de envío sin duplicar.

==================================================
10. RENOMBRAR FLOWBOT A TAKTO PULSO
===================================

Usa “TAKTO Pulso” como nombre visible provisional.

Centraliza el nombre visible para poder cambiarlo después.

No renombres:

* tablas;
* modelos;
* rutas;
* clases;
* colas;
* métricas;
* variables;
* identificadores internos flowbot.

No hagas migraciones riesgosas solo por branding.

Elimina la duplicación conceptual de “Chatbot”:

* retira u oculta la navegación anterior;
* redirige rutas antiguas;
* conserva compatibilidad;
* no borres tablas con datos;
* documenta la migración;
* preserva los bots reales existentes.

==================================================
11. IMPORTAR Y EXPORTAR PULSOS
==============================

Formatos oficiales:

* .json
* .taktoflow.json

Contrato:

* schemaVersion;
* metadatos;
* nodos;
* conexiones;
* configuración no secreta;
* variables;
* requisitos de credenciales;
* huella/checksum cuando corresponda.

Importación:

* JSON Schema;
* límite de tamaño;
* profundidad máxima;
* cantidad máxima de nodos/conexiones;
* protección contra prototype pollution;
* sin eval;
* sin funciones;
* sin JavaScript;
* sin ejecución de código;
* sin tokens;
* sin contraseñas;
* sin credenciales;
* sin IDs sensibles;
* remapeo de IDs;
* detección de nodos desconocidos;
* vista previa;
* reporte de incompatibilidades;
* migradores explícitos entre versiones;
* siempre como borrador;
* siempre inactivo;
* nunca publicar automáticamente;
* nunca activar automáticamente;
* pedir después el mapeo de credenciales.

Exportación:

* formato versionado;
* sanitizado;
* sin secretos;
* importable nuevamente;
* pruebas de ida y vuelta.

No prometas compatibilidad con cualquier JSON. Los formatos externos solo se aceptan mediante importadores explícitos.

==================================================
12. BARRIDO GENERAL DE BUGS
===========================

Después de implementar:

* prueba todos los botones;
* prueba todos los menús;
* revisa loading, empty, error y success;
* elimina errores silenciosos;
* añade mensajes claros;
* revisa deep links;
* revisa recarga;
* revisa navegación atrás;
* revisa permisos AGENT, MANAGER, ADMIN y plataforma/soporte;
* revisa aislamiento de dos empresas;
* revisa concurrencia;
* reinicia backend;
* reinicia worker;
* reinicia Redis;
* prueba recuperación de jobs;
* prueba leases;
* prueba outbox;
* prueba expiraciones;
* prueba Windows y Linux;
* prueba Chrome y Edge;
* revisa logs sin secretos ni PII innecesaria;
* revisa consultas sin companyId;
* revisa findFirst ambiguos;
* revisa conexiones abiertas;
* revisa timers;
* revisa archivos temporales;
* revisa migraciones;
* ejecuta npm audit;
* separa vulnerabilidades nuevas de heredadas.

No hagas todavía el rediseño visual completo. Solo la interfaz funcional indispensable respetando el sistema vigente.

==================================================
13. MIGRACIONES
===============

Toda migración debe ser:

* aditiva;
* revisada a mano;
* con rollback documentado;
* probada desde base limpia;
* probada sobre copia del esquema anterior;
* probada conservando datos existentes.

Detente antes de continuar si aparece:

* DROP TABLE;
* DROP COLUMN;
* TRUNCATE;
* eliminación masiva;
* SET NOT NULL sin backfill seguro;
* cambio irreversible;
* pérdida de auditoría.

No apliques nada en staging.

==================================================
14. PRUEBAS OBLIGATORIAS
========================

Backend:

* unitarias completas;
* E2E completas;
* typecheck incluyendo specs;
* lint;
* build;
* Prisma validate;
* migraciones desde cero;
* migraciones sobre esquema anterior;
* Docker build;
* reinicio;
* recuperación de worker y Redis.

Frontend:

* unitarias;
* integración;
* E2E;
* typecheck;
* lint;
* build;
* Docker build;
* cero errores de consola;
* cero overflow horizontal.

QA:

* 1440 px;
* 1280 px;
* 1024 px;
* 768 px;
* 390 px.

Pruebas explícitas:

* archivar contacto;
* restaurar contacto;
* eliminar contacto vacío;
* protección del contacto con historial;
* papelera;
* archivar pipeline;
* eliminar pipeline vacío;
* trasladar oportunidades;
* panel lateral;
* pipeline → conversación exacta;
* conversación → regreso al pipeline;
* propuesta de tarea;
* aprobación;
* rechazo;
* concurrencia de aprobación;
* importación grande;
* cancelación;
* reintento;
* reporte de errores;
* cotización completa;
* PDF;
* pipeline de cotizaciones;
* importar Pulso;
* exportar Pulso;
* ida y vuelta;
* aislamiento multiempresa;
* cero solicitudes reales a Meta;
* kill switch activo;
* dry-run efectivo.

==================================================
15. CRITERIOS DE CIERRE
=======================

No declares terminado si existe:

* una prueba roja;
* un defecto crítico o alto;
* un botón roto;
* una migración dudosa;
* un error silencioso;
* una operación sin companyId;
* una conexión sin cerrar;
* un temporal sin limpiar;
* una función visible que no cumpla lo prometido;
* una posibilidad de envío real;
* una pérdida de datos;
* una discrepancia sin explicar.

==================================================
16. ENTREGA FINAL
=================

Publica únicamente:

feature/takto-functional-hardening

No fusiones ni despliegues.

Entrega:

1. SHA de cada commit.
2. Tabla completa de defectos.
3. Causa raíz y solución.
4. Migraciones, riesgo y rollback.
5. Conteos de pruebas antes/después.
6. Rendimiento de importación.
7. Uso máximo de memoria y disco.
8. Evidencia de cálculos de cotización.
9. Evidencia del PDF.
10. Evidencia de navegación Pipeline ↔ Conversaciones.
11. Evidencia del flujo de aprobación de tareas.
12. Evidencia de importación/exportación de Pulso.
13. QA por resolución.
14. Evidencia de cero envíos reales.
15. Limitaciones restantes por severidad.
16. Confirmación de main intacto.
17. Confirmación de staging intacto.
18. Estado final de docs/TAKTO-FUNCTIONAL-HARDENING-STATE.md.
19. Comando exacto para reanudar si queda trabajo.

No uses el tiempo transcurrido como medida de progreso. Mide resultados, pruebas y criterios cerrados.

Comienza ahora por el preflight y la caracterización. Después continúa automáticamente con todas las secciones autorizadas.
