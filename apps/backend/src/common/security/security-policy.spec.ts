import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Política de acceso de TODOS los controladores, comprobada sobre el código.
 *
 * POR QUÉ SOBRE EL CÓDIGO Y NO SOBRE PETICIONES: una prueba de peticiones
 * cubre los endpoints que alguien se acordó de escribir. El riesgo real no es
 * el controlador de hoy, es el que se añada dentro de tres meses sin guardas
 * —y ninguna prueba de comportamiento existente fallará por él, porque nadie
 * habrá escrito la que lo cubre—. Esta recorre el árbol entero, así que un
 * controlador nuevo sin protección rompe el CI el día que se crea.
 *
 * Las excepciones son explícitas y llevan su motivo. Una excepción sin motivo
 * es indistinguible de un olvido.
 */

const RAIZ = join(__dirname, '..', '..', 'modules');

/**
 * Controladores que NO llevan `AuthGuard('jwt')`, con la razón por la que no
 * pueden llevarlo. Añadir uno aquí debe costar tanto como justificarlo.
 */
const SIN_SESION: Record<string, string> = {
  'webhook.controller.ts':
    'Lo llama Meta, no un usuario. Se autentica con la firma HMAC del cuerpo (WhatsAppSignatureGuard), que es más fuerte que un JWT para este caso.',
  'auth.controller.ts':
    'Es donde se obtiene la sesión: exigirla aquí impediría iniciarla.',
  'onboarding.controller.ts':
    'El registro ocurre antes de que exista el usuario; se protege con el código de invitación.',
  'password-recovery.controller.ts':
    'Quien ha perdido la contraseña no puede autenticarse. Se protege con origen, límite de intentos y token de un solo uso.',
};

/** Ficheros cuyos controladores exigen SUPER_ADMIN sin empresa. */
const EXIGEN_PLATAFORMA = [
  'platform-activity.controller.ts',
  'platform-audit-log.controller.ts',
  'platform-companies.controller.ts',
  'support-sessions.controller.ts',
  'invitation-codes.controller.ts',
  'platform-whatsapp-integration.controller.ts',
];

/**
 * Controladores de empresa que además restringen por rol. El resto son de uso
 * cotidiano del asesor y se acotan por empresa, no por rol.
 */
const EXIGEN_ROL = [
  'analytics.controller.ts',
  'automations.controller.ts',
  'chatbot.controller.ts',
  'companies.controller.ts',
  'pipeline.controller.ts',
  'products.controller.ts',
  'users.controller.ts',
  'whatsapp-integration.controller.ts',
  'admin-password-recovery.controller.ts',
];

interface Controlador {
  /** Nombre del fichero, para casar con las listas de arriba. */
  fichero: string;
  /** Nombre de la clase, para que el fallo diga cuál de las dos es. */
  clase: string;
  fuente: string;
}

function buscarPorSufijo(dir: string, sufijo: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...buscarPorSufijo(ruta, sufijo));
    } else if (entrada.endsWith(sufijo) && !entrada.endsWith('.spec.ts')) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

/**
 * Trocea un fichero en sus controladores.
 *
 * Se analiza POR CLASE y no por fichero porque los hay con dos: la
 * recuperación de contraseña tiene juntos el controlador de plataforma y el
 * de empresa, con ámbitos distintos a propósito. Mirando el fichero entero,
 * cualquier regla da un falso positivo — y un falso positivo en una prueba de
 * seguridad es peor que no tenerla: entrena a ignorarla.
 */
