import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

import { ReferenceDataRepository } from '../../reference-data/repositories/reference-data.repository';
import { ResourceAllocationRepository } from '../../resources/repositories/resource-allocation.repository';
import { VehicleRepository } from '../../vehicles/repositories/vehicle.repository';
import {
  BookingResourceUnavailableReason,
  BookingTransactionOutcome,
  MetricsService,
} from '../../../shared/observability/metrics.service';
import { AppointmentStatus } from '../domain/appointment-status';
import { AppointmentView, AvailabilityResult } from '../domain/appointment.types';
import { BookAppointmentDto } from '../dto/book-appointment.dto';
import { CheckAvailabilityDto } from '../dto/check-availability.dto';
import { appointmentError } from './appointment-errors';
import { isWithinBusinessHours } from './business-hours';
import { createBookingRequestHash } from './request-hash';

interface Queryable {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
}

interface SchedulingContext {
  dealershipId: string;
  timezone: string;
  durationMinutes: number;
  opensAt: string | null;
  closesAt: string | null;
}

interface AppointmentRow {
  id: string;
  status: AppointmentStatus;
  customer_id: string;
  vehicle_id: string;
  dealership_id: string;
  service_type_id: string;
  technician_id: string;
  service_bay_id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  idempotency_request_hash?: string;
}

interface PgError {
  code?: string;
  constraint?: string;
}

