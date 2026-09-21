import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DevicesService } from './devices.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserDevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get(':userId/devices')
  findActiveRecipientDevices(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.devicesService.findActiveRecipientDevices(userId);
  }
}
