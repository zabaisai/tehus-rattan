import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';

describe('AuthController', () => {
  let authService: any;
  let controller: AuthController;

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      me: jest.fn(),
    };
    controller = new AuthController(authService);
  });

  it('applies OnboardingInviteGuard to POST /auth/register', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.register);
    expect(guards).toContain(OnboardingInviteGuard);
  });

  it('does not gate /auth/login with the onboarding invite guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.login) ?? [];
    expect(guards).not.toContain(OnboardingInviteGuard);
  });

  it('delegates register to authService.register', async () => {
    authService.register.mockResolvedValue({ token: 't', user: {} });
    const body = {
      companyName: 'Co',
      name: 'Admin',
      email: 'a@co.test',
      password: 'password123',
    };

    await controller.register(body as any);

    expect(authService.register).toHaveBeenCalledWith(body);
  });

  it('delegates login to authService.login', async () => {
    authService.login.mockResolvedValue({ token: 't', user: {} });

    await controller.login({ email: 'a@co.test', password: 'password123' } as any);

    expect(authService.login).toHaveBeenCalledWith('a@co.test', 'password123');
  });
});
