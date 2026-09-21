import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UploadDeviceKeyBundleDto } from './dto/upload-device-key-bundle.dto';
import { DevicesService } from './devices.service';
import { RefillOneTimePreKeysDto } from './dto/refill-one-time-prekeys.dto';

type AuthenticatedRequest = Request & {
  user: {
    sub: string;
  };
};

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateDeviceDto) {
    return this.devicesService.create(request.user.sub, dto);
  }

  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.devicesService.findAll(request.user.sub);
  }

  @Post(':deviceId/key-bundle')
  uploadKeyBundle(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Body() dto: UploadDeviceKeyBundleDto,
  ) {
    return this.devicesService.uploadKeyBundle(request.user.sub, deviceId, dto);
  }

  @Get(':deviceId/prekey-bundle')
  getPreKeyBundle(@Param('deviceId', new ParseUUIDPipe()) deviceId: string) {
    return this.devicesService.getPreKeyBundle(deviceId);
  }

  @Post(':deviceId/one-time-prekeys')
  refillOneTimePreKeys(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Body() dto: RefillOneTimePreKeysDto,
  ) {
    return this.devicesService.refillOneTimePreKeys(
      request.user.sub,
      deviceId,
      dto,
    );
  }
}
