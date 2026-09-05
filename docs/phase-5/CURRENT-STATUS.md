# Fase 5 — Estado actual

Para retomar el trabajo sin releer todo.

## Dónde está el código

Rama `feat/phase-5-existing-tenant-migration`, partida de `origin/main`
`ef93a4d`. Worktree propio, separado del principal. El archivo ajeno del
worktree principal no se ha tocado en ningún momento.

## Qué está hecho

- Inventario de solo lectura de staging, dentro de una transacción de solo
  lectura, con huellas estables guardadas fuera del repositorio.
- Contrato de migración cerrado antes de escribir una línea de código.
- Herramienta de migración con cuatro modos: ensayo en seco (el de por defecto),
  aplicar, verificar y revertir desde el manifiesto.
- Moneda por empresa en toda la interfaz.
- Pruebas: unitarias de la decisión, de extremo a extremo contra base real, y de
  pantalla en tres monedas distintas.
- Lint y comprobación de tipos limpios en backend y frontend.

## Qué falta

1. Pull request, integración continua y fusión.
2. Respaldo oficial en staging y verificación de la copia.
3. Ensayo en seco en staging, revisión del plan y aplicación.
4. Verificación y segunda ejecución sin cambios.
5. QA por navegador con perfil administrador y con perfil asesor.
6. Rama de cierre documental y actualización de la memoria del proyecto.

## Cómo se ejecuta la herramienta

Dentro del contenedor del backend, sobre el código ya compilado:

```
node dist/src/scripts/migrar-inquilinos ensayo --salida <ruta fuera del repo>
node dist/src/scripts/migrar-inquilinos aplicar --confirmar --salida <ruta>
node dist/src/scripts/migrar-inquilinos verificar
node dist/src/scripts/migrar-inquilinos revertir --manifiesto <ruta> --confirmar
```

Para escribir hace falta además la variable `MIGRACION_FASE5_OBJETIVO` con el
nombre exacto de la base de datos de destino. Si no coincide con la configurada,
la herramienta se niega y explica la diferencia.

Se puede acotar a empresas concretas repitiendo `--empresa <id>`, que sirve para
migrar de forma gradual empezando por una sola.

## Lo que hay que mirar primero en staging

Según el inventario tomado al empezar: cuatro empresas, dos sin configuración y
dos en forma plana, ninguna canónica; tres elementos de catálogo sin tipo, todos
de una misma empresa; ninguna clave desconocida. Las cuatro empresas comparten
región, así que la moneda distinta habrá que probarla con datos sintéticos y
retirarlos después.

## Riesgos vivos

- El paso de comprobación de salud del despliegue falla de forma intermitente
  mientras el contenedor arranca. Es deuda anterior; se vuelve a ejecutar y pasa.
- La caché de capacidades vive cinco segundos por proceso y no se entera de una
  escritura hecha por SQL directo: conviene esperar ese margen antes de
  comprobar la configuración por la API.
- El script que restablece la empresa de demostración la devuelve a no tener
  configuración, deshaciendo su migración.
- Las empresas nuevas creadas desde plataforma siguen naciendo sin
  configuración, así que la forma antigua puede reaparecer.
