import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ChainType } from '../../users/user.entity';

export class VerifySignatureDto {
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  signature: string;

  @IsIn(['base', 'stellar'])
  chain: ChainType;

  @IsString()
  @IsOptional()
  referrerWallet?: string;
}
