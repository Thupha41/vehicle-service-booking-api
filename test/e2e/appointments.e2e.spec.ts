import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import * as request from 'supertest';
import type { DataSource } from 'typeorm';

import { SEED_IDS } from '../../src/shared/database/seed';
import { createApiTestApp } from '../helpers/api-test-app';
import {
  cleanupTestActor,
  createPostgresTestDataSource,
  createTestActor,
  futureLondonBusinessStart,
  resetAppointments,
  type BookingPayload,
  type TestActor,
} from '../helpers/postgres-test-database';

interface AppointmentResponse extends BookingPayload {
  id: string;
  status: string;
  technicianId: string;
  serviceBayId: string;
  startsAt: string;
  endsAt: string;
}

interface ErrorResponse {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

describe('appointments API (e2e)', () => {
  let dataSource: DataSource;
  let app: INestApplication;
  let actor: TestActor;

  beforeAll(async () => {
    dataSource = await createPostgresTestDataSource();
    actor = await createTestActor(dataSource, 'appointments e2e');
    app = await createApiTestApp();
  });

  beforeEach(async () => {
    await resetAppointments(dataSource);
    await restoreMutableFixtures();
  });

  afterEach(async () => {
    await resetAppointments(dataSource);
    await restoreMutableFixtures();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (actor) {
      await cleanupTestActor(dataSource, actor);
    }
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  function bookingPayload(dayOffset = 0, hour = 10): BookingPayload {
    const desiredStartAt = futureLondonBusinessStart(dayOffset, hour).toISO();
    if (!desiredStartAt) {
      throw new Error('Unable to construct an ISO timestamp for the test booking');
    }

    return {
      customerId: actor.customerId,
      vehicleId: actor.vehicleId,
      dealershipId: SEED_IDS.dealership,
      serviceTypeId: SEED_IDS.serviceTypes.oilChange,
      desiredStartAt,
    };
  }

  async function restoreMutableFixtures(): Promise<void> {
    await dataSource.query(
      `INSERT INTO technician_skills (technician_id, skill_id)
       VALUES ($1, $2)
       ON CONFLICT (technician_id, skill_id) DO NOTHING`,
      [SEED_IDS.technicians.alex, SEED_IDS.skills.brakes],
    );
    await dataSource.query(`DELETE FROM service_bay_unavailability WHERE reason LIKE 'test:%'`);
  }

  it('checks availability, books, reads, cancels, and releases the slot', async () => {
    const payload = bookingPayload();
    const api = request(app.getHttpAdapter().getInstance() as Express);

    const availability = await api
      .post('/v1/availability/check')
      .send({
        dealershipId: payload.dealershipId,
        vehicleId: payload.vehicleId,
        serviceTypeId: payload.serviceTypeId,
        desiredStartAt: payload.desiredStartAt,
      })
      .expect(200);
    expect(availability.body as unknown).toMatchObject({
      available: true,
      durationMinutes: 60,
    });

    const booked = await api
      .post('/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(201);
    const appointment = booked.body as AppointmentResponse;
    expect(appointment).toMatchObject({
      status: 'CONFIRMED',
      customerId: payload.customerId,
      vehicleId: payload.vehicleId,
      dealershipId: payload.dealershipId,
      serviceTypeId: payload.serviceTypeId,
    });
    expect(new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()).toBe(
      60 * 60 * 1_000,
    );

    const fetched = await api.get(`/v1/appointments/${appointment.id}`).expect(200);
    expect(fetched.body as unknown).toMatchObject({
      id: appointment.id,
      status: 'CONFIRMED',
    });

    const cancelled = await api.post(`/v1/appointments/${appointment.id}/cancel`).expect(200);
    expect(cancelled.body as unknown).toMatchObject({
      id: appointment.id,
      status: 'CANCELLED',
    });

    const repeatedCancellation = await api
      .post(`/v1/appointments/${appointment.id}/cancel`)
      .expect(200);
    expect(repeatedCancellation.body as unknown).toMatchObject({
      id: appointment.id,
      status: 'CANCELLED',
    });

    const replacement = await api
      .post('/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(201);
    expect(replacement.body as unknown).toMatchObject({ status: 'CONFIRMED' });
  });

  it('returns the same appointment for sequential retries with one idempotency key', async () => {
    const payload = bookingPayload(2);
    const idempotencyKey = randomUUID();
    const api = request(app.getHttpAdapter().getInstance() as Express);

    const first = await api
      .post('/v1/appointments')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);
    const replay = await api
      .post('/v1/appointments')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const firstAppointment = first.body as AppointmentResponse;
    const replayedAppointment = replay.body as AppointmentResponse;
    expect(replayedAppointment.id).toBe(firstAppointment.id);

    const rows = await dataSource.query<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM appointments WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    expect(rows[0]?.count).toBe(1);

    const reused = await api
      .post('/v1/appointments')
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, vehicleId: randomUUID() })
      .expect(409);
    expect(reused.body as ErrorResponse).toMatchObject({
      statusCode: 409,
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('returns stable validation and domain errors', async () => {
    const payload = bookingPayload(4);
    const api = request(app.getHttpAdapter().getInstance() as Express);

    const missingKey = await api.post('/v1/appointments').send(payload).expect(400);
    expect(missingKey.body as ErrorResponse).toMatchObject({
      statusCode: 400,
      error: { code: 'INVALID_IDEMPOTENCY_KEY' },
    });

    const invalidBody = await api
      .post('/v1/availability/check')
      .send({
        ...payload,
        dealershipId: 'not-a-uuid',
        unexpected: true,
      })
      .expect(400);
    expect(invalidBody.body as ErrorResponse).toMatchObject({
      statusCode: 400,
      error: { code: 'VALIDATION_ERROR' },
    });

    const mismatch = await api
      .post('/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...payload, customerId: SEED_IDS.customer })
      .expect(422);
    expect(mismatch.body as ErrorResponse).toMatchObject({
      statusCode: 422,
      error: { code: 'VEHICLE_CUSTOMER_MISMATCH' },
    });

    const missingAppointment = await api.get(`/v1/appointments/${randomUUID()}`).expect(404);
    expect(missingAppointment.body as ErrorResponse).toMatchObject({
      statusCode: 404,
      error: { code: 'APPOINTMENT_NOT_FOUND' },
    });

    const afterHours = bookingPayload(5, 18);
    const unavailable = await api
      .post('/v1/availability/check')
      .send({
        dealershipId: afterHours.dealershipId,
        vehicleId: afterHours.vehicleId,
        serviceTypeId: afterHours.serviceTypeId,
        desiredStartAt: afterHours.desiredStartAt,
      })
      .expect(200);
    expect(unavailable.body as unknown).toMatchObject({
      available: false,
      reason: 'OUTSIDE_BUSINESS_HOURS',
    });
  });

  it('reports unavailable when no technician owns every required skill', async () => {
    const payload = {
      ...bookingPayload(6),
      serviceTypeId: SEED_IDS.serviceTypes.brakeService,
    };
    await dataSource.query('DELETE FROM technician_skills WHERE skill_id = $1', [
      SEED_IDS.skills.brakes,
    ]);

    const response = await request(app.getHttpAdapter().getInstance() as Express)
      .post('/v1/availability/check')
      .send({
        dealershipId: payload.dealershipId,
        vehicleId: payload.vehicleId,
        serviceTypeId: payload.serviceTypeId,
        desiredStartAt: payload.desiredStartAt,
      })
      .expect(200);

    expect(response.body as unknown).toMatchObject({
      available: false,
      reason: 'NO_QUALIFIED_TECHNICIAN',
      durationMinutes: 90,
    });
  });

  it('reports unavailable while the only compatible bay is under maintenance', async () => {
    const payload = bookingPayload(7);
    const startsAt = new Date(payload.desiredStartAt);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1_000);
    await dataSource.query(
      `INSERT INTO service_bay_unavailability
        (id, service_bay_id, blocked_period, reason)
       VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5)`,
      [randomUUID(), SEED_IDS.bays.standard, startsAt, endsAt, 'test: scheduled maintenance'],
    );

    const response = await request(app.getHttpAdapter().getInstance() as Express)
      .post('/v1/availability/check')
      .send({
        dealershipId: payload.dealershipId,
        vehicleId: payload.vehicleId,
        serviceTypeId: payload.serviceTypeId,
        desiredStartAt: payload.desiredStartAt,
      })
      .expect(200);

    expect(response.body as unknown).toMatchObject({
      available: false,
      reason: 'NO_COMPATIBLE_SERVICE_BAY',
    });
  });

  it.each([
    ['vehicle', 'vehicleId', 'VEHICLE_NOT_FOUND'],
    ['dealership', 'dealershipId', 'DEALERSHIP_NOT_FOUND'],
    ['service type', 'serviceTypeId', 'SERVICE_TYPE_NOT_FOUND'],
  ] as const)('returns 404 for an unknown %s', async (_label, field, errorCode) => {
    const payload = bookingPayload(8);
    const availabilityRequest = {
      vehicleId: payload.vehicleId,
      dealershipId: payload.dealershipId,
      serviceTypeId: payload.serviceTypeId,
      desiredStartAt: payload.desiredStartAt,
    };
    const response = await request(app.getHttpAdapter().getInstance() as Express)
      .post('/v1/availability/check')
      .send({ ...availabilityRequest, [field]: randomUUID() })
      .expect(404);

    expect(response.body as ErrorResponse).toMatchObject({
      statusCode: 404,
      error: { code: errorCode },
    });
  });

  it('publishes the expected OpenAPI paths and booking request schema', async () => {
    const response = await request(app.getHttpAdapter().getInstance() as Express)
      .get('/openapi.json')
      .expect(200)
      .expect('Content-Type', /json/);
    const document = response.body as {
      openapi?: string;
      paths?: Record<string, unknown>;
      components?: {
        schemas?: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
      };
    };

    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths ?? {})).toEqual(
      expect.arrayContaining([
        '/v1/availability/check',
        '/v1/appointments',
        '/v1/appointments/{id}',
        '/v1/appointments/{id}/cancel',
      ]),
    );
    const bookingSchema = document.components?.schemas?.BookAppointmentDto;
    expect(bookingSchema?.required).toEqual([
      'customerId',
      'vehicleId',
      'dealershipId',
      'serviceTypeId',
      'desiredStartAt',
    ]);
    expect(Object.keys(bookingSchema?.properties ?? {})).toEqual(
      expect.arrayContaining([
        'customerId',
        'vehicleId',
        'dealershipId',
        'serviceTypeId',
        'desiredStartAt',
      ]),
    );
  });
});
