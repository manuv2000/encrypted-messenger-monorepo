import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsEnum,
  IsInt,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EncryptedEnvelopeType } from '@prisma/client';

export class CreateMessageEnvelopeDto {
  @IsUUID()
  recipientDeviceId!: string;

  @IsEnum(EncryptedEnvelopeType)
  envelopeType!: EncryptedEnvelopeType;

  @IsInt()
  @Min(1)
  @Max(1)
  protocolVersion!: number;

  @IsBase64()
  @MaxLength(100_000)
  ciphertext!: string;
}

export class CreateMessageDto {
  @IsUUID()
  senderDeviceId!: string;

  @IsUUID()
  clientMessageId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateMessageEnvelopeDto)
  envelopes!: CreateMessageEnvelopeDto[];
}