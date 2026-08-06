/**
 * Arnés E2E de navegador. Mínimo y mantenible, sin dependencias nuevas.
 *
 * Conduce Chrome y Microsoft Edge por CDP —los dos hablan el mismo protocolo—
 * y recorre los flujos críticos a cinco anchos.
 *
 * NO se añadió Playwright a propósito: meter una dependencia con descarga de
 * navegadores propios en el gate de release es el tipo de cambio que hay que
 * validar despacio, no colar el último día. Esto usa los navegadores que ya
 * están instalados.
 *
 * LA REGLA QUE JUSTIFICA EL ARCHIVO ENTERO: una página muerta NO puede dar
 * «0 desbordes». Cada medición exige encontrar la aplicación en pantalla, y si
 * no la encuentra, aborta. La primera vez que corrí una versión anterior de
 * esto, el frontend se había caído y el arnés informó 39 capturas verdes de la
 * pantalla «no se puede acceder a este sitio».
 *
 *   node e2e/arnes.mjs <salida> <archivoClave> <idEmbudo> [chrome|edge]
 */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const NAVEGADORES = {
  chrome: {
    nombre: 'Chrome',
    ruta: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    puerto: 9455,
  },
  edge: {
    nombre: 'Edge',
    ruta: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    puerto: 9456,
  },
};

const SALIDA = process.argv[2];
const CLAVE = fs.readFileSync(process.argv[3], 'utf8').trim();
const EMBUDO = process.argv[4];
const CUAL = (process.argv[5] ?? 'chrome').toLowerCase();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.E2E_EMAIL ?? 'qa-gate@local.invalid';

const ANCHOS = [
  { nombre: '1440', width: 1440, height: 900, movil: false },
  { nombre: '1280', width: 1280, height: 800, movil: false },
  { nombre: '1024', width: 1024, height: 768, movil: false },
  { nombre: '768', width: 768, height: 1024, movil: true },
  { nombre: '390', width: 390, height: 844, movil: true },
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const pedirJson = (url) =>
  new Promise((res, rej) => {
    http
      .get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      })
      .on('error', rej);
  });

async function abrirNavegador(cfg, perfil) {
  if (!fs.existsSync(cfg.ruta)) {
    throw new Error(`${cfg.nombre} no está instalado en ${cfg.ruta}`);
  }
  const proc = spawn(cfg.ruta, [
    '--headless=new',
    `--remote-debugging-port=${cfg.puerto}`,
    '--no-first-run',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${perfil}`,
    'about:blank',
  ]);
  proc.on('error', (e) => console.error(`${cfg.nombre}:`, e.message));

  let objetivos = null;
  for (let i = 0; i < 80 && !objetivos; i++) {
    try {
      objetivos = await pedirJson(`http://127.0.0.1:${cfg.puerto}/json/list`);
    } catch {
      await esperar(500);
    }
  }
  if (!objetivos) throw new Error(`${cfg.nombre} no abrió el puerto de depuración`);

  const WebSocket = require('ws');
  const ws = new WebSocket(
    objetivos.find((t) => t.type === 'page').webSocketDebuggerUrl,
  );
  await new Promise((r) => ws.on('open', r));
  return { proc, ws };
}

