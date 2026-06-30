import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'], {
    message: 'Estado no válido',
  })
  status?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
