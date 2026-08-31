import { AppointmentStatus } from './appointment-status';

export type AvailabilityReason =
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'NO_QUALIFIED_TECHNICIAN'
  | 'NO_COMPATIBLE_SERVICE_BAY';

export interface AvailabilityResult {
  available: boolean;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  reason?: AvailabilityReason;
}

export interface AppointmentView {
  id: string;
  status: AppointmentStatus;
  customerId: string;
  vehicleId: string;
  dealershipId: string;
  serviceTypeId: string;
  technicianId: string;
  serviceBayId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}
