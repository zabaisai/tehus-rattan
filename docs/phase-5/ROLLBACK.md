# Fase 5 — Cómo volver atrás

Tres cosas independientes que se revierten por separado. No hace falta
deshacerlas todas para deshacer una.

## Resumen

| Qué | Cómo se revierte | Necesita respaldo |
|---|---|---|
| Relleno del tipo de catálogo | reversión desde el manifiesto | no |
| Configuración canónica | reversión desde el manifiesto | no |
| Moneda por empresa | revertir el código y desplegar | no hay datos |

**No hay ninguna migración de esquema en esta fase.** No se creó, alteró ni
borró ninguna tabla, columna, índice, restricción ni disparador. Volver atrás
nunca exige revertir una migración de Prisma.

## Reversión de datos, campo por campo

La herramienta escribe un manifiesto con el valor **anterior exacto** de todo lo
que tocó: los identificadores de las filas de catálogo que pasaron a producto y,
por empresa, la configuración completa que había antes, incluido el caso de que
no hubiera ninguna.

```
node dist/src/scripts/migrar-inquilinos revertir \
  --manifiesto <ruta del manifiesto> --confirmar
```

La reversión exige las mismas guardas que la aplicación: confirmación explícita
y que el nombre de la base de destino coincida con la variable de entorno. Todo
ocurre dentro de una transacción con cerrojo, y una guarda de conteo aborta si
el número de filas revertidas no coincide con el que dice el manifiesto.

Qué deja exactamente:

- Las filas listadas vuelven a no tener tipo. La fecha de actualización tampoco
  se toca al revertir, igual que no se tocó al aplicar.
- Cada empresa recupera su configuración anterior. Una empresa que no tenía
  ninguna vuelve a no tenerla, no a un objeto vacío.
- Las filas de auditoría de la migración **se conservan**: son el registro de que
  la migración ocurrió y de que se deshizo. Borrarlas sería falsear el historial.

## Si no hay manifiesto

Restaurar el respaldo tomado antes de aplicar. Por eso la herramienta avisa
cuando se ejecuta la aplicación sin indicar dónde guardar el manifiesto.

## Reversión del código

La moneda por empresa es solo presentación: no escribió ningún dato. Se revierte
volviendo el código a la referencia anterior y desplegando. Los importes
guardados nunca dependieron del formato, así que revertir el código no puede
dejar cifras inconsistentes.

## Qué NO revierte nada de esto

- Producción, que no se tocó en esta fase.
- DNS, correo, SPF, DKIM y DMARC.
- La verificación de dispositivo de la Fase 4.5 y su lista de permitidos.
- Pipelines, etapas, oportunidades, contactos, mensajes, tareas y cotizaciones.

## Verificación después de revertir

```
node dist/src/scripts/migrar-inquilinos ensayo
```

El ensayo debe volver a listar exactamente el mismo trabajo pendiente que había
antes de aplicar: las mismas filas sin tipo y las mismas empresas por
canonicalizar. Si el plan no coincide, la reversión quedó incompleta y hay que
mirar el manifiesto antes de tocar nada más.
