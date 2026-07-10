import {
  Controller,
  Post,
  Body,
  Get,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Deprecated in favor of POST /onboarding/company, which also creates the
  // pipeline/stages/agents this endpoint never did. Kept for backward
  // compatibility, but gated the same way so it can no longer create a
  // Company + ADMIN for free.
  @UseGuards(OnboardingInviteGuard)
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Request() req: any) {
    return this.authService.me(req.user.sub);
  }
}
