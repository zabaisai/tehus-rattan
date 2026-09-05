# Fase 5 — Evidencia de staging

Todo lo de aquí ocurrió de verdad. Sin identificadores completos, nombres de
empresa, correos ni valores de configuración.

## Antes de tocar nada

| Comprobación | Resultado |
|---|---|
| Rama y árbol de trabajo del servidor | `main`, limpio |
| Procesos de respaldo o despliegue en curso | ninguno |
| Contenedores | seis, todos sanos |
| Unidades de sistema fallidas | ninguna |
| Disco | 13 % usado |
| Respaldo de base de datos | creado, con su suma de comprobación |
| Verificación del respaldo | suma de comprobación e integridad del comprimido: correctas |
| Copia cifrada fuera del servidor | completada, tres instantáneas revisadas, sin errores |

## Despliegue

| Comprobación | Resultado |
|---|---|
| Release desplegado | el commit de fusión de la Fase 5 |
| Comprobaciones de salud del despliegue | **12/12**, sin el fallo intermitente de arranque |
| Pruebas de humo contra el dominio público | **21/21** |
| Configuración efectiva antes y después de desplegar | **idéntica** en las cuatro empresas |

Esa última línea importa: demuestra que el código nuevo, por sí solo, no cambia
lo que el producto responde. Todo lo que cambie después es obra de la migración.

## Ensayo en seco

Plan calculado sobre los datos reales:

| Dato | Valor |
|---|---|
| Empresas | 4 |
| A canonicalizar | 4 |
| Ya canónicas | 0 |
| **Ambiguas** | **0** |
| Elementos de catálogo sin tipo | 3, todos de una misma empresa |

Dos empresas venían de la forma antigua sin configuración y perdían sus tres
módulos «por compatibilidad»; las otras dos, en forma plana, no tenían ninguno.

**El ensayo no escribió nada**: la configuración efectiva se volvió a capturar
después y resultó idéntica.

## Guardas de escritura

| Intento | Resultado |
|---|---|
| Aplicar sin confirmación explícita | rechazado |
| Aplicar nombrando otra base de datos | rechazado, indicando la diferencia |

## Aplicación

| Dato | Antes | Después |
|---|---|---|
| Elementos de tipo producto | 0 | 3 |
| Elementos de tipo servicio | 0 | 0 |
| Elementos sin tipo | 3 | **0** |
| Empresas canonicalizadas | — | 4 |
| Empresas ambiguas | — | 0 |

Manifiesto escrito con permisos restrictivos y guardado fuera del repositorio.
Registra, por empresa, la configuración anterior exacta, incluido el caso de que
no hubiera ninguna.

## Verificación e idempotencia

| Comprobación | Resultado |
|---|---|
| Verificación | correcta, sin problemas |
| Empresas por versión de almacenamiento | las cuatro en la forma canónica |
| Elementos sin tipo | ninguno |
| **Segunda ejecución completa** | **cero filas y cero empresas** |

## Equivalencia campo por campo

Comparación de la configuración efectiva que sirve la API, empresa por empresa,
generada con el código real del producto:

| Empresa | Diferencias | Inesperadas |
|---|---|---|
| Primera | 1 | **0** |
| Segunda | 3 | **0** |
| Tercera | 3 | **0** |
| Cuarta | 1 | **0** |

Las únicas diferencias fueron la versión de almacenamiento y, en las dos
empresas que venían sin configuración, la lista de módulos activos por
compatibilidad, que pasa a estar vacía porque ahora están declarados.
Identidad, región, módulos efectivos, tipos de catálogo permitidos, categorías,
embudo y etapas: **idénticos**.

## Huellas de la base

Comparadas con el inventario tomado antes de empezar:

| Huella | Resultado |
|---|---|
| Catálogo excluyendo el tipo | **idéntica** |
| Embudos | **idéntica** |
| Configuración de empresas | cambia, que es lo que se migró |
| Catálogo incluyendo el tipo | cambia, solo por el tipo |

Conteos de control sin variación: oportunidades, contactos, conversaciones,
mensajes, tareas, líneas de cotización, sesiones, códigos de invitación y
dispositivos confiables.

Migraciones de esquema aplicadas: **las mismas de antes**. Esta fase no añadió
ninguna.

Auditoría: cuatro filas nuevas de la migración, sin actor humano y sin valores
de configuración, más una fila ajena generada por la actividad normal del
producto mientras se trabajaba.

## QA con navegador real

Se creó una empresa **sintética** en pesos mexicanos, sin configuración guardada
y con un elemento de catálogo sin tipo: exactamente el estado que la migración
consolida. Ninguna empresa ni persona real intervino.

| Recorrido | Resultado |
|---|---|
| Administrador, **antes** de migrar | **18/18** |
| Administrador, **después** de migrar | **18/18** |
| Asesor, después de migrar | **18/18** |

Lo comprobado en cada pasada: acceso sin código de verificación, catálogo
accesible, los dos elementos listados, el precio con separador mexicano y **no**
con el colombiano, ambos elementos mostrados como producto, panel de inicio,
embudo con sus etapas, ningún importe roto, ningún error de consola y ninguna
petición fallida.

Que el resultado sea el mismo antes y después es la prueba de que la migración
no cambia lo que la gente ve.

Un asesor recibe un rechazo al pedir las analíticas de la empresa: ese endpoint
es solo para administración por diseño y la pantalla lo trata como «sin
permiso», no como un error. Comportamiento anterior a esta fase.

## Reversión probada de verdad

Sobre la empresa sintética, no sobre datos reales:

| Comprobación | Resultado |
|---|---|
| Filas de catálogo revertidas | 1 |
| Empresas revertidas | 1 |
| Configuración tras revertir | vuelve a **no existir**, no a un objeto vacío |
| Elemento migrado | vuelve a no tener tipo |
| Elemento que ya tenía tipo | **intacto** |

## Limpieza

La empresa sintética y sus dos usuarios se borraron por identificador exacto,
con una comprobación previa de que el nombre correspondía a los datos de prueba.
Nada se borró por prefijo ni por intuición.

## Estado final

| Comprobación | Resultado |
|---|---|
| Empresas | 4, todas en la forma canónica |
| Elementos de catálogo | 3, todos con tipo |
| Salud pública de la API | correcta |
| Verificación de la migración | correcta, sin problemas |
