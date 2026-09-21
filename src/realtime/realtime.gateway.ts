import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';

import { PrismaService } from '../prisma/prisma.service';

interface AccessTokenPayload {
  sub: string;
  exp?: number;
}

export interface MessageAvailablePayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  sequence: string;
}

@WebSocketGateway({
  namespace: '/realtime',
  transports: ['websocket'],
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  private readonly expirationTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  @WebSocketServer()
  private namespace!: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth as Record<string, unknown>;

      const token = auth.token;
      const deviceId = auth.deviceId;

      if (typeof token !== 'string' || typeof deviceId !== 'string') {
        throw new Error('Missing socket authentication');
      }

      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);

      if (!payload.sub || !payload.exp) {
        throw new Error('Invalid access token');
      }

      const device = await this.prisma.device.findFirst({
        where: {
          id: deviceId,
          userId: payload.sub,
          revokedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!device) {
        throw new Error('Device does not belong to authenticated user');
      }

      const remainingLifetimeMs = payload.exp * 1000 - Date.now();

      if (remainingLifetimeMs <= 0) {
        throw new Error('Access token expired');
      }

      await client.join(this.deviceRoom(deviceId));

      const expirationTimer = setTimeout(() => {
        client.disconnect(true);
      }, remainingLifetimeMs);

      this.expirationTimers.set(client.id, expirationTimer);

      client.emit('connection.ready', {
        deviceId,
      });

      this.logger.log(`Device connected: ${deviceId}`);
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown connection error';

      this.logger.warn(`Rejected socket connection ${client.id}: ${reason}`);

      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const expirationTimer = this.expirationTimers.get(client.id);

    if (expirationTimer) {
      clearTimeout(expirationTimer);
      this.expirationTimers.delete(client.id);
    }
  }

  notifyMessageAvailable(
    deviceId: string,
    payload: MessageAvailablePayload,
  ): void {
    this.namespace
      .to(this.deviceRoom(deviceId))
      .emit('message.available', payload);
  }

  private deviceRoom(deviceId: string): string {
    return `device:${deviceId}`;
  }
}
