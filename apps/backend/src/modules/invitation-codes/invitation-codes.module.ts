import { Module } from '@nestjs/common';
import { InvitationCodesController } from './invitation-codes.controller';
import { InvitationCodesService } from './invitation-codes.service';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [PlatformModule],
  controllers: [InvitationCodesController],
  providers: [InvitationCodesService],
  exports: [InvitationCodesService],
})
export class InvitationCodesModule {}
