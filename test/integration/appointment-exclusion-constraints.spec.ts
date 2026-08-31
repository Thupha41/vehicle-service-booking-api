import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import type { DateTime } from 'luxon';
import * as request from 'supertest';
import type { DataSource } from 'typeorm';

import { SEED_IDS } from '../../src/shared/database/seed';
import { createApiTestApp } from '../helpers/api-test-app';
import {
  cleanupTestDealership,
  cleanupTestActor,
  createPostgresTestDataSource,
  createTestDealership,
  createTestActor,
  futureLondonBusinessStart,
  resetAppointments,
  type TestDealership,
  type TestActor,
} from '../helpers/postgres-test-database';

interface AppointmentFixture {
  technicianId: string;
  serviceBayId: string;
  startsAt: DateTime;
  endsAt: DateTime;
  status?: 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  customerId?: string;
  vehicleId?: string;
  dealershipId?: string;
}

describe('appointment PostgreSQL exclusion constraints', () => {
  let dataSource: DataSource;
  let app: INestApplication;
  let actor: TestActor;
  let secondDealership: TestDealership;

  beforeAll(async () => {
    dataSource = await createPostgresTestDataSource();
    actor = await createTestActor(dataSource, 'exclusion constraints');
    secondDealership = await createTestDealership(dataSource, 'constraint consistency');
    app = await createApiTestApp();
  });

  beforeEach(async () => {
    await resetAppointments(dataSource);
    await dataSource.query('DROP TRIGGER IF EXISTS test_pause_booking_insert ON appointments');
    await dataSource.query('DROP FUNCTION IF EXISTS test_pause_booking_insert()');
  });

  afterEach(async () => {
    await resetAppointments(dataSource);
    await dataSource.query('DROP TRIGGER IF EXISTS test_pause_booking_insert ON appointments');
    await dataSource.query('DROP FUNCTION IF EXISTS test_pause_booking_insert()');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (secondDealership) {
      await cleanupTestDealership(dataSource, secondDealership);
    }
    if (actor) {
      await cleanupTestActor(dataSource, actor);
    }
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function insertAppointment(fixture: AppointmentFixture): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO appointments (
        id, idempotency_key, idempotency_request_hash, customer_id, vehicle_id,
        dealership_id, service_type_id, technician_id, service_bay_id,
        starts_at, ends_at, service_duration_minutes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 60, $12)`,
      [
        id,
        randomUUID(),
        randomUUID().replaceAll('-', '').padEnd(64, '0'),
        fixture.customerId ?? actor.customerId,
        fixture.vehicleId ?? actor.vehicleId,
        fixture.dealershipId ?? SEED_IDS.dealership,
        SEED_IDS.serviceTypes.oilChange,
        fixture.technicianId,
        fixture.serviceBayId,
        fixture.startsAt.toUTC().toJSDate(),
        fixture.endsAt.toUTC().toJSDate(),
        fixture.status ?? 'CONFIRMED',
      ],
    );
    return id;
  }

  it('rejects overlapping active appointments for the same technician', async () => {
    const startsAt = futureLondonBusinessStart();
    await insertAppointment({
      technicianId: SEED_IDS.technicians.alex,
      serviceBayId: SEED_IDS.bays.standard,
      startsAt,
      endsAt: startsAt.plus({ hours: 1 }),
    });

    await expect(
      insertAppointment({
        technicianId: SEED_IDS.technicians.alex,
        serviceBayId: SEED_IDS.bays.lift,
        startsAt: startsAt.plus({ minutes: 30 }),
        endsAt: startsAt.plus({ minutes: 90 }),
      }),
    ).rejects.toMatchObject({
      code: '23P01',
      constraint: 'appointments_technician_no_overlap',
    });
  });

  it('rejects overlapping active appointments for the same service bay', async () => {
    const startsAt = futureLondonBusinessStart(1);
    await insertAppointment({
      technicianId: SEED_IDS.technicians.alex,
      serviceBayId: SEED_IDS.bays.standard,
      startsAt,
      endsAt: startsAt.plus({ hours: 1 }),
    });

    await expect(
      insertAppointment({
        technicianId: SEED_IDS.technicians.jordan,
        serviceBayId: SEED_IDS.bays.standard,
        startsAt: startsAt.plus({ minutes: 15 }),
        endsAt: startsAt.plus({ minutes: 75 }),
      }),
    ).rejects.toMatchObject({
      code: '23P01',
      constraint: 'appointments_service_bay_no_overlap',
    });
  });

  it('allows adjacent half-open appointment periods for the same resources', async () => {
    const startsAt = futureLondonBusinessStart(2);
    await insertAppointment({
      technicianId: SEED_IDS.technicians.alex,
      serviceBayId: SEED_IDS.bays.standard,
      startsAt,
      endsAt: startsAt.plus({ hours: 1 }),
    });

    await expect(
      insertAppointment({
        technicianId: SEED_IDS.technicians.alex,
        serviceBayId: SEED_IDS.bays.standard,
        startsAt: startsAt.plus({ hours: 1 }),
        endsAt: startsAt.plus({ hours: 2 }),
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('allows a confirmed appointment to reuse resources held only by a cancelled row', async () => {
    const startsAt = futureLondonBusinessStart(3);
    await insertAppointment({
      technicianId: SEED_IDS.technicians.alex,
      serviceBayId: SEED_IDS.bays.standard,
      startsAt,
      endsAt: startsAt.plus({ hours: 1 }),
      status: 'CANCELLED',
    });

    await expect(
      insertAppointment({
        technicianId: SEED_IDS.technicians.alex,
        serviceBayId: SEED_IDS.bays.standard,
        startsAt,
        endsAt: startsAt.plus({ hours: 1 }),
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('rejects an empty appointment period', async () => {
    const startsAt = futureLondonBusinessStart(4);

    await expect(
      insertAppointment({
        technicianId: SEED_IDS.technicians.alex,
        serviceBayId: SEED_IDS.bays.standard,
        startsAt,
        endsAt: startsAt,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'appointment_valid_period',
    });
  });

  it('enforces the vehicle/customer composite foreign key', async () => {
    const startsAt = futureLondonBusinessStart(5);

    await expect(
      insertAppointment({
        customerId: SEED_IDS.customer,
        vehicleId: actor.vehicleId,
        technicianId: SEED_IDS.technicians.alex,
        serviceBayId: SEED_IDS.bays.standard,
        startsAt,
        endsAt: startsAt.plus({ hours: 1 }),
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointments_vehicle_customer_fk',
    });
  });

  it('prevents assigning a technician from another dealership', async () => {
    const startsAt = futureLondonBusinessStart(6);

    await expect(
      insertAppointment({
        technicianId: secondDealership.technicianId,
        serviceBayId: SEED_IDS.bays.standard,
        startsAt,
        endsAt: startsAt.plus({ hours: 1 }),
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointments_technician_dealership_fk',
    });
  });

  it('prevents assigning a service bay from another dealership', async () => {
    const startsAt = futureLondonBusinessStart(7);

    await expect(
      insertAppointment({
        technicianId: SEED_IDS.technicians.alex,
        serviceBayId: secondDealership.serviceBayId,
        startsAt,
        endsAt: startsAt.plus({ hours: 1 }),
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointments_service_bay_dealership_fk',
    });
  });

  it('maps a database exclusion race to HTTP 409 SLOT_CONFLICT', async () => {
    const advisoryLockKey = 923_456_781;
    const startsAt = futureLondonBusinessStart(9);
    const desiredStartAt = startsAt.toISO();
    if (!desiredStartAt) {
      throw new Error('Unable to construct the controlled-race timestamp');
    }

    await dataSource.query(`
      CREATE FUNCTION test_pause_booking_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.customer_id = '${actor.customerId}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${advisoryLockKey});
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await dataSource.query(`
      CREATE TRIGGER test_pause_booking_insert
      BEFORE INSERT ON appointments
      FOR EACH ROW EXECUTE FUNCTION test_pause_booking_insert()
    `);

    const blocker = dataSource.createQueryRunner();
    await blocker.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [advisoryLockKey]);
    let lockReleased = false;
    const apiPromise = Promise.resolve(
      request(app.getHttpAdapter().getInstance() as Express)
        .post('/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId: actor.customerId,
          vehicleId: actor.vehicleId,
          dealershipId: SEED_IDS.dealership,
          serviceTypeId: SEED_IDS.serviceTypes.oilChange,
          desiredStartAt,
        }),
    );

    try {
      await waitForAdvisoryWaiter();
      const injector = dataSource.createQueryRunner();
      await injector.connect();
      await injector.startTransaction();
      try {
        await injector.query("SET LOCAL session_replication_role = 'replica'");
        await injector.query(
          `INSERT INTO appointments (
            id, idempotency_key, idempotency_request_hash, customer_id, vehicle_id,
            dealership_id, service_type_id, technician_id, service_bay_id,
            starts_at, ends_at, service_duration_minutes, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 60, 'CONFIRMED')`,
          [
            randomUUID(),
            randomUUID(),
            randomUUID().replaceAll('-', '').padEnd(64, '0'),
            actor.customerId,
            actor.vehicleId,
            SEED_IDS.dealership,
            SEED_IDS.serviceTypes.oilChange,
            SEED_IDS.technicians.alex,
            SEED_IDS.bays.standard,
            startsAt.toUTC().toJSDate(),
            startsAt.plus({ hours: 1 }).toUTC().toJSDate(),
          ],
        );
        await injector.commitTransaction();
      } catch (error) {
        await injector.rollbackTransaction();
        throw error;
      } finally {
        await injector.release();
      }

      await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]);
      lockReleased = true;
      const response = await apiPromise;
      expect(response.status).toBe(409);
      expect(response.body as unknown).toMatchObject({
        statusCode: 409,
        error: { code: 'SLOT_CONFLICT' },
      });
    } finally {
      if (!lockReleased) {
        await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]);
      }
      await blocker.release();
      await apiPromise.catch(() => undefined);
    }
  });

  async function waitForAdvisoryWaiter(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await dataSource.query<Array<{ waiting: boolean }>>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_locks
           WHERE locktype = 'advisory' AND granted = false
         ) AS waiting`,
      );
      if (rows[0]?.waiting) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('API booking did not reach the controlled exclusion-race barrier');
  }
});
