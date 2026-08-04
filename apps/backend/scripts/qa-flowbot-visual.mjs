/**
 * QA VISUAL DE FLOWBOT — Chrome sin cabeza sobre el producto de verdad.
 *
 * Recorre los 18 pasos que hace un administrador desde que crea un bot hasta
 * que ve la conversación atendida, hablando con el backend REAL a través de la
 * interfaz REAL. No hay dobles: si algo solo funciona llamando al servicio por
 * dentro, aquí falla.
 *
 * Captura además cada pantalla a cinco anchos y comprueba desbordamiento
 * horizontal —el fallo responsive que no se ve en una captura recortada— y lo
 * básico de accesibilidad que se cuela al escribir pantallas deprisa.
 *
 * Uso:  node scripts/qa-flowbot-visual.mjs <carpeta-salida>
 */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO = 9333;
const BASE = 'http://localhost:3000';
const API = 'http://127.0.0.1:3001/api';
const SALIDA = process.argv[2] || './qa-flowbot';

const USUARIO = 'qa-flowbot-admin@ejemplo.test';
const CLAVE = 'QaFlowbot123!';

/** Los cinco anchos que pidió la revisión. */
const ANCHOS = [
  { nombre: '1440', width: 1440, height: 900, movil: false },
  { nombre: '1280', width: 1280, height: 800, movil: false },
  { nombre: '1024', width: 1024, height: 768, movil: false },
  { nombre: '768', width: 768, height: 1024, movil: true },
  { nombre: '390', width: 390, height: 844, movil: true },
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const pedirJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(JSON.parse(d)));
      })
      .on('error', reject);
  });

