#!/usr/bin/env node
/**
 * Envío PUNTUAL de una plantilla de WhatsApp desde la integración CONECTADA
 * (principal) de staging — herramienta de operación, no parte del producto.
 *
 * POR QUÉ EXISTE (2026-09-01): para la demo del video de Meta hay que cerrar
 * el ciclo de mensajería en staging. Los números de PRUEBA de Meta no pueden
 * recibir mensajes iniciados desde la app normal de WhatsApp (el celular ve
 * "Invitar"), así que el ciclo debe abrirlo un envío SALIENTE de plantilla
 * desde el número conectado (+1 555-379-5898, el Principal); la respuesta del
 * celular entra por el webhook ya Suscrito a Conversaciones de TAKTO. El
 * endpoint normal POST /me/test solo envía TEXTO (exige ventana de 24 h
 * abierta), por eso este script envía una PLANTILLA (hello_world por defecto).
 *
 * QUÉ HACE:
 *   1. Busca en la BD la integración { status: CONNECTED, isPrimary: true }.
 *   2. Descifra su accessTokenEncrypted con WHATSAPP_TOKEN_ENCRYPTION_KEY
 *      (mismo formato que WhatsAppTokenCryptoService: "iv:tag:cipher",
 *      AES-256-GCM, clave = sha256(env); prueba la _PREVIOUS si hay rotación).
 *   3. POST https://graph.facebook.com/<ver>/<phoneNumberId>/messages con
 *      { type: 'template' } al destinatario indicado.
 *   4. Imprime SOLO ids de la integración y la respuesta de Meta.
 *      NUNCA imprime el token (ni cifrado ni descifrado) ni la clave.
 *
 * EJECUCIÓN (en el VPS de staging; el script corre DENTRO del contenedor
 * backend, que ya tiene @prisma/client, la clave de cifrado y la BD):
 *   scp -i ~/.ssh/tehus_vps_ed25519 deploy/scripts/send-demo-template.mjs \
 *       deploy@crm-staging.tehusrattan.com:/tmp/
 *   ssh ... "docker cp /tmp/send-demo-template.mjs tehus-crm-staging-backend-1:/tmp/ && \
 *     docker exec tehus-crm-staging-backend-1 node /tmp/send-demo-template.mjs \
 *       +573014886526 hello_world en_US"
 *
 * Si Meta responde 131030 ("recipient phone number not in allowed list"), el
 * destinatario no está en la lista de la WABA del número emisor: las WABAs de
 * prueba solo entregan a destinatarios registrados en SU propia lista, y esa
 * lista se gestiona en el panel (no hay endpoint Graph API público para
 * añadir destinatarios con el token de la integración).
 *
 * Solo staging. No tocar producción con esto.
 */
import { createDecipheriv, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// El script vive en /tmp dentro del contenedor; el node_modules del backend
// está en /app, así que la resolución se ancla ahí.
const require = createRequire('/app/package.json');
const { PrismaClient } = require('@prisma/client');

// Modos:
//   send +<E164> [plantilla] [idioma]  → envía la plantilla (por defecto)
//   check                              → estado del número en Meta
//     (platform_type / is_on_biz_app / code_verification_status) — para
//     confirmar que NO es coexistencia antes de cualquier registro
//   register <PIN de 6 dígitos>       → POST /register (SOLO números de
//     prueba / nuevos; JAMÁS coexistencia: sacaría el número de la app).
//     Necesario tras Embedded Signup: el flujo NO registra (error 133010
//     "Account not registered" al enviar — visto en staging 2026-09-01 con el
//     número de prueba, y OTRA VEZ el mismo día con el primer número REAL
//     conectado en otro tenant: es sistemático, no un caso raro del sandbox).
//
// Selección de integración (staging ya es multi-tenant, hay varias):
//   --num <últimos dígitos>  → elige la integración CONNECTED cuyo número
//     termina en esos dígitos (debe haber exactamente una coincidencia).
//   Sin --num, se usa la CONNECTED con isPrimary (comportamiento original).
// La salida enmascara el número: solo se muestran los últimos 4 dígitos.
const argv = process.argv.slice(2);
const numIdx = argv.indexOf('--num');
let numSuffix = null;
if (numIdx !== -1) {
  numSuffix = (argv[numIdx + 1] ?? '').replace(/\D/g, '');
  if (numSuffix.length < 4) {
    console.error('--num requiere al menos los últimos 4 dígitos del número');
    process.exit(1);
  }
  argv.splice(numIdx, 2);
}
const [modo, ...resto] = argv;
let to;
let template = 'hello_world';
let lang = 'en_US';
if (modo === 'send' || /^\+/.test(modo ?? '')) {
  [to, template = 'hello_world', lang = 'en_US'] =
    modo === 'send' ? resto : [modo, ...resto];
  if (!to || !/^\+[1-9]\d{6,14}$/.test(to)) {
    console.error(
      'Uso: node send-demo-template.mjs [send] +<E164> [plantilla] [idioma] | check | register <PIN>',
    );
    process.exit(1);
  }
} else if (modo !== 'check' && modo !== 'register' && modo !== 'templates') {
  console.error(
    'Uso: node send-demo-template.mjs [send] +<E164> [plantilla] [idioma] | check | register <PIN>',
  );
  process.exit(1);
}

function decrypt(enc) {
  const [ivHex, tagHex, dataHex] = enc.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Formato de accessTokenEncrypted inválido');
  }
  const conClave = (raw) => {
    const key = createHash('sha256').update(raw).digest();
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    d.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      d.update(Buffer.from(dataHex, 'hex')),
      d.final(),
    ]).toString('utf8');
  };
  try {
    return conClave(process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? '');
  } catch (errorConActual) {
    const prev = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS;
    if (!prev?.trim()) throw errorConActual;
    return conClave(prev);
  }
}

