import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID, Matches } from 'class-validator';

const TIMESTAMP_WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

export class BookAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dealershipId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceTypeId!: string;

  @ApiProperty({ example: '2026-09-01T09:00:00+07:00' })
  @IsISO8601({ strict: true })
  @Matches(TIMESTAMP_WITH_OFFSET, {
    message: 'desiredStartAt must include an explicit UTC offset or Z',
  })
  desiredStartAt!: string;
}
