import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ALL_CATEGORIES } from '../notification-types';

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

// Query params for GET /notifications. Whitelisted — unknown params are
// rejected. All optional.
export class ListNotificationsDto {
  @IsOptional()
  @IsBooleanString()
  unread?: string;

  @IsOptional()
  @IsIn(ALL_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