const pasos = [];
function paso(n, titulo, ok, detalle = '') {
  pasos.push({ n, titulo, ok, detalle });
  console.log(
    `${ok ? 'OK  ' : 'FALLO'} ${String(n).padStart(2)}. ${titulo}${
      detalle ? ` — ${detalle}` : ''
    }`,
  );
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PUERTO}`,
    '--no-first-run',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(SALIDA, 'perfil')}`,
    'about:blank',
  ]);
  chrome.on('error', (e) => console.error('chrome:', e.message));

  let objetivos = null;
  for (let i = 0; i < 60 && !objetivos; i++) {
    try {
      objetivos = await pedirJson(`http://127.0.0.1:${PUERTO}/json/list`);
    } catch {
      await esperar(500);
    }
  }
  if (!objetivos) throw new Error('Chrome no abrió el puerto de depuración');

  const WebSocket = require('../../frontend/node_modules/ws');
  const pagina = objetivos.find((t) => t.type === 'page');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));

  let id = 0;
  const pendientes = new Map();
  const consola = [];
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
  });
  const cdp = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pendientes.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evaluar = async (expr) => {
    const r = await cdp('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r?.exceptionDetails) {
      return { __error: r.exceptionDetails.text ?? 'excepción' };
    }
    return r?.result?.value;
  };

  const irA = async (ruta, ms = 2600) => {
    await cdp('Page.navigate', { url: `${BASE}${ruta}` });
    await esperar(ms);
  };

  const capturar = async (nombre) => {
    const c = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(SALIDA, `${nombre}.png`),
      Buffer.from(c.data, 'base64'),
    );
  };

  const texto = () => evaluar('document.body.innerText');

  /** Pulsa el primer elemento cuyo texto visible coincida. */
  const pulsar = async (selector, contiene) =>
    evaluar(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = ${
        contiene
          ? `els.find((e) => (e.innerText || e.getAttribute('aria-label') || '').includes(${JSON.stringify(contiene)}))`
          : 'els[0]'
      };
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const escribir = async (selector, valor, indice = 0) =>
    evaluar(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els[${indice}];
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valor)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  // ── 1. Iniciar sesión ────────────────────────────────────────
  await irA('/login', 3500);
  await evaluar(`(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const campos = document.querySelectorAll('input');
    set(campos[0], ${JSON.stringify(USUARIO)});
    set(campos[1], ${JSON.stringify(CLAVE)});
    document.querySelector('form').requestSubmit();
    return true;
  })()`);
  await esperar(5000);
  const rutaTrasLogin = await evaluar('location.pathname');
  paso(
    1,
    'Iniciar sesión con un usuario real',
    !String(rutaTrasLogin).includes('login'),
    String(rutaTrasLogin),
  );

  // ── 2. La sección aparece en el menú ─────────────────────────
  const hayMenu = await evaluar(
    `!!document.querySelector('a[href="/dashboard/flowbots"]')`,
  );
  paso(2, 'FlowBot aparece en el menú lateral', !!hayMenu);

  // ── 3. Listado vacío con salida ──────────────────────────────
  await irA('/dashboard/flowbots');
  const t3 = await texto();
  paso(
    3,
    'El listado vacío invita a empezar por una plantilla',
    typeof t3 === 'string' && t3.includes('Todavía no hay bots'),
  );
  await capturar('03-listado-vacio');

  // ── 4. Galería de plantillas ─────────────────────────────────
  await irA('/dashboard/flowbots/templates', 3200);
  const t4 = await texto();
  const hayPlantillas =
    typeof t4 === 'string' && t4.includes('Usar plantilla');
  paso(4, 'Se ven las plantillas oficiales', hayPlantillas);
  paso(
    5,
    'Una plantilla incompleta avisa de lo que falta',
    typeof t4 === 'string' && /faltará elegir/i.test(t4),
  );
  await capturar('04-plantillas');

  // ── 6. Crear desde plantilla → abre el editor ────────────────
  await pulsar('button', 'Usar plantilla');
  await esperar(6000);
  const ruta6 = await evaluar('location.pathname');
  paso(
    6,
    'Usar una plantilla crea el bot y abre el editor',
    String(ruta6).includes('/edit'),
    String(ruta6),
  );
  const botId = String(ruta6).split('/')[3] ?? '';
  await capturar('06-editor-desde-plantilla');

  // ── 7. Lienzo con nodos ──────────────────────────────────────
  const nodos = await evaluar(
    `document.querySelectorAll('.react-flow__node').length`,
  );
  paso(7, 'El lienzo dibuja los pasos de la plantilla', Number(nodos) > 0, `${nodos} pasos`);

  const conexiones = await evaluar(
    `document.querySelectorAll('.react-flow__edge').length`,
  );
  paso(8, 'Y sus conexiones', Number(conexiones) > 0, `${conexiones} conexiones`);

  // ── 8b. El minimapa dibuja los pasos ─────────────────────────
  // Un minimapa en blanco parece un recuadro roto encima del lienzo, y en un
  // flujo largo es la única forma de saber dónde está uno.
  const minimapa = await evaluar(
    `document.querySelectorAll('.react-flow__minimap-node').length`,
  );
  paso(
    81,
    'El minimapa dibuja los pasos',
    Number(minimapa) > 0,
    `${minimapa} recuadros`,
  );

  // ── 8c. Ningún par de pasos se dibuja encima de otro ─────────
  const solapados = await evaluar(`(() => {
    const nodos = [...document.querySelectorAll('.react-flow__node')];
    const vistos = new Set();
    let repes = 0;
    for (const n of nodos) {
      const clave = n.style.transform;
      if (vistos.has(clave)) repes++;
      vistos.add(clave);
    }
    return { repes, transforms: nodos.map((n) => n.style.transform) };
  })()`);
  console.log('    transforms:', JSON.stringify(solapados?.transforms));
  paso(
    82,
    'Ningún paso se dibuja encima de otro',
    Number(solapados?.repes) === 0,
    `${solapados?.repes} solapados`,
  );

  // ── 9. Paleta desde el catálogo ──────────────────────────────
  // En minúsculas: los títulos se pintan en MAYÚSCULAS por CSS y `innerText`
  // devuelve el texto ya transformado.
  const paleta = await evaluar(`(() => {
    const t = document.body.innerText.toLowerCase();
    return ['inicio y disparadores','mensajería','crm'].filter((g) => t.includes(g)).length;
  })()`);
  paso(9, 'La paleta trae las categorías del catálogo', Number(paleta) >= 2);

  // ── 10. Añadir un paso desde la paleta ───────────────────────
  const antes = Number(nodos);
  await evaluar(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      (e) => e.innerText.includes('Enviar mensaje'));
    if (b) b.click();
    return !!b;
  })()`);
  await esperar(2200);
  const despues = await evaluar(
    `document.querySelectorAll('.react-flow__node').length`,
  );
  paso(
    10,
    'Se añade un paso desde la paleta',
    Number(despues) > antes,
    `${antes} → ${despues}`,
  );
  await capturar('10-paso-anadido');

  // ── 11. El panel de configuración se abre ────────────────────
  const hayPanel = await evaluar(
    `!!document.querySelector('aside[aria-label^="Configuración"]')`,
  );
  paso(11, 'Se abre el panel del paso seleccionado', !!hayPanel);

  // ── 12. El paso recién añadido, sin configurar, es un error ──
  // La plantilla sola solo produce AVISOS —se puede publicar igual—, así que
  // el error lo provoca el paso nuevo que todavía no tiene texto.
  await esperar(4500);
  const t12 = await texto();
  paso(
    12,
    'El validador del servidor marca el paso sin configurar',
    typeof t12 === 'string' && /impiden publicar/i.test(t12),
  );
  await capturar('12-error-de-validacion');

  // ── 13. No se puede publicar con errores ─────────────────────
  const publicarBloqueado = await evaluar(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      (e) => e.innerText.trim() === 'Publicar');
    return b ? b.disabled : null;
  })()`);
  paso(
    13,
    'Publicar está bloqueado mientras haya errores',
    publicarBloqueado === true,
  );

  // ── 14. Configurar el paso lo arregla ────────────────────────
  await escribir('textarea', 'Hola, gracias por escribirnos.');
  await esperar(5000);
  await capturar('14-paso-configurado');
  const guardado = await evaluar('document.body.innerText');
  paso(
    14,
    'El editor guarda solo y lo dice',
    typeof guardado === 'string' && /Guardad|Guardando/.test(guardado),
    typeof guardado === 'string'
      ? (guardado.match(/Sin cambios|Guardando…|Guardado|No se pudo guardar/) || [''])[0]
      : '',
  );

  // Rellenar el texto NO basta, y está bien que no baste: el paso sigue sin
  // conectar, así que «no lleva a ningún sitio» y nunca se ejecutaría. El
  // editor lo dice con esas palabras. Se quita, que es la otra salida.
  const errorDeConexion = await evaluar(
    `/no lleva a ningún sitio/.test(document.body.innerText)`,
  );
  paso(
    141,
    'Un paso suelto sigue impidiendo publicar, y explica por qué',
    errorDeConexion === true,
  );

  await pulsar('button', 'Eliminar');
  await esperar(5000);
  const publicarDesbloqueado = await evaluar(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      (e) => e.innerText.trim() === 'Publicar');
    return b ? b.disabled : null;
  })()`);
  paso(
    142,
    'Quitado el paso suelto, se vuelve a poder publicar',
    publicarDesbloqueado === false,
  );
  await capturar('14b-publicable');

  // ── 14c. Publicar de verdad ──────────────────────────────────
  await pulsar('button', 'Publicar');
  await esperar(2500);
  const enDialogo = await evaluar(
    `/Publicar esta versión/.test(document.body.innerText)`,
  );
  paso(143, 'El diálogo de publicación resume qué se va a publicar', enDialogo === true);
  await capturar('14c-dialogo-publicar');

  await evaluar(`(() => {
    const b = [...document.querySelectorAll('input[type=checkbox]')];
    if (b[0]) b[0].click();
    return true;
  })()`);
  await evaluar(`(() => {
    const b = [...document.querySelectorAll('button')].filter(
      (e) => e.innerText.trim() === 'Publicar');
    const el = b[b.length - 1];
    if (el) el.click();
    return !!el;
  })()`);
  await esperar(6000);
  const trasPublicar = await texto();
  paso(
    144,
    'Publicar y activar deja el bot activo',
    typeof trasPublicar === 'string' && /Versión 1|Activo/.test(trasPublicar),
    typeof trasPublicar === 'string'
      ? (trasPublicar.match(/Versión \d+|Activo|Borrador/) || [''])[0]
      : '',
  );
  await capturar('14d-publicado');

  // ── 14e. El historial guarda la versión ──────────────────────
  await irA(`/dashboard/flowbots/${botId}/versions`, 3200);
  const tVersiones = await texto();
  paso(
    145,
    'El historial enseña la versión publicada',
    typeof tVersiones === 'string' && /Versión 1/.test(tVersiones),
  );
  await capturar('14e-versiones');

  // ── 15. Simulador ────────────────────────────────────────────
  // Se vuelve al editor: el bloque de publicación dejó la navegación en el
  // historial de versiones.
  await irA(`/dashboard/flowbots/${botId}/edit`, 4000);
  await pulsar('button', 'Simular');
  await esperar(2500);
  const t15 = await texto();
  paso(
    15,
    'El simulador avisa de que no hace nada real',
    typeof t15 === 'string' &&
      t15.includes('no se realizarán acciones reales'),
  );
  await capturar('15-simulador');

  // ── 16. Ejecuciones del bot ──────────────────────────────────
  await irA(`/dashboard/flowbots/${botId}/executions`, 3000);
  const t16 = await texto();
  paso(
    16,
    'La pantalla de ejecuciones responde',
    typeof t16 === 'string' && /Ejecuciones/.test(t16),
  );
  await capturar('16-ejecuciones');

  // ── 17. Conversaciones ───────────────────────────────────────
  await irA('/dashboard/conversations', 3200);
  const t17 = await texto();
  paso(
    17,
    'Conversaciones carga',
    typeof t17 === 'string' && t17.length > 10,
  );
  await capturar('17-conversaciones');

  // ── 18. Pipeline con administración de embudos ───────────────
  await irA('/dashboard/pipeline', 3200);
  const t18 = await texto();
  const hayAdmin =
    typeof t18 === 'string' && t18.includes('Embudos');
  paso(18, 'El tablero ofrece administrar los embudos', hayAdmin);
  if (hayAdmin) {
    await pulsar('button', 'Embudos');
    await esperar(2000);
    const t18b = await texto();
    paso(
      19,
      'La administración enseña la etapa de entrada',
      typeof t18b === 'string' && t18b.includes('Ventas'),
    );
    await capturar('18-embudos');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (e) => (e.getAttribute('aria-label')||'').includes('Cerrar'));
      if (b) b.click();
      return true;
    })()`);
  }

  // ── Capturas y responsive en los cinco anchos ────────────────
  const PANTALLAS = [
    ['flowbots', '/dashboard/flowbots'],
    ['plantillas', '/dashboard/flowbots/templates'],
    ['nuevo', '/dashboard/flowbots/new'],
    ['editor', `/dashboard/flowbots/${botId}/edit`],
    ['versiones', `/dashboard/flowbots/${botId}/versions`],
    ['ejecuciones', `/dashboard/flowbots/${botId}/executions`],
    ['conversaciones', '/dashboard/conversations'],
    ['pipeline', '/dashboard/pipeline'],
  ];

  const informe = [];
  for (const vp of ANCHOS) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.movil,
    });

    for (const [nombre, ruta] of PANTALLAS) {
      await irA(ruta, 3000);

      const medidas = await evaluar(`(() => {
        const doc = document.documentElement;
        const sinNombre = [...document.querySelectorAll('button, a')].filter(
          (el) => !el.textContent.trim() &&
                  !el.getAttribute('aria-label') &&
                  !el.getAttribute('title'),
        ).length;
        const camposSinEtiqueta = [...document.querySelectorAll('input, select, textarea')].filter(
          (el) => !el.getAttribute('aria-label') &&
                  !el.labels?.length &&
                  !el.getAttribute('placeholder'),
        ).length;
        const imagenesSinAlt = [...document.querySelectorAll('img')].filter(
          (el) => !el.hasAttribute('alt'),
        ).length;
        return {
          desborde: doc.scrollWidth - doc.clientWidth,
          sinNombre,
          camposSinEtiqueta,
          imagenesSinAlt,
          vacia: (document.body.innerText || '').trim().length < 5,
        };
      })()`);

      await capturar(`w${vp.nombre}-${nombre}`);
      informe.push({ pantalla: nombre, ancho: vp.nombre, ...medidas });
      console.log(
        `  ${vp.nombre.padStart(4)}px ${nombre.padEnd(15)} desborde=${String(
          medidas?.desborde,
        ).padStart(3)}px  a11y=${
          (medidas?.sinNombre ?? 0) +
          (medidas?.camposSinEtiqueta ?? 0) +
          (medidas?.imagenesSinAlt ?? 0)
        }`,
      );
    }
  }

  fs.writeFileSync(
    path.join(SALIDA, 'informe.json'),
    JSON.stringify({ pasos, responsive: informe, consola }, null, 2),
  );

  const fallos = pasos.filter((p) => !p.ok);
  const desbordes = informe.filter((r) => (r.desborde ?? 0) > 0);
  console.log(
    `\n${pasos.length - fallos.length}/${pasos.length} pasos OK · ` +
      `${desbordes.length} pantallas con desborde horizontal · ` +
      `${consola.length} errores de consola`,
  );

  ws.close();
  chrome.kill();
  process.exit(fallos.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
