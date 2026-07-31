import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { MAXIMO_MASIVO } from '../inbox.service';

/**
 * Accion sobre varias conversaciones.
 *
 * `companyId` NO aparece y no puede aparecer: sale del token. Aceptarlo aqui
 * permitiria actuar sobre las conversaciones de otra empresa enviando un
 * campo de mas, que es exactamente el agujero que la lista blanca de DTOs
 * existe para cerrar.
 */
export class BulkConversationsDto {
  @IsArray()
  @ArrayNotEmpty()
  // El tope se valida tambien en el servicio: aqui para dar un error claro al
  // usuario, alli para que ninguna otra via se lo salte.
  @ArrayMaxSize(MAXIMO_MASIVO)
  @IsString({ each: true })
  conversationIds!: string[];

  @IsIn(['assign', 'unassign', 'status', 'read', 'unread'])
  type!: 'assign' | 'unassign' | 'status' | 'read' | 'unread';

  /** Obligatorio solo para `assign`. */
  @ValidateIf((o: BulkConversationsDto) => o.type === 'assign')
  @IsString()
  assignedTo?: string;

  /** Obligatorio solo para `status`. */
  @ValidateIf((o: BulkConversationsDto) => o.type === 'status')
  @IsIn(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'])
  status?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
