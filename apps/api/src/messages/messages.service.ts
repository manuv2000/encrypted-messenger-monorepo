import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListDeviceMessagesQueryDto } from './dto/list-device-messages-query.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const storedMessageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  senderDeviceId: true,
  clientMessageId: true,
  createdAt: true,
  sequence: true,
  envelopes: {
    orderBy: {
      recipientDeviceId: 'asc',
    },
    select: {
      recipientDeviceId: true,
      envelopeType: true,
      protocolVersion: true,
      createdAt: true,
    },
  },
} satisfies Prisma.MessageSelect;

type StoredMessage = Prisma.MessageGetPayload<{
  select: typeof storedMessageSelect;
}>;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async create(userId: string, conversationId: string, dto: CreateMessageDto) {
    this.validateEnvelopes(dto);

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const membership = await transaction.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId,
              userId,
            },
          },
          select: {
            conversationId: true,
          },
        });

        if (!membership) {
          throw new NotFoundException('Conversation not found');
        }

        const senderDevice = await transaction.device.findFirst({
          where: {
            id: dto.senderDeviceId,
            userId,
            revokedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (!senderDevice) {
          throw new ForbiddenException('The sender device is unavailable');
        }

        const existingMessage = await transaction.message.findUnique({
          where: {
            senderDeviceId_clientMessageId: {
              senderDeviceId: dto.senderDeviceId,
              clientMessageId: dto.clientMessageId,
            },
          },
          select: storedMessageSelect,
        });

        /*
         * This is an idempotent retry, so we return the existing message
         * without producing another WebSocket notification.
         */
        if (existingMessage) {
          return {
            message: existingMessage,
            created: false,
          };
        }

        const recipientDeviceIds = dto.envelopes.map(
          (envelope) => envelope.recipientDeviceId,
        );

        const recipientDevices = await transaction.device.findMany({
          where: {
            id: {
              in: recipientDeviceIds,
            },
            revokedAt: null,
            user: {
              is: {
                conversations: {
                  some: {
                    conversationId,
                  },
                },
              },
            },
          },
          select: {
            id: true,
            userId: true,
          },
        });

        if (recipientDevices.length !== recipientDeviceIds.length) {
          throw new BadRequestException(
            'Every recipient device must be active and belong to a conversation member',
          );
        }

        const includesAnotherUser = recipientDevices.some(
          (device) => device.userId !== userId,
        );

        if (!includesAnotherUser) {
          throw new BadRequestException(
            'The message must include an envelope for another conversation member',
          );
        }

        const createdMessage = await transaction.message.create({
          data: {
            clientMessageId: dto.clientMessageId,

            conversation: {
              connect: {
                id: conversationId,
              },
            },

            sender: {
              connect: {
                id: userId,
              },
            },

            senderDevice: {
              connect: {
                id: dto.senderDeviceId,
              },
            },

            envelopes: {
              create: dto.envelopes.map((envelope) => ({
                envelopeType: envelope.envelopeType,
                protocolVersion: envelope.protocolVersion,
                ciphertext: envelope.ciphertext,

                recipientDevice: {
                  connect: {
                    id: envelope.recipientDeviceId,
                  },
                },
              })),
            },
          },
          select: storedMessageSelect,
        });

        await transaction.conversation.update({
          where: {
            id: conversationId,
          },
          data: {
            lastMessageAt: createdMessage.createdAt,
          },
        });

        return {
          message: createdMessage,
          created: true,
        };
      });

      /*
       * This runs after the transaction successfully commits.
       * Only metadata is sent through Socket.IO.
       */
      if (result.created) {
        for (const envelope of result.message.envelopes) {
          this.realtimeGateway.notifyMessageAvailable(
            envelope.recipientDeviceId,
            {
              messageId: result.message.id,
              conversationId: result.message.conversationId,
              senderId: result.message.senderId,
              sequence: result.message.sequence.toString(),
            },
          );
        }
      }

      return this.serializeMessage(result.message);
    } catch (error: unknown) {
      /*
       * Handles two identical requests arriving concurrently.
       * One creates the message; the other encounters the unique constraint
       * and returns the already-created message.
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingMessage = await this.prisma.message.findUnique({
          where: {
            senderDeviceId_clientMessageId: {
              senderDeviceId: dto.senderDeviceId,
              clientMessageId: dto.clientMessageId,
            },
          },
          select: storedMessageSelect,
        });

        if (existingMessage) {
          return this.serializeMessage(existingMessage);
        }
      }

      throw error;
    }
  }
  private validateEnvelopes(dto: CreateMessageDto): void {
    const recipientDeviceIds = dto.envelopes.map(
      (envelope) => envelope.recipientDeviceId,
    );

    if (new Set(recipientDeviceIds).size !== recipientDeviceIds.length) {
      throw new BadRequestException(
        'Recipient device identifiers must be unique',
      );
    }

    for (const [index, envelope] of dto.envelopes.entries()) {
      const decoded = Buffer.from(envelope.ciphertext, 'base64');

      if (
        decoded.length === 0 ||
        decoded.toString('base64') !== envelope.ciphertext
      ) {
        throw new BadRequestException(
          `envelopes[${index}].ciphertext must use canonical Base64`,
        );
      }
    }
  }

  private serializeMessage(message: StoredMessage) {
    return {
      ...message,
      sequence: message.sequence.toString(),
    };
  }

  async listForDevice(
    userId: string,
    deviceId: string,
    query: ListDeviceMessagesQueryDto,
  ) {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        userId,
        revokedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!device) {
      throw new NotFoundException('Active device not found');
    }

    const afterSequence = BigInt(query.afterSequence);

    const messages = await this.prisma.message.findMany({
      where: {
        sequence: {
          gt: afterSequence,
        },
        envelopes: {
          some: {
            recipientDeviceId: deviceId,
          },
        },
      },
      orderBy: {
        sequence: 'asc',
      },
      take: query.limit,
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        senderDeviceId: true,
        createdAt: true,
        sequence: true,
        envelopes: {
          where: {
            recipientDeviceId: deviceId,
          },
          take: 1,
          select: {
            envelopeType: true,
            protocolVersion: true,
            ciphertext: true,
            createdAt: true,
            deliveredAt: true,
          },
        },
      },
    });

    const serializedMessages = messages.map((message) => {
      const envelope = message.envelopes[0];

      if (!envelope) {
        throw new InternalServerErrorException('Message envelope is missing');
      }

      return {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderDeviceId: message.senderDeviceId,
        createdAt: message.createdAt,
        sequence: message.sequence.toString(),
        envelope,
      };
    });

    const nextAfterSequence =
      serializedMessages.length > 0
        ? serializedMessages[serializedMessages.length - 1].sequence
        : query.afterSequence;

    return {
      deviceId,
      messages: serializedMessages,
      nextAfterSequence,
    };
  }

  async acknowledgeDelivery(
    userId: string,
    deviceId: string,
    messageId: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const device = await transaction.device.findFirst({
        where: {
          id: deviceId,
          userId,
          revokedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!device) {
        throw new NotFoundException('Active device not found');
      }

      const envelope = await transaction.messageEnvelope.findUnique({
        where: {
          messageId_recipientDeviceId: {
            messageId,
            recipientDeviceId: deviceId,
          },
        },
        select: {
          deliveredAt: true,
        },
      });

      if (!envelope) {
        throw new NotFoundException(
          'Message envelope not found for this device',
        );
      }

      /*
       * An acknowledgement can safely be repeated.
       * Preserve the original delivery timestamp.
       */
      if (envelope.deliveredAt) {
        return {
          messageId,
          deviceId,
          deliveredAt: envelope.deliveredAt,
        };
      }

      const deliveredAt = new Date();

      const updated = await transaction.messageEnvelope.updateMany({
        where: {
          messageId,
          recipientDeviceId: deviceId,
          deliveredAt: null,
        },
        data: {
          deliveredAt,
        },
      });

      if (updated.count === 1) {
        return {
          messageId,
          deviceId,
          deliveredAt,
        };
      }

      /*
       * Another concurrent acknowledgement may have updated it
       * between our initial read and update.
       */
      const concurrentlyUpdated = await transaction.messageEnvelope.findUnique({
        where: {
          messageId_recipientDeviceId: {
            messageId,
            recipientDeviceId: deviceId,
          },
        },
        select: {
          deliveredAt: true,
        },
      });

      if (!concurrentlyUpdated?.deliveredAt) {
        throw new InternalServerErrorException(
          'Unable to acknowledge message delivery',
        );
      }

      return {
        messageId,
        deviceId,
        deliveredAt: concurrentlyUpdated.deliveredAt,
      };
    });
  }
}
