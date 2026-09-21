import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsDateString,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';

export class PublicKeyDto {
  @IsInt()
  @Min(0)
  keyId!: number;

  @IsBase64()
  publicKey!: string;
}

export class SignedPreKeyDto extends PublicKeyDto {
  @IsBase64()
  signature!: string;

  @IsDateString()
  expiresAt!: string;
}

export class UploadDeviceKeyBundleDto {
  @ValidateNested()
  @Type(() => PublicKeyDto)
  identitySigningKey!: PublicKeyDto;

  @ValidateNested()
  @Type(() => PublicKeyDto)
  identityDhKey!: PublicKeyDto;

  @ValidateNested()
  @Type(() => SignedPreKeyDto)
  signedPreKey!: SignedPreKeyDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PublicKeyDto)
  oneTimePreKeys!: PublicKeyDto[];
}
