import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { DeviceMessagesController } from './device-messages.controller';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [AuthModule, PrismaModule, RealtimeModule],
  controllers: [MessagesController, DeviceMessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
