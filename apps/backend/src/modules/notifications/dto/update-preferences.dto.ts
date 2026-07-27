import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ALL_CATEGORIES } from '../notification-types';

export class PreferenceUpdateItem {
  @IsIn(ALL_CATEGORIES)
  category!: string;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;
}

// Body for PUT /notifications/preferences. Whitelisted; at most one entry per
// category is meaningful (extra entries just upsert in order).
export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreferenceUpdateItem)
  preferences!: PreferenceUpdateItem[];
}
