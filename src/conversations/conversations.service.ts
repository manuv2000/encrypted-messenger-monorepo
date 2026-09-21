import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDirectConversationDto } from './dto/create-direct-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';

const directConversationSelect = {
  id: true,
  type: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
  members: {
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      createdAt: true,
      user: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  },
} satisfies Prisma.ConversationSelect;

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDirect(currentUserId: string, dto: CreateDirectConversationDto) {
    if (currentUserId === dto.recipientUserId) {
      throw new BadRequestException(
        'A direct conversation requires another user',
      );
    }

    const recipient = await this.prisma.user.findUnique({
      where: {
        id: dto.recipientUserId,
      },
      select: {
        id: true,
      },
    });

    if (!recipient) {
      throw new NotFoundException('Recipient user not found');
    }

    const directKey = this.createDirectKey(currentUserId, recipient.id);

    const existingConversation = await this.prisma.conversation.findUnique({
      where: {
        directKey,
      },
      select: directConversationSelect,
    });

    if (existingConversation) {
      return existingConversation;
    }

    try {
      return await this.prisma.conversation.create({
        data: {
          type: ConversationType.DIRECT,
          directKey,
          members: {
            create: [
              {
                user: {
                  connect: {
                    id: currentUserId,
                  },
                },
              },
              {
                user: {
                  connect: {
                    id: recipient.id,
                  },
                },
              },
            ],
          },
        },
        select: directConversationSelect,
      });
    } catch (error: unknown) {
      /*
       * Two users could create the same conversation simultaneously.
       * The unique directKey prevents duplication. If another request
       * won the race, return the conversation it created.
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const conversation = await this.prisma.conversation.findUnique({
          where: {
            directKey,
          },
          select: directConversationSelect,
        });

        if (conversation) {
          return conversation;
        }
      }

      throw error;
    }
  }

  private createDirectKey(firstUserId: string, secondUserId: string): string {
    return [firstUserId, secondUserId].sort().join(':');
  }

  async findAllForUser(userId: string, query: ListConversationsQueryDto) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      orderBy: [
        {
          lastMessageAt: {
            sort: 'desc',
            nulls: 'last',
          },
        },
        {
          createdAt: 'desc',
        },
      ],
      take: query.limit,
      select: {
        id: true,
        type: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
        members: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            createdAt: true,
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        messages: {
          orderBy: {
            sequence: 'desc',
          },
          take: 1,
          select: {
            id: true,
            senderId: true,
            senderDeviceId: true,
            createdAt: true,
            sequence: true,
          },
        },
      },
    });

    return {
      conversations: conversations.map((conversation) => {
        const latestMessage = conversation.messages[0] ?? null;

        return {
          id: conversation.id,
          type: conversation.type,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastMessageAt: conversation.lastMessageAt,
          members: conversation.members,
          lastMessage: latestMessage
            ? {
                ...latestMessage,
                sequence: latestMessage.sequence.toString(),
              }
            : null,
        };
      }),
    };
  }
}
