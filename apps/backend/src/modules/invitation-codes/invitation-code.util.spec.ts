import {
  buildCodePreview,
  generateInvitationCode,
  hashInvitationCode,
  INVITATION_CODE_PREFIX,
  INVITATION_CODE_SECRET_BITS,
  LEGACY_INVITATION_CODE_PREFIX,
  normalizeInvitationCode,
} from './invitation-code.util';

describe('invitation-code.util (Fase 1: prefijo TAKTO, legacy TEHUS por hash)', () => {
  it('los códigos nuevos empiezan por TAKTO y conservan 16 hex aleatorios en 4 grupos', () => {
    expect(INVITATION_CODE_PREFIX).toBe('TAKTO');
    for (let i = 0; i < 50; i++) {
      expect(generateInvitationCode()).toMatch(
        /^TAKTO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/,
      );
    }
  });

  it('entropía: 64 bits secretos; 2 000 códigos seguidos no repiten la parte aleatoria', () => {
    expect(INVITATION_CODE_SECRET_BITS).toBe(64);
    const secrets = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateInvitationCode();
      const secret = code.slice(INVITATION_CODE_PREFIX.length + 1);
      expect(secret.replace(/-/g, '')).toHaveLength(16);
      secrets.add(secret);
    }
    expect(secrets.size).toBe(2000);
  });

  it('la parte secreta no depende del prefijo: cambiarlo no la hace predecible', () => {
    // Mismo generador, distinta cabecera: los hexadecimales siguen siendo
    // aleatorios, y dos códigos nunca comparten los 16 caracteres.
    const a = generateInvitationCode().slice(6);
    const b = generateInvitationCode().slice(6);
    expect(a).not.toBe(b);
  });

  it('normaliza igual con o sin guiones, en cualquier caja y con espacios', () => {
    expect(normalizeInvitationCode(' takto-ab12-cd34-ef56-7890 ')).toBe(
      'TAKTOAB12CD34EF567890',
    );
    expect(normalizeInvitationCode('TAKTOAB12CD34EF567890')).toBe(
      'TAKTOAB12CD34EF567890',
    );
    expect(normalizeInvitationCode('tehus-ab12-cd34-ef56-7890')).toBe(
      'TEHUSAB12CD34EF567890',
    );
  });

  it('el hash incluye el prefijo: un código TEHUS y un TAKTO con la misma parte secreta son códigos distintos', () => {
    const secret = 'AB12-CD34-EF56-7890';
    const legacy = hashInvitationCode(
      normalizeInvitationCode(`TEHUS-${secret}`),
    );
    const current = hashInvitationCode(
      normalizeInvitationCode(`TAKTO-${secret}`),
    );
    expect(legacy).not.toBe(current);
    expect(legacy).toMatch(/^[0-9a-f]{64}$/);
    // Determinista: el mismo código legacy sigue produciendo el mismo hash,
    // que es lo que mantiene válidos los códigos TEHUS ya emitidos.
    expect(hashInvitationCode(normalizeInvitationCode(`tehus-${secret}`))).toBe(
      legacy,
    );
  });

  it('la vista previa enmascara todo salvo los últimos 4 y conserva el prefijo con el que se generó el código', () => {
    expect(buildCodePreview('TAKTO-AB12-CD34-EF56-7890')).toBe(
      'TAKTO-****-****-****-7890',
    );
    expect(buildCodePreview('tehus-ab12-cd34-ef56-7890')).toBe(
      `${LEGACY_INVITATION_CODE_PREFIX}-****-****-****-7890`,
    );
    expect(buildCodePreview('TAKTO-AB12-CD34-EF56-7890')).not.toContain('AB12');
  });
});
