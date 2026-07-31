import { validate } from 'class-validator';
import {
  checkPasswordPolicy,
  IsStrongPassword,
  isStrongPassword,
  PASSWORD_MIN_LENGTH,
} from './password-policy';

class Dto {
  @IsStrongPassword()
  password!: string;
  constructor(password: string) {
    this.password = password;
  }
}

describe('password-policy', () => {
  describe('checkPasswordPolicy / isStrongPassword', () => {
    it('accepts a password meeting all requirements', () => {
      expect(checkPasswordPolicy('Str0ng!Pass9')).toEqual([]);
      expect(isStrongPassword('Str0ng!Pass9')).toBe(true);
    });

    it.each([
      ['short', 'Ab1!xy', 'Al menos'],
      ['no upper', 'lowercase1!x', 'mayúscula'],
      ['no lower', 'UPPERCASE1!X', 'minúscula'],
      ['no digit', 'NoDigits!!xx', 'Un número'],
      ['no special', 'NoSpecial123x', 'carácter especial'],
    ])('rejects %s and reports the unmet rule', (_label, pw, needle) => {
      const unmet = checkPasswordPolicy(pw);
      expect(unmet.length).toBeGreaterThan(0);
      expect(unmet.join(' ')).toContain(needle);
      expect(isStrongPassword(pw)).toBe(false);
    });

    it('rejects a non-string', () => {
      expect(isStrongPassword(undefined)).toBe(false);
      expect(isStrongPassword(12345)).toBe(false);
    });

    it('enforces the documented minimum length', () => {
      expect(
        isStrongPassword('Aa1!' + 'x'.repeat(PASSWORD_MIN_LENGTH - 5)),
      ).toBe(false);
      expect(
        isStrongPassword('Aa1!' + 'x'.repeat(PASSWORD_MIN_LENGTH - 4)),
      ).toBe(true);
    });
  });

  describe('@IsStrongPassword decorator', () => {
    it('passes a strong password', async () => {
      expect(await validate(new Dto('Str0ng!Pass9'))).toHaveLength(0);
    });
    it('fails a weak password with a policy message (no password value leaked)', async () => {
      const errors = await validate(new Dto('weak'));
      expect(errors).toHaveLength(1);
      const message = Object.values(errors[0].constraints ?? {}).join(' ');
      expect(message).toContain('política de seguridad');
      expect(message).not.toContain('weak');
    });
  });
});
