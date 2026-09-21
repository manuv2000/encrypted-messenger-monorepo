import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceKeyType, KeyAlgorithm, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UploadDeviceKeyBundleDto } from './dto/upload-device-key-bundle.dto';
import { RefillOneTimePreKeysDto } from './dto/refill-one-time-prekeys.dto';
import { PublicKeyDto } from './dto/upload-device-key-bundle.dto';

type ConsumedOneTimePreKeyRow = {
  keyId: number;
  publicKey: string;
};

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateDeviceDto) {
    return this.prisma.device.create({
      data: {
        userId,
        name: dto.name.trim(),
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.device.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
  }

  async uploadKeyBundle(
    userId: string,
    deviceId: string,
    dto: UploadDeviceKeyBundleDto,
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

    this.validateKeyBundle(dto);

    const signedPreKeyExpiresAt = new Date(dto.signedPreKey.expiresAt);

    const keyRows: Prisma.DeviceKeyCreateManyInput[] = [
      {
        deviceId,
        type: DeviceKeyType.IDENTITY_SIGNING,
        algorithm: KeyAlgorithm.ED25519,
        keyId: dto.identitySigningKey.keyId,
        publicKey: dto.identitySigningKey.publicKey,
      },
      {
        deviceId,
        type: DeviceKeyType.IDENTITY_DH,
        algorithm: KeyAlgorithm.X25519,
        keyId: dto.identityDhKey.keyId,
        publicKey: dto.identityDhKey.publicKey,
      },
      {
        deviceId,
        type: DeviceKeyType.SIGNED_PREKEY,
        algorithm: KeyAlgorithm.X25519,
        keyId: dto.signedPreKey.keyId,
        publicKey: dto.signedPreKey.publicKey,
        signature: dto.signedPreKey.signature,
        expiresAt: signedPreKeyExpiresAt,
      },
      ...dto.oneTimePreKeys.map(
        (key): Prisma.DeviceKeyCreateManyInput => ({
          deviceId,
          type: DeviceKeyType.ONE_TIME_PREKEY,
          algorithm: KeyAlgorithm.X25519,
          keyId: key.keyId,
          publicKey: key.publicKey,
        }),
      ),
    ];

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existingKeyCount = await transaction.deviceKey.count({
          where: {
            deviceId,
            revokedAt: null,
          },
        });

        if (existingKeyCount > 0) {
          throw new ConflictException(
            'This device already has an active key bundle',
          );
        }

        await transaction.deviceKey.createMany({
          data: keyRows,
        });

        await transaction.device.update({
          where: {
            id: deviceId,
          },
          data: {
            lastSeenAt: new Date(),
          },
        });

        return {
          deviceId,
          uploaded: {
            identityKeys: 2,
            signedPreKeys: 1,
            oneTimePreKeys: dto.oneTimePreKeys.length,
            total: keyRows.length,
          },
        };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'The key bundle contains an existing key identifier',
        );
      }

      throw error;
    }
  }

  private validateKeyBundle(dto: UploadDeviceKeyBundleDto): void {
    this.assertCanonicalBase64Length(
      dto.identitySigningKey.publicKey,
      32,
      'identitySigningKey.publicKey',
    );

    this.assertCanonicalBase64Length(
      dto.identityDhKey.publicKey,
      32,
      'identityDhKey.publicKey',
    );

    this.assertCanonicalBase64Length(
      dto.signedPreKey.publicKey,
      32,
      'signedPreKey.publicKey',
    );

    this.assertCanonicalBase64Length(
      dto.signedPreKey.signature,
      64,
      'signedPreKey.signature',
    );

    this.validateOneTimePreKeys(dto.oneTimePreKeys);

    const expiresAt = new Date(dto.signedPreKey.expiresAt);

    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'The signed pre-key expiration must be in the future',
      );
    }
  }

  private assertCanonicalBase64Length(
    value: string,
    expectedBytes: number,
    fieldName: string,
  ): void {
    const decoded = Buffer.from(value, 'base64');

    if (
      decoded.length !== expectedBytes ||
      decoded.toString('base64') !== value
    ) {
      throw new BadRequestException(
        `${fieldName} must be canonical Base64 encoding of exactly ${expectedBytes} bytes`,
      );
    }
  }

  async getPreKeyBundle(deviceId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const device = await transaction.device.findFirst({
        where: {
          id: deviceId,
          revokedAt: null,
        },
        select: {
          id: true,
          userId: true,
        },
      });

      if (!device) {
        throw new NotFoundException('Active device not found');
      }

      const identitySigningKey = await transaction.deviceKey.findFirst({
        where: {
          deviceId,
          type: DeviceKeyType.IDENTITY_SIGNING,
          revokedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          keyId: true,
          algorithm: true,
          publicKey: true,
        },
      });

      const identityDhKey = await transaction.deviceKey.findFirst({
        where: {
          deviceId,
          type: DeviceKeyType.IDENTITY_DH,
          revokedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          keyId: true,
          algorithm: true,
          publicKey: true,
        },
      });

      const signedPreKey = await transaction.deviceKey.findFirst({
        where: {
          deviceId,
          type: DeviceKeyType.SIGNED_PREKEY,
          revokedAt: null,
          expiresAt: {
            gt: new Date(),
          },
          signature: {
            not: null,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          keyId: true,
          algorithm: true,
          publicKey: true,
          signature: true,
          expiresAt: true,
        },
      });

      if (
        !identitySigningKey ||
        !identityDhKey ||
        !signedPreKey ||
        !signedPreKey.signature ||
        !signedPreKey.expiresAt
      ) {
        throw new NotFoundException(
          'The device does not have a valid key bundle',
        );
      }

      const consumedOneTimePreKeys = await transaction.$queryRaw<
        ConsumedOneTimePreKeyRow[]
      >`
        WITH selected_key AS (
          SELECT "id"
          FROM "DeviceKey"
          WHERE "deviceId" = ${deviceId}
            AND "type" = 'ONE_TIME_PREKEY'
            AND "consumedAt" IS NULL
            AND "revokedAt" IS NULL
            AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
          ORDER BY "createdAt" ASC, "keyId" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "DeviceKey" AS device_key
        SET "consumedAt" = CURRENT_TIMESTAMP
        FROM selected_key
        WHERE device_key."id" = selected_key."id"
        RETURNING
          device_key."keyId",
          device_key."publicKey"
      `;

      const consumedOneTimePreKey = consumedOneTimePreKeys[0] ?? null;

      return {
        userId: device.userId,
        deviceId: device.id,
        identitySigningKey,
        identityDhKey,
        signedPreKey: {
          keyId: signedPreKey.keyId,
          algorithm: signedPreKey.algorithm,
          publicKey: signedPreKey.publicKey,
          signature: signedPreKey.signature,
          expiresAt: signedPreKey.expiresAt,
        },
        oneTimePreKey: consumedOneTimePreKey
          ? {
              keyId: consumedOneTimePreKey.keyId,
              algorithm: KeyAlgorithm.X25519,
              publicKey: consumedOneTimePreKey.publicKey,
            }
          : null,
      };
    });
  }

  async refillOneTimePreKeys(
    userId: string,
    deviceId: string,
    dto: RefillOneTimePreKeysDto,
  ) {
    this.validateOneTimePreKeys(dto.oneTimePreKeys);

    const keyRows: Prisma.DeviceKeyCreateManyInput[] = dto.oneTimePreKeys.map(
      (key) => ({
        deviceId,
        type: DeviceKeyType.ONE_TIME_PREKEY,
        algorithm: KeyAlgorithm.X25519,
        keyId: key.keyId,
        publicKey: key.publicKey,
      }),
    );

    try {
      return await this.prisma.$transaction(async (transaction) => {
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

        const activeBundleKeys = await transaction.deviceKey.findMany({
          where: {
            deviceId,
            revokedAt: null,
            type: {
              in: [
                DeviceKeyType.IDENTITY_SIGNING,
                DeviceKeyType.IDENTITY_DH,
                DeviceKeyType.SIGNED_PREKEY,
              ],
            },
          },
          select: {
            type: true,
          },
        });

        const activeTypes = new Set(activeBundleKeys.map((key) => key.type));

        const hasCompleteBundle =
          activeTypes.has(DeviceKeyType.IDENTITY_SIGNING) &&
          activeTypes.has(DeviceKeyType.IDENTITY_DH) &&
          activeTypes.has(DeviceKeyType.SIGNED_PREKEY);

        if (!hasCompleteBundle) {
          throw new ConflictException(
            'The device must upload its initial key bundle first',
          );
        }

        await transaction.deviceKey.createMany({
          data: keyRows,
        });

        const availableOneTimePreKeys = await transaction.deviceKey.count({
          where: {
            deviceId,
            type: DeviceKeyType.ONE_TIME_PREKEY,
            consumedAt: null,
            revokedAt: null,
          },
        });

        return {
          deviceId,
          uploaded: dto.oneTimePreKeys.length,
          availableOneTimePreKeys,
        };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'One or more key identifiers have already been used by this device',
        );
      }

      throw error;
    }
  }

  private validateOneTimePreKeys(keys: PublicKeyDto[]): void {
    for (const [index, key] of keys.entries()) {
      this.assertCanonicalBase64Length(
        key.publicKey,
        32,
        `oneTimePreKeys[${index}].publicKey`,
      );
    }

    const keyIds = keys.map((key) => key.keyId);

    if (new Set(keyIds).size !== keyIds.length) {
      throw new BadRequestException(
        'One-time pre-key identifiers must be unique',
      );
    }

    const publicKeys = keys.map((key) => key.publicKey);

    if (new Set(publicKeys).size !== publicKeys.length) {
      throw new BadRequestException(
        'One-time pre-keys must contain unique public keys',
      );
    }
  }

  async findActiveRecipientDevices(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();

    const devices = await this.prisma.device.findMany({
      where: {
        userId,
        revokedAt: null,
        AND: [
          {
            keys: {
              some: {
                type: DeviceKeyType.IDENTITY_SIGNING,
                revokedAt: null,
              },
            },
          },
          {
            keys: {
              some: {
                type: DeviceKeyType.IDENTITY_DH,
                revokedAt: null,
              },
            },
          },
          {
            keys: {
              some: {
                type: DeviceKeyType.SIGNED_PREKEY,
                revokedAt: null,
                signature: {
                  not: null,
                },
                expiresAt: {
                  gt: now,
                },
              },
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
    });

    return {
      userId,
      devices,
    };
  }
}
