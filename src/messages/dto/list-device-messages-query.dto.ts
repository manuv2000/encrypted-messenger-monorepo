import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListDeviceMessagesQueryDto {
  @IsOptional()
  @Matches(/^(0|[1-9]\d*)$/)
  @MaxLength(30)
  afterSequence: string = '0';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}