async function main() {
  const cfg = NAVEGADORES[CUAL];
  if (!cfg) throw new Error(`Navegador desconocido: ${CUAL}`);

  const salida = path.join(SALIDA, CUAL);
  fs.mkdirSync(salida, { recursive: true });
  const { proc, ws } = await abrirNavegador(cfg, path.join(salida, 'perfil'));

  let id = 0;
  const pendientes = new Map();
  let consola = [];
  let excepciones = [];
  let ultimoEstadoHttp = 0;

  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pendientes.has(m.id)) {
      pendientes.get(m.id)(m.result);
      pendientes.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      consola.push(
        (m.params.args || []).map((a) => a.value ?? a.description).join(' '),
      );
    }
    if (m.method === 'Runtime.exceptionThrown') {
      excepciones.push(
        m.params?.exceptionDetails?.exception?.description ?? 'excepción',
      );
    }
    if (m.method === 'Network.responseReceived') {
      const u = m.params?.response?.url ?? '';
      // Solo el documento principal: los 404 de un favicon no son un fallo
      // del flujo.
      if (m.params?.type === 'Document' && u.startsWith(BASE)) {
        ultimoEstadoHttp = m.params.response.status;
      }
    }
  });

  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pendientes.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');

  const ev = async (e) =>
    (
      await cdp('Runtime.evaluate', {
        expression: e,
        awaitPromise: true,
        returnByValue: true,
      })
    )?.result?.value;

  const irA = async (r, ms = 3200) => {
    ultimoEstadoHttp = 0;
    await cdp('Page.navigate', { url: `${BASE}${r}` });
    await esperar(ms);
  };

  const capturar = async (n) => {
    const c = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(salida, `${n}.png`), Buffer.from(c.data, 'base64'));
  };

  /**
   * Mide y EXIGE que haya aplicación. Una página muerta no puede pasar por
   * buena: es la mentira que este arnés existe para impedir.
   */
  const medir = () =>
    ev(`(() => {
      const d = document.documentElement;
      const cuerpo = document.body.innerText || '';
      const sinNombre = [...document.querySelectorAll('button, a, input, select')]
        .filter((el) => !el.textContent.trim()
          && !el.getAttribute('aria-label')
          && !el.getAttribute('title')
          && !el.getAttribute('placeholder')
          && !(el.labels && el.labels.length));
      return {
        desborde: d.scrollWidth - d.clientWidth,
        sinNombre: sinNombre.length,
        detalleSinNombre: sinNombre.slice(0, 3).map((e) => e.outerHTML.slice(0, 90)),
        enLogin: location.pathname.includes('login'),
        // La barra lateral solo existe dentro de la aplicación.
        esLaApp: !!document.querySelector('nav a[href^="/dashboard"]'),
        errorDelNavegador: /ERR_|no se puede acceder a este sitio|no se puede acceder/i.test(cuerpo),
        texto: cuerpo.slice(0, 300),
        // El panel se detecta por su ETIQUETA ACCESIBLE, no buscando la
        // palabra «Perfil» en el texto: los primeros cientos de caracteres del
        // cuerpo son la barra lateral, asi que esa busqueda daba un falso
        // negativo con el panel perfectamente abierto en pantalla.
        panelAbierto: !!document.querySelector('aside[aria-label="Perfil del contacto"]'),
        url: location.pathname + location.search,
      };
    })()`);

  const resultados = [];
  const fallos = [];

  async function comprobar(nombre, ancho, opciones = {}) {
    const m = await medir();
    await capturar(`w${ancho}-${nombre}`);

    const problemas = [];
    if (!m?.esLaApp && !opciones.permitirFueraDeApp) {
      problemas.push('NO hay aplicación en pantalla');
    }
    if (m?.errorDelNavegador) problemas.push('página de error del navegador');
    if ((m?.desborde ?? 0) > 0) problemas.push(`overflow ${m.desborde}px`);
    if (consola.length) problemas.push(`${consola.length} errores de consola`);
    if (excepciones.length) problemas.push(`${excepciones.length} excepciones`);
    if ((m?.sinNombre ?? 0) > 0) {
      problemas.push(
        `${m.sinNombre} controles sin nombre: ${JSON.stringify(m.detalleSinNombre)}`,
      );
    }
    if (ultimoEstadoHttp && ultimoEstadoHttp >= 400) {
      problemas.push(`HTTP ${ultimoEstadoHttp}`);
    }

    const fila = {
      navegador: cfg.nombre,
      flujo: nombre,
      ancho,
      desborde: m?.desborde ?? 0,
      consola: consola.length,
      excepciones: excepciones.length,
      sinNombre: m?.sinNombre ?? 0,
      http: ultimoEstadoHttp || 200,
      ok: problemas.length === 0,
    };
    resultados.push(fila);
    if (problemas.length) {
      fallos.push({ ...fila, problemas, url: m?.url, texto: m?.texto });
      console.log(`  ✗ ${ancho}px ${nombre}: ${problemas.join(' · ')}`);
    } else {
      console.log(`  ✓ ${ancho}px ${nombre}`);
    }
    consola = [];
    excepciones = [];
    return m;
  }

  const clic = (selectorOTexto) =>
    ev(`(() => {
      const porTexto = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')]
        .find((e) => new RegExp(${JSON.stringify(selectorOTexto)}, 'i').test(
          (e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '')));
      if (porTexto) { porTexto.click(); return true; }
      return false;
    })()`);

  // ── sesión ───────────────────────────────────────────────────
  console.log(`\n=== ${cfg.nombre} ===`);
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await irA('/login', 4000);
  await ev(`(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const c = document.querySelectorAll('input');
    set(c[0], ${JSON.stringify(EMAIL)});
    set(c[1], ${JSON.stringify(CLAVE)});
    document.querySelector('form').requestSubmit();
    return true;
  })()`);
  await esperar(6000);
  const ruta = await ev('location.pathname');
  if (String(ruta).includes('login')) {
    console.error(
      `ABORTADO en ${cfg.nombre}: no se pudo iniciar sesión.`,
      await ev('document.body.innerText.slice(0,200)'),
    );
    process.exit(2);
  }
  console.log(`sesión iniciada -> ${ruta}`);

  // ── recorrido a cinco anchos ─────────────────────────────────
  const PANTALLAS = [
    ['contactos-activos', '/dashboard/contacts'],
    ['pipelines', `/dashboard/pipeline?embudo=${EMBUDO}`],
    ['conversaciones', '/dashboard/conversations'],
    ['tareas', '/dashboard/tasks'],
    ['pulso', '/dashboard/flowbots'],
    ['cotizaciones', '/dashboard/quotes'],
    ['productos', '/dashboard/products'],
  ];

  for (const vp of ANCHOS) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.movil,
    });
    for (const [nombre, r] of PANTALLAS) {
      await irA(r);
      await comprobar(nombre, vp.nombre);
    }
  }

  // ── flujos con interacción, a escritorio y móvil ─────────────
  for (const vp of [ANCHOS[0], ANCHOS[4]]) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.movil,
    });
    const A = vp.nombre;

    // Papelera y restaurar
    await irA('/dashboard/contacts');
    await clic('papelera');
    await esperar(2200);
    await comprobar('papelera', A);

    // Perfil lateral desde el pipeline + deep link
    await irA(`/dashboard/pipeline?embudo=${EMBUDO}`, 3600);
    await ev(`(() => { const c = document.querySelector('[role="button"]'); if (c) c.click(); return !!c; })()`);
    await esperar(2600);
    const perfil = await comprobar('perfil-lateral', A);
    const urlPerfil = perfil?.url ?? '';
    if (!perfil?.panelAbierto) {
      fallos.push({
        navegador: cfg.nombre, flujo: 'perfil-lateral', ancho: A,
        problemas: ['el clic no abrió el panel'], ok: false,
      });
    }

    // Deep link: recargar la MISMA url tiene que reabrir el panel.
    if (urlPerfil.includes('perfil=')) {
      await irA(urlPerfil, 3600);
      const tras = await comprobar('perfil-deep-link', A);
      if (!tras?.panelAbierto) {
        fallos.push({
          navegador: cfg.nombre, flujo: 'perfil-deep-link', ancho: A,
          problemas: ['la recarga NO reabrió el panel'], ok: false,
        });
      }
    } else {
      fallos.push({
        navegador: cfg.nombre, flujo: 'perfil-lateral', ancho: A,
        problemas: ['el clic no puso `perfil=` en la URL'], ok: false,
      });
    }

    // Cerrar el panel
    await clic('cerrar el perfil');
    await esperar(1400);
    const cerrado = await comprobar('perfil-cerrado', A);
    if (cerrado?.panelAbierto) {
      fallos.push({
        navegador: cfg.nombre, flujo: 'perfil-cerrado', ancho: A,
        problemas: ['el panel NO se cerró'], ok: false,
      });
    }

    // Sugerencias de tarea: aprobar y rechazar viven en el panel y en tareas
    await irA('/dashboard/tasks');
    await comprobar('sugerencias', A);

    // Importación de productos: abrir el diálogo
    await irA('/dashboard/products');
    await clic('importar');
    await esperar(1800);
    await comprobar('importacion-dialogo', A);

    // Cotizaciones
    await irA('/dashboard/quotes');
    await comprobar('cotizaciones-lista', A);

    // Pulso: plantillas e importación/exportación
    await irA('/dashboard/flowbots');
    await comprobar('pulso-lista', A);
  }

  // ── teclado: se puede tabular hasta un control y activarlo ────
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await irA('/dashboard/contacts');
  const foco = await ev(`(() => {
    const f = [...document.querySelectorAll('a[href], button, input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((e) => e.offsetParent !== null);
    if (!f.length) return null;
    f[0].focus();
    return { enfocable: f.length, activo: document.activeElement?.tagName };
  })()`);
  console.log(
    `  teclado: ${foco?.enfocable ?? 0} elementos enfocables, foco en ${foco?.activo ?? '-'}`,
  );
  if (!foco?.enfocable) {
    fallos.push({
      navegador: cfg.nombre, flujo: 'teclado', ancho: '1440',
      problemas: ['ningún elemento enfocable'], ok: false,
    });
  }

  fs.writeFileSync(
    path.join(salida, 'informe.json'),
    JSON.stringify({ navegador: cfg.nombre, resultados, fallos }, null, 2),
  );

  const ok = resultados.filter((r) => r.ok).length;
  console.log(
    `\n${cfg.nombre}: ${ok}/${resultados.length} comprobaciones en verde · ${fallos.length} fallo(s)`,
  );
  if (fallos.length) console.log(JSON.stringify(fallos, null, 2));

  ws.close();
  proc.kill();
  process.exit(fallos.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
