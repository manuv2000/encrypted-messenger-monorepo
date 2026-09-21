import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { PublicKeyDto } from './upload-device-key-bundle.dto';

export class RefillOneTimePreKeysDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PublicKeyDto)
  oneTimePreKeys!: PublicKeyDto[];
}
