import { HttpException, HttpStatus } from '@nestjs/common';

export class AppointmentError extends HttpException {
  constructor(status: HttpStatus, errorCode: string, message: string) {
    super({ statusCode: status, errorCode, message }, status);
  }
}

export const appointmentError = {
  notFound: () =>
    new AppointmentError(
      HttpStatus.NOT_FOUND,
      'APPOINTMENT_NOT_FOUND',
      'Appointment was not found',
    ),
  customerNotFound: () =>
    new AppointmentError(HttpStatus.NOT_FOUND, 'CUSTOMER_NOT_FOUND', 'Customer was not found'),
  vehicleNotFound: () =>
    new AppointmentError(HttpStatus.NOT_FOUND, 'VEHICLE_NOT_FOUND', 'Vehicle was not found'),
  dealershipNotFound: () =>
    new AppointmentError(HttpStatus.NOT_FOUND, 'DEALERSHIP_NOT_FOUND', 'Dealership was not found'),
  serviceTypeNotFound: () =>
    new AppointmentError(
      HttpStatus.NOT_FOUND,
      'SERVICE_TYPE_NOT_FOUND',
      'Service type was not found',
    ),
  vehicleCustomerMismatch: () =>
    new AppointmentError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VEHICLE_CUSTOMER_MISMATCH',
      'Vehicle does not belong to the customer',
    ),
  outsideBusinessHours: () =>
    new AppointmentError(
      HttpStatus.CONFLICT,
      'OUTSIDE_BUSINESS_HOURS',
      'Requested time is outside dealership business hours',
    ),
  slotConflict: () =>
    new AppointmentError(
      HttpStatus.CONFLICT,
      'SLOT_CONFLICT',
      'The requested slot is no longer available',
    ),
  noTechnician: () =>
    new AppointmentError(
      HttpStatus.CONFLICT,
      'NO_QUALIFIED_TECHNICIAN',
      'No qualified technician is available for the requested period',
    ),
  noBay: () =>
    new AppointmentError(
      HttpStatus.CONFLICT,
      'NO_COMPATIBLE_SERVICE_BAY',
      'No compatible service bay is available for the requested period',
    ),
  idempotencyReused: () =>
    new AppointmentError(
      HttpStatus.CONFLICT,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key has already been used with a different request',
    ),
  invalidTransition: () =>
    new AppointmentError(
      HttpStatus.CONFLICT,
      'INVALID_APPOINTMENT_TRANSITION',
      'Only a confirmed appointment can be cancelled',
    ),
  startsInPast: () =>
    new AppointmentError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'START_TIME_IN_PAST',
      'Appointment start time must be in the future',
    ),
};
