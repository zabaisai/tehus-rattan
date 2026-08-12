import { describe, expect, it, beforeEach } from 'vitest';
import {
  ACCIONES_RAPIDAS,
  accionesPara,
  leerRecientes,
  olvidarRecientes,
  registrarReciente,
} from './creacion-rapida';
import type { ResultadoDeBusqueda } from './busqueda';

const resultado = (id: string, titulo = `T-${id}`): ResultadoDeBusqueda => ({
  tipo: 'contactos',
  id,
  titulo,
  subtitulo: null,
  insignia: null,
  contactoId: id,
});

const SESION = { companyId: 'e1', userId: 'u1' };

describe('accionesPara — permisos espejados del backend', () => {
  it('un AGENT no ve crear producto ni bot', () => {
    // POST /products exige ADMIN; POST /flowbots exige ADMIN o MANAGER.
    // Enseñar el boton y fallar con 403 al pulsarlo es peor que no enseñarlo.
    const acciones = accionesPara('AGENT').map((a) => a.accion);

    expect(acciones).not.toContain('producto');
    expect(acciones).not.toContain('bot');
    expect(acciones).toEqual(
      expect.arrayContaining(['contacto', 'oportunidad', 'tarea', 'cotizacion']),
    );
  });

  it('un MANAGER ve bot pero NO producto', () => {
    const acciones = accionesPara('MANAGER').map((a) => a.accion);

    expect(acciones).toContain('bot');
    expect(acciones).not.toContain('producto');
  });

  it('un ADMIN las ve todas', () => {
    expect(accionesPara('ADMIN')).toHaveLength(ACCIONES_RAPIDAS.length);
  });

  it('sin rol no se ofrece nada', () => {
    expect(accionesPara(undefined)).toEqual([]);
  });

  it('las acciones que navegan lo avisan', () => {
    // Una cotizacion pertenece SIEMPRE a una oportunidad, y un bot se edita en
    // su pantalla. Pulsar y que no aparezca un formulario seria una sorpresa.
    for (const a of ACCIONES_RAPIDAS.filter((x) => x.ruta)) {
      expect(a.nota).toBeTruthy();
    }
    for (const a of ACCIONES_RAPIDAS.filter((x) => !x.ruta)) {
      expect(a.nota).toBeUndefined();
    }
  });
});

describe('recientes', () => {
  beforeEach(() => {
    olvidarRecientes();
  });

  it('lo ultimo abierto va primero', () => {
    registrarReciente(resultado('a'), SESION);
    registrarReciente(resultado('b'), SESION);

    expect(leerRecientes(SESION).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('abrir dos veces lo mismo no llena la lista', () => {
    registrarReciente(resultado('a'), SESION);
    registrarReciente(resultado('b'), SESION);
    registrarReciente(resultado('a'), SESION);

    expect(leerRecientes(SESION).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('se queda en seis', () => {
    for (let i = 0; i < 12; i++) registrarReciente(resultado(String(i)), SESION);

    expect(leerRecientes(SESION)).toHaveLength(6);
  });

  describe('aislamiento entre sesiones', () => {
    it('otra empresa NO ve los recientes de la anterior', () => {
      // Un navegador compartido no debe filtrar entre inquilinos lo que cada
      // uno estuvo mirando.
      registrarReciente(resultado('a'), SESION);

      expect(leerRecientes({ companyId: 'e2', userId: 'u1' })).toEqual([]);
    });

    it('otro usuario de la misma empresa tampoco', () => {
      registrarReciente(resultado('a'), SESION);

      expect(leerRecientes({ companyId: 'e1', userId: 'u2' })).toEqual([]);
    });

    it('cambiar de sesion descarta la lista, no la mezcla', () => {
      registrarReciente(resultado('a'), SESION);
      registrarReciente(resultado('z'), { companyId: 'e2', userId: 'u9' });

      expect(leerRecientes({ companyId: 'e2', userId: 'u9' }).map((r) => r.id)).toEqual(['z']);
      // Y la primera sesion ya no puede recuperar lo suyo.
      expect(leerRecientes(SESION)).toEqual([]);
    });

    it('olvidarRecientes deja la lista vacia', () => {
      registrarReciente(resultado('a'), SESION);

      olvidarRecientes();

      expect(leerRecientes(SESION)).toEqual([]);
    });
  });

  it('guarda lo justo para pintar la fila, no el objeto entero', () => {
    registrarReciente(resultado('a', 'Laura'), SESION);

    expect(Object.keys(leerRecientes(SESION)[0]).sort()).toEqual([
      'id',
      'subtitulo',
      'tipo',
      'titulo',
    ]);
  });
});
