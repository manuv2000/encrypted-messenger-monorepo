import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { UserDevicesController } from './user-devices.controller';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DevicesController, UserDevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
