import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class SubscribeMarketDto {
  @IsString()
  @IsNotEmpty()
  marketId!: string;
}

export class UnsubscribeMarketDto {
  @IsString()
  @IsNotEmpty()
  marketId!: string;
}
