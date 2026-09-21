import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessagesService } from './messages.service';

type AuthenticatedRequest = Request & {
  user: {
    sub: string;
  };
};

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post(':conversationId/messages')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', new ParseUUIDPipe())
    conversationId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.create(request.user.sub, conversationId, dto);
  }
}
