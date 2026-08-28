import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly refreshTokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.displayName?.trim() || null;

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });

    try {
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          displayName,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A user with this email already exists');
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordIsValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );

    if (!passwordIsValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
    });

    const refreshSession = await this.createRefreshSession(user.id);

    return {
      accessToken,
      refreshToken: refreshSession.refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshTokenExpiresIn: 2_592_000,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return user;
  }

  async refresh(dto: RefreshTokenDto) {
    const sessionId = this.extractSessionId(dto.refreshToken);

    const session = await this.prisma.authSession.findUnique({
      where: {
        id: sessionId,
      },
    });

    if (
      !session ||
      !this.refreshTokensMatch(dto.refreshToken, session.refreshTokenHash)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const now = new Date();

    if (session.revokedAt) {
      await this.prisma.authSession.updateMany({
        where: {
          userId: session.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (session.expiresAt <= now) {
      await this.prisma.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      throw new UnauthorizedException('Refresh token expired');
    }

    const nextSessionId = randomUUID();
    const nextSecret = randomBytes(48).toString('base64url');

    const nextRefreshToken = `${nextSessionId}.${nextSecret}`;

    const nextRefreshTokenHash = this.hashRefreshToken(nextRefreshToken);

    const nextExpiresAt = new Date(Date.now() + this.refreshTokenLifetimeMs);

    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          replacedById: nextSessionId,
        },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedException('Refresh token has already been used');
      }

      await transaction.authSession.create({
        data: {
          id: nextSessionId,
          userId: session.userId,
          refreshTokenHash: nextRefreshTokenHash,
          expiresAt: nextExpiresAt,
        },
      });
    });

    const accessToken = await this.jwtService.signAsync({
      sub: session.userId,
    });

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshTokenExpiresIn: 2_592_000,
    };
  }

  private async createRefreshSession(userId: string) {
    const sessionId = randomUUID();
    const secret = randomBytes(48).toString('base64url');
    const refreshToken = `${sessionId}.${secret}`;

    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    const expiresAt = new Date(Date.now() + this.refreshTokenLifetimeMs);

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        expiresAt,
      },
    });

    return {
      refreshToken,
      expiresAt,
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private extractSessionId(refreshToken: string): string {
    const separatorPosition = refreshToken.indexOf('.');

    if (separatorPosition <= 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return refreshToken.slice(0, separatorPosition);
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    let sessionId: string;

    try {
      sessionId = this.extractSessionId(dto.refreshToken);
    } catch {
      return;
    }

    const refreshTokenHash = this.hashRefreshToken(dto.refreshToken);

    await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        refreshTokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private refreshTokensMatch(
    presentedToken: string,
    storedHash: string,
  ): boolean {
    const presentedHash = Buffer.from(
      this.hashRefreshToken(presentedToken),
      'hex',
    );

    const expectedHash = Buffer.from(storedHash, 'hex');

    return (
      presentedHash.length === expectedHash.length &&
      timingSafeEqual(presentedHash, expectedHash)
    );
  }
}
