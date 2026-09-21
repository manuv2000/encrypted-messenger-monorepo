import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListDeviceMessagesQueryDto } from './dto/list-device-messages-query.dto';
import { MessagesService } from './messages.service';

type AuthenticatedRequest = Request & {
  user: {
    sub: string;
  };
};

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DeviceMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get(':deviceId/messages')
  listForDevice(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId', new ParseUUIDPipe())
    deviceId: string,
    @Query() query: ListDeviceMessagesQueryDto,
  ) {
    return this.messagesService.listForDevice(
      request.user.sub,
      deviceId,
      query,
    );
  }
  @Post(':deviceId/messages/:messageId/ack')
  @HttpCode(HttpStatus.OK)
  acknowledgeDelivery(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId', new ParseUUIDPipe())
    deviceId: string,
    @Param('messageId', new ParseUUIDPipe())
    messageId: string,
  ) {
    return this.messagesService.acknowledgeDelivery(
      request.user.sub,
      deviceId,
      messageId,
    );
  }
}
