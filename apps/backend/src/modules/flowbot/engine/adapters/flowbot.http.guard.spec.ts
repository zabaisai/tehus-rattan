import {
  CABECERAS_PROHIBIDAS,
  esIpInterna,
  filtrarCabeceras,
  hostPermitido,
  httpEsReintentable,
  metodoPermitido,
  revisarUrl,
} from './flowbot.http.guard';

/**
 * Un guardia de SSRF que solo se ejercita con peticiones reales acaba con dos
 * casos probados y veinte sin probar. Estas son funciones puras, así que se
 * pueden barrer enteras.
 */
describe('guardas de la llamada HTTP', () => {
  describe('direcciones internas', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'todo el bloque de loopback'],
      ['0.0.0.0', '«esta red»'],
      ['10.1.2.3', 'privada A'],
      ['172.16.0.1', 'privada B, límite inferior'],
      ['172.31.255.255', 'privada B, límite superior'],
      ['192.168.1.1', 'privada C'],
      ['169.254.169.254', 'metadata de AWS, GCP y Azure'],
      ['100.64.0.1', 'CGNAT'],
      ['224.0.0.1', 'multicast'],
      ['::1', 'loopback IPv6'],
      ['fe80::1', 'enlace local IPv6'],
      ['fd00::1', 'única local IPv6'],
      ['::ffff:10.0.0.1', 'IPv4 envuelta en IPv6'],
      ['::ffff:169.254.169.254', 'metadata envuelta en IPv6'],
    ])('bloquea %s (%s)', (ip) => {
      expect(esIpInterna(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2001:4860::1'])(
      'deja pasar %s',
      (ip) => {
        expect(esIpInterna(ip)).toBe(false);
      },
    );

    it('lo que no se entiende se bloquea', () => {
      // Fallar hacia el lado seguro: un formato raro que no sabemos leer no
      // puede convertirse en un permiso.
      expect(esIpInterna('no-es-una-ip')).toBe(true);
      expect(esIpInterna('1.2.3')).toBe(true);
    });
  });

  describe('lista de destinos de la empresa', () => {
    const lista = ['api.ejemplo.com', 'servicios.otra.co'];

    it('acepta el host exacto', () => {
      expect(hostPermitido('api.ejemplo.com', lista)).toBe(true);
    });

    it('acepta un subdominio del permitido', () => {
      expect(hostPermitido('v2.api.ejemplo.com', lista)).toBe(true);
    });

    it('NO acepta un dominio que solo lo contiene', () => {
      // `includes` dejaría pasar esto, y es el truco de siempre.
      expect(hostPermitido('api.ejemplo.com.atacante.net', lista)).toBe(false);
    });

    it('NO acepta un sufijo pegado sin punto', () => {
      expect(hostPermitido('malapi.ejemplo.com', lista)).toBe(false);
    });

    it('una lista VACÍA no significa «todos»', () => {
      // Encender HTTP sin configurar destinos abriría la salida a internet
      // entero, que es justo lo que la lista existe para evitar.
      expect(hostPermitido('api.ejemplo.com', [])).toBe(false);
    });

    it('es insensible a mayúsculas', () => {
      expect(hostPermitido('API.Ejemplo.COM', lista)).toBe(true);
    });
  });

  describe('forma de la URL', () => {
    const lista = ['api.ejemplo.com'];

    it('acepta una URL correcta', () => {
      expect(revisarUrl('https://api.ejemplo.com/v1/x', lista).ok).toBe(true);
    });

    it('rechaza http', () => {
      expect(revisarUrl('http://api.ejemplo.com/x', lista)).toMatchObject({
        ok: false,
        motivo: 'no-https',
      });
    });

    it('rechaza credenciales en la URL', () => {
      // Viajan en logs, historiales y cabeceras de referencia.
      expect(revisarUrl('https://u:p@api.ejemplo.com/x', lista)).toMatchObject({
        ok: false,
        motivo: 'credenciales-en-url',
      });
    });

    it('rechaza un puerto que no es el de https', () => {
      // Un puerto raro sobre https suele ser un servicio interno expuesto por
      // error.
      expect(revisarUrl('https://api.ejemplo.com:8443/x', lista)).toMatchObject(
        { ok: false, motivo: 'puerto-no-permitido' },
      );
    });

    it('acepta el 443 explícito', () => {
      expect(revisarUrl('https://api.ejemplo.com:443/x', lista).ok).toBe(true);
    });

    it('rechaza un host fuera de la lista', () => {
      expect(revisarUrl('https://otro.com/x', lista)).toMatchObject({
        ok: false,
        motivo: 'host-no-permitido',
      });
    });

    it('rechaza una IP privada literal sin esperar al DNS', () => {
      expect(
        revisarUrl('https://169.254.169.254/latest/meta-data/', [
          '169.254.169.254',
        ]),
      ).toMatchObject({ ok: false, motivo: 'ip-privada' });
    });

    it('rechaza basura', () => {
      expect(revisarUrl('no es una url', lista)).toMatchObject({
        ok: false,
        motivo: 'url-invalida',
      });
    });

    it('el detalle NO lleva la URL completa', () => {
      // Un log compartido no puede acabar con la ruta y los parámetros de una
      // llamada, que a veces llevan identificadores del cliente.
      const r = revisarUrl('https://secreto.interno/api?token=abc', ['x.com']);
      expect(r.detalle).toBe('secreto.interno');
      expect(JSON.stringify(r)).not.toContain('token=abc');
    });
  });

  describe('métodos', () => {
    it.each(['GET', 'post', 'PUT', 'PATCH', 'DELETE'])('acepta %s', (m) => {
      expect(metodoPermitido(m)).toBe(true);
    });

    it.each(['TRACE', 'CONNECT', 'OPTIONS', ''])('rechaza %s', (m) => {
      expect(metodoPermitido(m)).toBe(false);
    });
  });

  describe('cabeceras', () => {
    it('deja pasar una cabecera normal', () => {
      const r = filtrarCabeceras({ 'X-Cliente': 'takto' });
      expect(r.seguras).toEqual({ 'x-cliente': 'takto' });
      expect(r.descartadas).toEqual([]);
    });

    it.each(CABECERAS_PROHIBIDAS)('descarta %s', (nombre) => {
      // `authorization` la pone la credencial, no el flujo: si el nodo pudiera
      // escribirla, cualquiera con permiso de edición mandaría el token de la
      // empresa a donde quisiera.
      const r = filtrarCabeceras({ [nombre]: 'lo que sea' });
      expect(r.seguras).toEqual({});
      expect(r.descartadas).toEqual([nombre]);
    });

    it('descarta un nombre con salto de línea', () => {
      // Permite inyectar cabeceras enteras, incluida la de autorización.
      const r = filtrarCabeceras({ 'X-A\r\nAuthorization': 'Bearer robado' });
      expect(r.seguras).toEqual({});
    });

    it('descarta un VALOR con salto de línea', () => {
      const r = filtrarCabeceras({ 'X-A': 'v\r\nAuthorization: Bearer x' });
      expect(r.seguras).toEqual({});
    });

    it('recorta valores desmesurados', () => {
      const r = filtrarCabeceras({ 'X-A': 'x'.repeat(5000) });
      expect(r.seguras['x-a'].length).toBe(2048);
    });

    it('las descartadas se informan, no se ignoran en silencio', () => {
      const r = filtrarCabeceras({ Authorization: 'x', 'X-Ok': 'y' });
      expect(r.descartadas).toEqual(['Authorization']);
      expect(r.seguras).toEqual({ 'x-ok': 'y' });
    });
  });

  describe('qué merece reintento', () => {
    it.each([500, 502, 503, 504, 429, 408])('reintenta %i', (e) => {
      expect(httpEsReintentable(e)).toBe(true);
    });

    it.each([400, 401, 403, 404, 422])('NO reintenta %i', (e) => {
      // Reintentar un 404 cinco veces gasta cola para nada.
      expect(httpEsReintentable(e)).toBe(false);
    });

    it('un fallo de red sí se reintenta', () => {
      expect(httpEsReintentable(null)).toBe(true);
    });
  });
});
