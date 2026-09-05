# Fase 5 — Migración y consolidación de las empresas existentes

TAKTO lleva cuatro fases añadiendo capacidades nuevas sin tocar lo que ya
estaba. El resultado es que las empresas creadas antes conviven con formas
antiguas de guardar su configuración y con elementos de catálogo sin tipo, y el
producto las entiende gracias a reglas de compatibilidad al leer. Esta fase
consolida ese estado: escribe en la base lo que el producto ya devolvía, sin
cambiar ni una sola salida observable.

Además arregla algo que llevaba desde el principio: los importes se mostraban
siempre en pesos colombianos, aunque la empresa hubiera configurado otra moneda.

Rama: `feat/phase-5-existing-tenant-migration`, desde `origin/main` `ef93a4d`.
Worktree aislado; el worktree principal y su archivo ajeno no se tocan.

## Documentos

| Documento | Contenido |
|---|---|
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Inventario real, requisito a requisito, con la evidencia en el código |
| [MIGRATION-CONTRACT.md](MIGRATION-CONTRACT.md) | El diseño cerrado antes de escribir código: qué se toca, qué no, y cómo se demuestra la equivalencia |
| [TEST-MATRIX.md](TEST-MATRIX.md) | Qué prueba cubre cada requisito y su resultado real |
| [ROLLBACK.md](ROLLBACK.md) | Cómo volver atrás, campo por campo, sin depender de un respaldo |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia sanitizada del despliegue y la ejecución |
| [CURRENT-STATUS.md](CURRENT-STATUS.md) | Estado para reanudar el trabajo |

## Qué hace

**A. Tipo de los elementos del catálogo.** Los elementos creados antes de que
existiera la distinción entre producto y servicio están guardados sin tipo, y el
producto los lee como productos. La migración escribe ese valor. No es una
decisión nueva: la respuesta de la API, los listados y los filtros son idénticos
antes y después. La fecha de actualización tampoco cambia, porque para el
negocio la fila no ha sido editada.

**B. Configuración de cada empresa.** Se reescribe en la forma canónica actual
usando la misma composición que el producto ya emplea cuando alguien edita sus
ajustes, con las banderas **efectivas**. Lo único que cambia de forma observable
es que los módulos dejan de estar activos «por compatibilidad» y pasan a estar
declarados, con exactamente el mismo resultado.

**C. Moneda por empresa.** Un único formateador sustituye a los trece fijos que
había repartidos por la interfaz. Lee la moneda y el idioma de la empresa, que
es la misma fuente que usa el backend para el PDF de una cotización, así que la
pantalla y el documento impreso no pueden discrepar.

## Decisiones que conviene conocer

1. **La migración no decide nada nuevo.** Materializa lo que el código de
   lectura ya devolvía. Si una empresa exigiera una decisión que hoy no existe,
   se marca ambigua y se deja intacta para resolverla a mano.
2. **Las banderas que se escriben son las efectivas, no las normalizadas.** El
   parser rellena las ausentes con «falso», pero el producto nunca usa ese valor:
   aplica el valor de compatibilidad, que para catálogo, cotizaciones y tareas es
   activo. Escribir las normalizadas habría apagado módulos en uso.
3. **Ninguna migración de esquema.** La columna del tipo sigue admitiendo nulos.
   Producción no se migra en esta fase y debe seguir funcionando con filas
   antiguas; además, el contrato actual exige que una fila creada sin tipo siga
   sin tipo tras pasar por la API.
4. **El relleno se escribe con SQL directo.** Con el cliente habitual se habría
   actualizado también la fecha de modificación de todo el catálogo antiguo,
   afirmando ediciones que nunca ocurrieron.
5. **El ensayo en seco es el modo por defecto.** Escribir exige confirmación
   explícita y nombrar la base de destino en una variable de entorno.
6. **El manifiesto no entra en Git.** Contiene configuración real de empresas.

## Plan y estado

| # | Etapa | Estado |
|---|---|---|
| 1 | Inspección, inventario de solo lectura y análisis de brechas | HECHA |
| 2 | Contrato de migración cerrado antes de escribir código | HECHA |
| 3 | Herramienta de migración con sus guardas | HECHA |
| 4 | Moneda por empresa en la interfaz | HECHA |
| 5 | Pruebas unitarias, de extremo a extremo y de pantalla | HECHA |
| 6 | Revisión del diff, lint y tipos | HECHA |
| 7 | PR, integración continua y fusión | PENDIENTE |
| 8 | Respaldo y ejecución en staging | PENDIENTE |
| 9 | QA en staging con administrador y asesor | PENDIENTE |
| 10 | Documentación y cierre | PENDIENTE |

Estado de la fase: **EN CURSO**.

## Fuera de alcance

Producción, DNS, correo y entregabilidad, la verificación de dispositivo de la
Fase 4.5, Meta y WhatsApp, el chatbot, la inteligencia artificial, las
automatizaciones, el editor de plantillas de plataforma y cualquier cambio de
marca. Ningún dato comercial se toca: oportunidades, contactos, mensajes,
tareas, cotizaciones y auditoría histórica quedan como estaban.
