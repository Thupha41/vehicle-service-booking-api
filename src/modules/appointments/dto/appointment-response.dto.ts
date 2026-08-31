import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AppointmentStatus } from '../domain/appointment-status';
import { AvailabilityReason } from '../domain/appointment.types';

export class AvailabilityResponseDto {
  @ApiProperty({ example: true })
  available!: boolean;

  @ApiProperty({ example: '2030-06-03T08:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ example: '2030-06-03T09:00:00.000Z' })
  endsAt!: string;

  @ApiProperty({ example: 60 })
  durationMinutes!: number;

  @ApiPropertyOptional({
    enum: ['OUTSIDE_BUSINESS_HOURS', 'NO_QUALIFIED_TECHNICIAN', 'NO_COMPATIBLE_SERVICE_BAY'],
    example: 'NO_QUALIFIED_TECHNICIAN',
  })
  reason?: AvailabilityReason;
}

export class AppointmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: AppointmentStatus, example: AppointmentStatus.Confirmed })
  status!: AppointmentStatus;

  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId!: string;

  @ApiProperty({ format: 'uuid' })
  dealershipId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceTypeId!: string;

  @ApiProperty({ format: 'uuid' })
  technicianId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceBayId!: string;

  @ApiProperty({ example: '2030-06-03T08:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ example: '2030-06-03T09:00:00.000Z' })
  endsAt!: string;

  @ApiProperty({ example: '2026-08-28T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-28T12:00:00.000Z' })
  updatedAt!: string;
}

export class ErrorDetailsDto {
  @ApiProperty({ example: 'SLOT_CONFLICT' })
  code!: string;

  @ApiProperty({ example: 'The requested slot is no longer available' })
  message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, unknown>;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ type: ErrorDetailsDto })
  error!: ErrorDetailsDto;

  @ApiProperty({ format: 'uuid' })
  requestId!: string;

  @ApiPropertyOptional({ example: '4bf92f3577b34da6a3ce929d0e0e4736' })
  traceId?: string;

  @ApiProperty({ example: '2026-08-28T12:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/v1/appointments' })
  path!: string;
}
