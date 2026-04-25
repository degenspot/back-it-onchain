import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CallsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['base', 'stellar'])
  chain?: 'base' | 'stellar';
}