function trocear(ruta: string): Controlador[] {
  const fuente = readFileSync(ruta, 'utf8');
  const fichero = ruta.split(/[\\/]/).pop()!;
  const cortes = [...fuente.matchAll(/@UseGuards\(/g)].map((m) => m.index);

  if (cortes.length <= 1) {
    const clase = /export class (\w+)/.exec(fuente)?.[1] ?? fichero;
    return [{ fichero, clase, fuente }];
  }

  return cortes.map((inicio, i) => {
    const trozo = fuente.slice(inicio, cortes[i + 1] ?? fuente.length);
    const clase = /export class (\w+)/.exec(trozo)?.[1] ?? `${fichero}#${i}`;
    return { fichero, clase, fuente: trozo };
  });
}

const controladores = buscarPorSufijo(RAIZ, '.controller.ts').flatMap(trocear);

/** ¿Este controlador sirve el panel de plataforma? */
const esDePlataforma = (c: Controlador) =>
  EXIGEN_PLATAFORMA.includes(c.fichero) ||
  c.fuente.includes('PlatformGuard') ||
  /@Controller\(['"]platform\//.test(c.fuente);

describe('Política de acceso de los controladores', () => {
  it('se encontraron controladores que revisar', () => {
    // Si el descubrimiento se rompe, todas las demás pruebas pasarían por
    // vacuidad. Esta es la que impide que eso ocurra en silencio.
    expect(controladores.length).toBeGreaterThan(20);
  });

  describe('todos exigen sesión, salvo excepciones justificadas', () => {
    it.each(controladores.map((c) => [c.clase, c] as const))(
      '%s',
      (_clase, controlador) => {
        if (SIN_SESION[controlador.fichero]) {
          // La excepción existe: se comprueba que sigue teniendo un motivo
          // escrito, no que el motivo siga siendo cierto —eso lo juzga quien
          // lo lea—.
          expect(SIN_SESION[controlador.fichero].length).toBeGreaterThan(30);
          return;
        }

        expect(controlador.fuente).toContain("AuthGuard('jwt')");
      },
    );
  });

  describe('aislamiento multiempresa', () => {
    it.each(
      controladores
        .filter((c) => !SIN_SESION[c.fichero] && !esDePlataforma(c))
        .map((c) => [c.clase, c] as const),
    )('%s acota por empresa', (_clase, controlador) => {
      // `BusinessTenantGuard` rechaza a quien no tiene empresa, es decir al
      // SUPER_ADMIN de plataforma. Sin él, el panel de plataforma alcanza
      // endpoints de negocio; que no devuelvan nada es una casualidad de los
      // datos, no una garantía del control de acceso.
      expect(controlador.fuente).toContain('BusinessTenantGuard');
    });

    it.each(EXIGEN_PLATAFORMA.map((n) => [n] as const))(
      '%s exige SUPER_ADMIN de plataforma',
      (fichero) => {
        const encontrados = controladores.filter((c) => c.fichero === fichero);
        expect(encontrados.length).toBeGreaterThan(0);
        // PlatformGuard = SUPER_ADMIN **y** companyId null. Un SUPER_ADMIN
        // atado a una empresa no entra: el panel de plataforma no es un rol,
        // es un ámbito.
        for (const c of encontrados) {
          expect(c.fuente).toContain('PlatformGuard');
        }
      },
    );

    it('ningún controlador de empresa usa PlatformGuard por error', () => {
      // Sería un fallo abierto: dejaría el endpoint accesible solo a
      // plataforma y silenciosamente roto para las empresas.
      const sospechosos = controladores.filter(
        (c) =>
          c.fuente.includes('PlatformGuard') &&
          !/@Controller\(['"](platform|admin)\//.test(c.fuente) &&
          !EXIGEN_PLATAFORMA.includes(c.fichero),
      );

      expect(sospechosos.map((c) => c.clase)).toEqual([]);
    });
  });

  describe('restricción por rol', () => {
    it.each(EXIGEN_ROL.map((n) => [n] as const))(
      '%s declara @Roles y RolesGuard',
      (fichero) => {
        const conRol = controladores.filter(
          (c) => c.fichero === fichero && /@Roles\(/.test(c.fuente),
        );
        expect(conRol.length).toBeGreaterThan(0);
        // Las dos cosas: `@Roles` sin `RolesGuard` es decoración que no
        // restringe nada, y es un fallo que no se ve mirando el decorador.
        for (const c of conRol) {
          expect(c.fuente).toContain('RolesGuard');
        }
      },
    );

    it('ningún controlador declara @Roles sin RolesGuard', () => {
      const rotos = controladores.filter(
        (c) => /@Roles\(/.test(c.fuente) && !c.fuente.includes('RolesGuard'),
      );

      expect(rotos.map((c) => c.clase)).toEqual([]);
    });
  });

  describe('el companyId nunca viaja en el cuerpo', () => {
    it('ningún DTO de negocio acepta companyId', () => {
      // La lista blanca de `ValidationPipe` lo rechazaría, pero un DTO que lo
      // declare lo convierte en aceptado: es la vía más directa a escribir en
      // otra empresa.
      //
      // Los DTO de PLATAFORMA sí lo llevan, y deben: una sesión de soporte la
      // abre un SUPER_ADMIN *para* una empresa concreta, así que el destino
      // viene en el cuerpo y su guarda es otra.
      const dtos = buscarPorSufijo(RAIZ, '.dto.ts').filter(
        (d) => !d.includes('platform'),
      );
      const conCompanyId = dtos.filter((d) =>
        /^\s*companyId[?!]?\s*[:!]/m.test(readFileSync(d, 'utf8')),
      );

      expect(conCompanyId.map((d) => d.split(/[\\/]/).pop())).toEqual([]);
    });
  });
});
