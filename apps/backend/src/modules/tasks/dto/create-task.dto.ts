import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty({ message: 'El título de la tarea es requerido' })
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de vencimiento no es válida' })
  dueDate?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], { message: 'Prioridad no válida' })
  priority?: string;

  @IsOptional()
  @IsIn(['TASK', 'FOLLOW_UP', 'CALL', 'MEETING'], { message: 'Tipo no válido' })
  type?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  // Conversación de origen: permite crear la tarea desde el chat. El servicio
  // valida que pertenezca a la misma empresa.
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
