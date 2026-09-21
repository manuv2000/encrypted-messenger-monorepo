import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConversationsService } from './conversations.service';
import { CreateDirectConversationDto } from './dto/create-direct-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';

type AuthenticatedRequest = Request & {
  user: {
    sub: string;
  };
};

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post('direct')
  createDirect(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateDirectConversationDto,
  ) {
    return this.conversationsService.createDirect(request.user.sub, dto);
  }

  @Get()
  findAll(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.conversationsService.findAllForUser(request.user.sub, query);
  }
}
