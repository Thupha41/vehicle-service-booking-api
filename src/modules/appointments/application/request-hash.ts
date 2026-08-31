import { createHash } from 'node:crypto';
import { BookAppointmentDto } from '../dto/book-appointment.dto';

export function createBookingRequestHash(request: BookAppointmentDto): string {
  const canonicalRequest = {
    customerId: request.customerId,
    vehicleId: request.vehicleId,
    dealershipId: request.dealershipId,
    serviceTypeId: request.serviceTypeId,
    desiredStartAt: new Date(request.desiredStartAt).toISOString(),
  };

  return createHash('sha256').update(JSON.stringify(canonicalRequest)).digest('hex');
}
