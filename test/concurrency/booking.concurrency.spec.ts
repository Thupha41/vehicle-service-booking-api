import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import * as request from 'supertest';
import type { DataSource } from 'typeorm';

import { SEED_IDS } from '../../src/shared/database/seed';
import { createApiTestApp } from '../helpers/api-test-app';
import {
  cleanupTestDealership,
  cleanupTestActor,
  countOverlappingActiveAppointments,
  createPostgresTestDataSource,
  createTestDealership,
  createTestActor,
  futureLondonBusinessStart,
  resetAppointments,
  type BookingPayload,
  type TestDealership,
  type TestActor,
} from '../helpers/postgres-test-database';

interface AppointmentResponse {
  id: string;
  technicianId: string;
  serviceBayId: string;
  dealershipId: string;
  status: string;
}

interface ErrorResponse {
  error?: { code?: string };
}

describe('atomic booking concurrency', () => {
  let dataSource: DataSource;
  let app: INestApplication;
  let actor: TestActor;
  let secondDealership: TestDealership;
  const secondStandardBayId = randomUUID();

  beforeAll(async () => {
    dataSource = await createPostgresTestDataSource();
    actor = await createTestActor(dataSource, 'booking concurrency');
    secondDealership = await createTestDealership(dataSource, 'concurrent independence');
    await dataSource.query(
      `INSERT INTO service_bays (id, dealership_id, name, bay_type, active)
       VALUES ($1, $2, $3, 'STANDARD', true)`,
      [secondStandardBayId, SEED_IDS.dealership, `Concurrent Bay ${secondStandardBayId}`],
    );
    app = await createApiTestApp();
  });

  beforeEach(async () => {
    await resetAppointments(dataSource);
    await setResourceMatrix(true, true);
  });

  afterEach(async () => {
    await resetAppointments(dataSource);
    await setResourceMatrix(true, true);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (dataSource?.isInitialized) {
      await resetAppointments(dataSource);
      await dataSource.query('DELETE FROM service_bays WHERE id = $1', [secondStandardBayId]);
      if (secondDealership) {
        await cleanupTestDealership(dataSource, secondDealership);
      }
      if (actor) {
        await cleanupTestActor(dataSource, actor);
      }
      await dataSource.destroy();
    }
  });

  async function setResourceMatrix(
    secondTechnicianActive: boolean,
    secondBayActive: boolean,
  ): Promise<void> {
    await dataSource.query(
      `UPDATE technicians SET active = CASE WHEN id = $1 THEN $2 ELSE true END
       WHERE id IN ($1, $3)`,
      [SEED_IDS.technicians.jordan, secondTechnicianActive, SEED_IDS.technicians.alex],
    );
    await dataSource.query('UPDATE service_bays SET active = $2 WHERE id = $1', [
      secondStandardBayId,
      secondBayActive,
    ]);
  }

  function payload(dayOffset: number): BookingPayload {
    const desiredStartAt = futureLondonBusinessStart(dayOffset).toISO();
    if (!desiredStartAt) {
      throw new Error('Unable to construct an ISO timestamp for the concurrency test');
    }
    return {
      customerId: actor.customerId,
      vehicleId: actor.vehicleId,
      dealershipId: SEED_IDS.dealership,
      serviceTypeId: SEED_IDS.serviceTypes.oilChange,
      desiredStartAt,
    };
  }

  function concurrentBookings(
    bookingPayload: BookingPayload,
    keys: string[],
  ): Promise<request.Response[]> {
    const server = app.getHttpAdapter().getInstance() as Express;
    return Promise.all(
      keys.map((key) =>
        request(server).post('/v1/appointments').set('Idempotency-Key', key).send(bookingPayload),
      ),
    );
  }

  async function expectNoDatabaseOverlap(expectedCount: number): Promise<void> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count
       FROM appointments
       WHERE customer_id = $1 AND status IN ('CONFIRMED', 'IN_PROGRESS')`,
      [actor.customerId],
    );
    expect(rows[0]?.count).toBe(expectedCount);
    await expect(countOverlappingActiveAppointments(dataSource, actor.customerId)).resolves.toBe(0);
  }

  it('admits exactly one booking with a 1-technician/1-bay matrix', async () => {
    await setResourceMatrix(false, false);

    const responses = await concurrentBookings(
      payload(7),
      Array.from({ length: 20 }, () => randomUUID()),
    );
    const successes = responses.filter(({ status }) => status === 201);
    const conflicts = responses.filter(({ status }) => status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(19);
    expect(
      conflicts.every(({ body }) => {
        const error = body as ErrorResponse;
        return ['NO_QUALIFIED_TECHNICIAN', 'NO_COMPATIBLE_SERVICE_BAY', 'SLOT_CONFLICT'].includes(
          error.error?.code ?? '',
        );
      }),
    ).toBe(true);
    await expectNoDatabaseOverlap(1);
  });

  it('admits exactly one booking with a 2-technician/1-bay matrix', async () => {
    await setResourceMatrix(true, false);

    const responses = await concurrentBookings(
      payload(8),
      Array.from({ length: 5 }, () => randomUUID()),
    );
    const successes = responses.filter(({ status }) => status === 201);
    const conflicts = responses.filter(({ status }) => status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    await expectNoDatabaseOverlap(1);
  });

  it('admits exactly one booking with a 1-technician/2-bay matrix', async () => {
    await setResourceMatrix(false, true);

    const responses = await concurrentBookings(
      payload(8),
      Array.from({ length: 5 }, () => randomUUID()),
    );
    const successes = responses.filter(({ status }) => status === 201);
    const conflicts = responses.filter(({ status }) => status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    await expectNoDatabaseOverlap(1);
  });

  it('admits exactly two bookings with a 2-technician/2-bay matrix', async () => {
    await setResourceMatrix(true, true);

    const responses = await concurrentBookings(
      payload(9),
      Array.from({ length: 5 }, () => randomUUID()),
    );
    const successes = responses.filter(({ status }) => status === 201);
    const conflicts = responses.filter(({ status }) => status === 409);
    const appointments = successes.map(({ body }) => body as AppointmentResponse);

    expect(successes).toHaveLength(2);
    expect(conflicts).toHaveLength(3);
    expect(new Set(appointments.map(({ technicianId }) => technicianId)).size).toBe(2);
    expect(new Set(appointments.map(({ serviceBayId }) => serviceBayId)).size).toBe(2);
    await expectNoDatabaseOverlap(2);
  });

  it('coalesces concurrent retries with the same idempotency key', async () => {
    const idempotencyKey = randomUUID();
    const responses = await concurrentBookings(
      payload(11),
      Array.from({ length: 5 }, () => idempotencyKey),
    );

    expect(responses.every(({ status }) => status === 201)).toBe(true);
    const appointmentIds = responses.map(({ body }) => (body as AppointmentResponse).id);
    expect(new Set(appointmentIds).size).toBe(1);
    await expectNoDatabaseOverlap(1);
  });

  it('books the same period independently at two dealerships', async () => {
    await setResourceMatrix(false, false);
    const firstDealershipPayload = payload(13);
    const secondDealershipPayload = {
      ...firstDealershipPayload,
      dealershipId: secondDealership.dealershipId,
    };
    const server = app.getHttpAdapter().getInstance() as Express;

    const responses = await Promise.all([
      request(server)
        .post('/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(firstDealershipPayload),
      request(server)
        .post('/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(secondDealershipPayload),
    ]);
    const appointments = responses.map(({ body }) => body as AppointmentResponse);

    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(new Set(appointments.map(({ dealershipId }) => dealershipId))).toEqual(
      new Set([SEED_IDS.dealership, secondDealership.dealershipId]),
    );
    await expectNoDatabaseOverlap(2);
  });
});
