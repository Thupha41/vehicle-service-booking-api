import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

import { AppointmentsService } from './application/appointments.service';
import {
  AppointmentResponseDto,
  AvailabilityResponseDto,
  ErrorResponseDto,
} from './dto/appointment-response.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto';

@ApiTags('appointments')
@Controller('v1')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post('availability/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check current resource availability without reserving it',
  })
  @ApiOkResponse({
    description: 'Availability snapshot and server-calculated end time',
    type: AvailabilityResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or timestamp',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Unknown vehicle, dealership, or service type',
    type: ErrorResponseDto,
  })
  checkAvailability(@Body() request: CheckAvailabilityDto) {
    return this.appointmentsService.checkAvailability(request);
  }

  @Post('appointments')
  @ApiOperation({ summary: 'Atomically allocate resources and book an appointment' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    description: 'A client-generated UUID scoped to this booking request',
  })
  @ApiCreatedResponse({
    description: 'Appointment confirmed',
    type: AppointmentResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid body or Idempotency-Key',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Referenced record was not found',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Vehicle ownership mismatch or start time in the past',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Slot conflict, unavailable resource, or reused idempotency key',
    type: ErrorResponseDto,
    example: {
      statusCode: 409,
      error: {
        code: 'SLOT_CONFLICT',
        message: 'The requested slot is no longer available',
      },
      requestId: '11111111-1111-4111-8111-111111111111',
      timestamp: '2026-08-28T12:00:00.000Z',
      path: '/v1/appointments',
    },
  })
  book(@Body() request: BookAppointmentDto, @Req() httpRequest: Request) {
    const idempotencyKey = httpRequest.header('idempotency-key');
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be a UUID',
      });
    }
    return this.appointmentsService.book(request, idempotencyKey);
  }

  @Get('appointments/:id')
  @ApiOkResponse({ description: 'Appointment details', type: AppointmentResponseDto })
  @ApiNotFoundResponse({ description: 'Appointment not found', type: ErrorResponseDto })
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.appointmentsService.getById(id);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Appointment cancelled; repeat calls are idempotent',
    type: AppointmentResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Appointment not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Appointment cannot be cancelled from its current status',
    type: ErrorResponseDto,
  })
  cancel(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.appointmentsService.cancel(id);
  }
}
