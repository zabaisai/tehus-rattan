# TAKTO — paquete maestro de integración desktop

Este paquete convierte los mockups aprobados en un programa de implementación
reanudable. No es una colección de ideas sueltas: establece el orden, los
contratos funcionales, los límites de seguridad, las pruebas y la definición de
terminado.

## Contenido

- `docs/TAKTO-DESKTOP-IMPLEMENTATION-MASTER.md`: fuente de verdad del trabajo.
- `docs/TAKTO-DESKTOP-IMPLEMENTATION-STATE.md`: punto de reanudación entre
  sesiones; Claude debe actualizarlo al cerrar cada incremento.
- `docs/TAKTO-CLAUDE-START-PROMPT.txt`: prompt corto para pegar en Claude Code
  dentro de la terminal de Visual Studio Code.
- `mockups/`: las 26 vistas desktop aprobadas, numeradas en el orden del
  inventario funcional.

## Cómo llevarlo al repositorio

Copiar la carpeta `docs/` y `mockups/` dentro de:

```text
<raíz-del-repositorio>/docs/takto-desktop/
```

El resultado esperado es:

```text
docs/takto-desktop/
├── TAKTO-DESKTOP-IMPLEMENTATION-MASTER.md
├── TAKTO-DESKTOP-IMPLEMENTATION-STATE.md
├── TAKTO-CLAUDE-START-PROMPT.txt
└── mockups/
    ├── 01-inicio-dashboard.png
    └── ...
```

Después, desde la raíz del repositorio en la terminal de VS Code, abrir Claude
Code y pegar el contenido de `TAKTO-CLAUDE-START-PROMPT.txt`.

## Regla de operación

Claude no debe intentar construir las 26 pantallas en una sola sesión. Debe
trabajar por incrementos verticales, conservar el producto funcional, actualizar
el estado, probar y publicar únicamente la rama visual autorizada. No debe
fusionar ni desplegar sin una autorización nueva y explícita.