const mask = (n) => {
  const digits = (n ?? '').replace(/\D/g, '');
  return digits ? `••• ${digits.slice(-4)}` : '(sin número)';
};

const prisma = new PrismaClient();
try {
  const conectadas = await prisma.whatsAppIntegration.findMany({
    where: { status: 'CONNECTED' },
    include: { company: { select: { name: true } } },
  });
  let integ;
  if (numSuffix) {
    const candidatas = conectadas.filter((i) =>
      (i.displayPhoneNumber ?? '').replace(/\D/g, '').endsWith(numSuffix),
    );
    if (candidatas.length !== 1) {
      console.error(
        `--num ${numSuffix}: ${candidatas.length} coincidencias entre las CONNECTED:`,
      );
      for (const i of conectadas) {
        console.error(`  - ${i.company?.name ?? '?'} ${mask(i.displayPhoneNumber)}`);
      }
      process.exit(1);
    }
    integ = candidatas[0];
  } else {
    // isPrimary es POR EMPRESA: con varios tenants conectados el default es
    // ambiguo y hay que elegir explícitamente con --num.
    const primarias = conectadas.filter((i) => i.isPrimary);
    if (primarias.length !== 1) {
      console.error(
        `Hay ${primarias.length} integraciones principales CONNECTED; usa --num <últimos dígitos>:`,
      );
      for (const i of conectadas) {
        console.error(`  - ${i.company?.name ?? '?'} ${mask(i.displayPhoneNumber)}`);
      }
      process.exit(1);
    }
    integ = primarias[0];
  }
  if (!integ?.accessTokenEncrypted) {
    console.error('No hay integración CONECTADA seleccionable con token guardado.');
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        integracion: {
          id: integ.id,
          empresa: integ.company?.name,
          label: integ.label,
          numero: mask(integ.displayPhoneNumber),
          phoneNumberId: integ.phoneNumberId,
          wabaId: integ.wabaId,
        },
        envio: { to, template, lang },
      },
      null,
      2,
    ),
  );

  const token = decrypt(integ.accessTokenEncrypted);
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';
  const base = `https://graph.facebook.com/${version}/${integ.phoneNumberId}`;
  const auth = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let res;
  if (modo === 'templates') {
    // Plantillas de la WABA del número emisor. hello_world NO sirve aquí:
    // Meta lo restringe al número de prueba público de la app (error 131058,
    // visto en staging) — hay que usar una plantilla APPROVED de esta WABA.
    res = await fetch(
      `https://graph.facebook.com/${version}/${integ.wabaId}/message_templates?fields=name,language,status,category,components&limit=25`,
      { headers: auth },
    );
  } else if (modo === 'check') {
    res = await fetch(
      `${base}?fields=display_phone_number,verified_name,platform_type,is_on_biz_app,code_verification_status,quality_rating`,
      { headers: auth },
    );
  } else if (modo === 'register') {
    const pin = resto[0];
    if (!/^\d{6}$/.test(pin ?? '')) {
      console.error('register requiere un PIN de 6 dígitos');
      process.exit(1);
    }
    res = await fetch(`${base}/register`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
  } else {
    res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: template, language: { code: lang } },
      }),
    });
  }
  const body = await res.json().catch(() => ({}));
  console.log(
    JSON.stringify({ modo: modo ?? 'send', httpStatus: res.status, respuestaMeta: body }, null, 2),
  );
  process.exitCode = res.ok ? 0 : 2;
} finally {
  await prisma.$disconnect();
}