const EXCLUSION_CONSTRAINTS = new Set([
  'appointments_technician_no_overlap',
  'appointments_service_bay_no_overlap',
]);

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly referenceData: ReferenceDataRepository,
    private readonly vehicles: VehicleRepository,
    private readonly resources: ResourceAllocationRepository,
    private readonly metrics: MetricsService,
  ) {}

  checkAvailability(request: CheckAvailabilityDto): Promise<AvailabilityResult> {
    return this.metrics.withSchedulingSpan('availability.check', async () => {
      const stopTimer = this.metrics.startAvailabilityCheckTimer();
      try {
        const result = await this.checkAvailabilityCore(request);
        stopTimer(result.available ? 'available' : 'unavailable');
        return result;
      } catch (error) {
        stopTimer('error');
        throw error;
      }
    });
  }

  async book(request: BookAppointmentDto, idempotencyKey: string): Promise<AppointmentView> {
    this.metrics.recordBookingAttempt();
    return this.metrics.withSchedulingSpan('appointment.book', async () => {
      const stopTimer = this.metrics.startBookingTransactionTimer();
      let outcome: BookingTransactionOutcome = 'error';
      try {
        return await this.metrics.withSchedulingSpan('appointment.book.transaction', async () => {
          const result = await this.bookInTransaction(request, idempotencyKey, (nextOutcome) => {
            outcome = nextOutcome;
          });
          return result;
        });
      } finally {
        stopTimer(outcome);
      }
    });
  }

  async getById(id: string): Promise<AppointmentView> {
    const rows = await this.dataSource.query<AppointmentRow[]>(
      'SELECT * FROM appointments WHERE id = $1',
      [id],
    );
    if (!rows[0]) {
      throw appointmentError.notFound();
    }
    return this.toView(rows[0]);
  }

  async cancel(id: string): Promise<AppointmentView> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
    try {
      const rows = (await runner.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [
        id,
      ])) as AppointmentRow[];
      const appointment = rows[0];
      if (!appointment) {
        throw appointmentError.notFound();
      }
      if (appointment.status === AppointmentStatus.Cancelled) {
        await runner.commitTransaction();
        return this.toView(appointment);
      }
      if (appointment.status !== AppointmentStatus.Confirmed) {
        throw appointmentError.invalidTransition();
      }

      await runner.query(
        `UPDATE appointments
         SET status = 'CANCELLED', updated_at = now()
         WHERE id = $1`,
        [id],
      );
      const updated = (await runner.query('SELECT * FROM appointments WHERE id = $1', [
        id,
      ])) as AppointmentRow[];
      await runner.commitTransaction();
      return this.toView(updated[0]);
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async checkAvailabilityCore(request: CheckAvailabilityDto): Promise<AvailabilityResult> {
    const manager = this.dataSource.manager;
    await this.assertVehicleExists(manager, request.vehicleId);
    const startsAt = new Date(request.desiredStartAt);
    const context = await this.loadSchedulingContext(
      manager,
      request.dealershipId,
      request.serviceTypeId,
      startsAt,
    );
    const endsAt = this.calculateEnd(startsAt, context.durationMinutes);
    this.assertStartsInFuture(startsAt);
    const base = this.availabilityResponse(startsAt, endsAt, context.durationMinutes);

    if (!isWithinBusinessHours(startsAt, endsAt, context)) {
      return { ...base, available: false, reason: 'OUTSIDE_BUSINESS_HOURS' };
    }

    const available = await this.resources.findAvailableResourceIds(manager, {
      dealershipId: request.dealershipId,
      serviceTypeId: request.serviceTypeId,
      startsAt,
      endsAt,
    });
    if (available.technicianIds.length === 0) {
      return {
        ...base,
        available: false,
        reason: 'NO_QUALIFIED_TECHNICIAN',
      };
    }
    if (available.serviceBayIds.length === 0) {
      return {
        ...base,
        available: false,
        reason: 'NO_COMPATIBLE_SERVICE_BAY',
      };
    }
    return { ...base, available: true };
  }

  private async bookInTransaction(
    request: BookAppointmentDto,
    idempotencyKey: string,
    setOutcome: (outcome: BookingTransactionOutcome) => void,
  ): Promise<AppointmentView> {
    const requestHash = createBookingRequestHash(request);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');

    try {
      await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [idempotencyKey]);
      const replay = await this.findByIdempotencyKey(runner, idempotencyKey);
      if (replay) {
        if (replay.idempotency_request_hash !== requestHash) {
          setOutcome('conflict');
          this.metrics.recordBookingConflict('idempotency_key_reused');
          throw appointmentError.idempotencyReused();
        }
        await runner.commitTransaction();
        setOutcome('idempotent_replay');
        return this.toView(replay);
      }

      await this.assertCustomerExists(runner.manager, request.customerId);
      const vehicle = await this.vehicles.findById(runner.manager, request.vehicleId);
      if (!vehicle) {
        throw appointmentError.vehicleNotFound();
      }
      if (vehicle.customerId !== request.customerId) {
        throw appointmentError.vehicleCustomerMismatch();
      }

      const startsAt = new Date(request.desiredStartAt);
      const context = await this.loadSchedulingContext(
        runner.manager,
        request.dealershipId,
        request.serviceTypeId,
        startsAt,
      );
      const endsAt = this.calculateEnd(startsAt, context.durationMinutes);
      this.assertStartsInFuture(startsAt);
      if (!isWithinBusinessHours(startsAt, endsAt, context)) {
        this.recordUnavailable('outside_business_hours', setOutcome);
        throw appointmentError.outsideBusinessHours();
      }

      const search = {
        dealershipId: request.dealershipId,
        serviceTypeId: request.serviceTypeId,
        startsAt,
        endsAt,
      };
      const technicianId = await this.resources.findAndLockAvailableTechnician(
        runner.manager,
        search,
      );
      if (!technicianId) {
        this.recordUnavailable('no_qualified_technician', setOutcome);
        throw appointmentError.noTechnician();
      }

      const serviceBayId = await this.resources.findAndLockAvailableServiceBay(
        runner.manager,
        search,
      );
      if (!serviceBayId) {
        this.recordUnavailable('no_compatible_service_bay', setOutcome);
        throw appointmentError.noBay();
      }

      const inserted = (await runner.query(
        `INSERT INTO appointments (
          id, idempotency_key, idempotency_request_hash, customer_id, vehicle_id,
          dealership_id, service_type_id, technician_id, service_bay_id,
          starts_at, ends_at, service_duration_minutes, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'CONFIRMED')
        RETURNING *`,
        [
          randomUUID(),
          idempotencyKey,
          requestHash,
          request.customerId,
          request.vehicleId,
          request.dealershipId,
          request.serviceTypeId,
          technicianId,
          serviceBayId,
          startsAt,
          endsAt,
          context.durationMinutes,
        ],
      )) as AppointmentRow[];
      await runner.commitTransaction();
      setOutcome('confirmed');
      this.metrics.recordBookingConfirmed();
      return this.toView(inserted[0]);
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      if (this.isSlotExclusionError(error)) {
        setOutcome('conflict');
        this.metrics.recordBookingConflict('slot_conflict');
        throw appointmentError.slotConflict();
      }
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async loadSchedulingContext(
    manager: EntityManager,
    dealershipId: string,
    serviceTypeId: string,
    startsAt: Date,
  ): Promise<SchedulingContext> {
    const dealership = await this.referenceData.findActiveDealershipById(manager, dealershipId);
    if (!dealership) {
      throw appointmentError.dealershipNotFound();
    }
    const service = await this.referenceData.findActiveServiceTypeById(manager, serviceTypeId);
    if (!service) {
      throw appointmentError.serviceTypeNotFound();
    }

    const weekday = DateTime.fromJSDate(startsAt, { zone: 'utc' }).setZone(
      dealership.timezone,
    ).weekday;
    const businessHours = await this.referenceData.findBusinessHours(
      manager,
      dealershipId,
      weekday,
    );
    return {
      dealershipId,
      timezone: dealership.timezone,
      durationMinutes: service.durationMinutes,
      opensAt: businessHours?.opensAt ?? null,
      closesAt: businessHours?.closesAt ?? null,
    };
  }

  private async findByIdempotencyKey(
    queryable: Queryable,
    key: string,
  ): Promise<AppointmentRow | null> {
    const rows = await queryable.query<AppointmentRow[]>(
      'SELECT * FROM appointments WHERE idempotency_key = $1',
      [key],
    );
    return rows[0] ?? null;
  }

  private async assertCustomerExists(manager: EntityManager, customerId: string): Promise<void> {
    if (!(await this.referenceData.findCustomerById(manager, customerId))) {
      throw appointmentError.customerNotFound();
    }
  }

  private async assertVehicleExists(manager: EntityManager, vehicleId: string): Promise<void> {
    if (!(await this.vehicles.findById(manager, vehicleId))) {
      throw appointmentError.vehicleNotFound();
    }
  }

  private recordUnavailable(
    reason: BookingResourceUnavailableReason,
    setOutcome: (outcome: BookingTransactionOutcome) => void,
  ): void {
    setOutcome('resource_unavailable');
    this.metrics.recordBookingResourceUnavailable(reason);
  }

  private assertStartsInFuture(startsAt: Date): void {
    if (startsAt.getTime() <= Date.now()) {
      throw appointmentError.startsInPast();
    }
  }

  private calculateEnd(startsAt: Date, durationMinutes: number): Date {
    return new Date(startsAt.getTime() + durationMinutes * 60_000);
  }

  private availabilityResponse(
    startsAt: Date,
    endsAt: Date,
    durationMinutes: number,
  ): Omit<AvailabilityResult, 'available'> {
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      durationMinutes,
    };
  }

  private isSlotExclusionError(error: unknown): boolean {
    const pgError = error as PgError;
    return (
      pgError?.code === '23P01' &&
      typeof pgError.constraint === 'string' &&
      EXCLUSION_CONSTRAINTS.has(pgError.constraint)
    );
  }

  private toView(row: AppointmentRow): AppointmentView {
    return {
      id: row.id,
      status: row.status,
      customerId: row.customer_id,
      vehicleId: row.vehicle_id,
      dealershipId: row.dealership_id,
      serviceTypeId: row.service_type_id,
      technicianId: row.technician_id,
      serviceBayId: row.service_bay_id,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
