import { randomUUID } from 'node:crypto';

import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';

import { InitialSchema1724803200000 } from '../../src/shared/database/migrations/1724803200000-initial-schema';
import { SEED_IDS, seedDatabase } from '../../src/shared/database/seed';

export interface TestActor {
  customerId: string;
  vehicleId: string;
}

export interface BookingPayload {
  customerId: string;
  vehicleId: string;
  dealershipId: string;
  serviceTypeId: string;
  desiredStartAt: string;
}

export interface TestDealership {
  dealershipId: string;
  technicianId: string;
  serviceBayId: string;
}

function resolveTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for PostgreSQL tests');
  }

  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');

  if (process.env.NODE_ENV !== 'test' || !databaseName.endsWith('_test')) {
    throw new Error(
      'Refusing destructive tests: NODE_ENV must be test and the database name must end in _test.',
    );
  }

  return databaseUrl;
}

export async function createPostgresTestDataSource(): Promise<DataSource> {
  const databaseUrl = resolveTestDatabaseUrl();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.LOG_LEVEL ??= 'silent';
  process.env.OTEL_ENABLED ??= 'false';

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    logging: false,
    migrations: [InitialSchema1724803200000],
  });

  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
  await seedDatabase(dataSource);
  await resetAppointments(dataSource);

  return dataSource;
}

export async function resetAppointments(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM appointments');
}

export async function createTestActor(dataSource: DataSource, label: string): Promise<TestActor> {
  const customerId = randomUUID();
  const vehicleId = randomUUID();
  const unique = randomUUID().replaceAll('-', '');
  const vin = `TST${unique.slice(0, 14)}`.toUpperCase();

  await dataSource.query(
    `INSERT INTO customers (id, name, email, phone)
     VALUES ($1, $2, $3, NULL)`,
    [customerId, `Test ${label}`, `test.${unique}@example.com`],
  );
  await dataSource.query(
    `INSERT INTO vehicles (id, customer_id, vin, make, model)
     VALUES ($1, $2, $3, 'Test', 'Fixture')`,
    [vehicleId, customerId, vin],
  );

  return { customerId, vehicleId };
}

export async function cleanupTestActor(dataSource: DataSource, actor: TestActor): Promise<void> {
  await dataSource.query('DELETE FROM appointments WHERE customer_id = $1', [actor.customerId]);
  await dataSource.query('DELETE FROM vehicles WHERE id = $1', [actor.vehicleId]);
  await dataSource.query('DELETE FROM customers WHERE id = $1', [actor.customerId]);
}

export async function createTestDealership(
  dataSource: DataSource,
  label: string,
): Promise<TestDealership> {
  const dealershipId = randomUUID();
  const technicianId = randomUUID();
  const serviceBayId = randomUUID();
  const shiftId = randomUUID();

  await dataSource.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO dealerships (id, name, timezone, active)
       VALUES ($1, $2, 'Europe/London', true)`,
      [dealershipId, `Test Dealership ${label}`],
    );
    for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek += 1) {
      await manager.query(
        `INSERT INTO dealership_business_hours
          (id, dealership_id, day_of_week, opens_at, closes_at)
         VALUES ($1, $2, $3, '08:00', '17:00')`,
        [randomUUID(), dealershipId, dayOfWeek],
      );
    }
    await manager.query(
      `INSERT INTO technicians (id, dealership_id, name, active)
       VALUES ($1, $2, $3, true)`,
      [technicianId, dealershipId, `Test Technician ${label}`],
    );
    await manager.query(
      `INSERT INTO technician_skills (technician_id, skill_id)
       VALUES ($1, $2)`,
      [technicianId, SEED_IDS.skills.general],
    );
    await manager.query(
      `INSERT INTO technician_shifts (id, technician_id, working_period)
       VALUES (
         $1,
         $2,
         tstzrange('2020-01-01T00:00:00Z', '2100-01-01T00:00:00Z', '[)')
       )`,
      [shiftId, technicianId],
    );
    await manager.query(
      `INSERT INTO service_bays (id, dealership_id, name, bay_type, active)
       VALUES ($1, $2, $3, 'STANDARD', true)`,
      [serviceBayId, dealershipId, `Test Standard Bay ${label}`],
    );
  });

  return { dealershipId, technicianId, serviceBayId };
}

export async function cleanupTestDealership(
  dataSource: DataSource,
  dealership: TestDealership,
): Promise<void> {
  await dataSource.query('DELETE FROM appointments WHERE dealership_id = $1', [
    dealership.dealershipId,
  ]);
  await dataSource.query('DELETE FROM service_bays WHERE dealership_id = $1', [
    dealership.dealershipId,
  ]);
  await dataSource.query('DELETE FROM technicians WHERE dealership_id = $1', [
    dealership.dealershipId,
  ]);
  await dataSource.query('DELETE FROM dealerships WHERE id = $1', [dealership.dealershipId]);
}

export function futureLondonBusinessStart(dayOffset = 0, hour = 10): DateTime {
  let candidate = DateTime.now()
    .setZone('Europe/London')
    .plus({ days: 14 + dayOffset })
    .startOf('day')
    .set({ hour });

  while (candidate.weekday > 5) {
    candidate = candidate.plus({ days: 1 });
  }

  return candidate;
}

export async function countOverlappingActiveAppointments(
  dataSource: DataSource,
  customerId: string,
): Promise<number> {
  const rows = await dataSource.query<Array<{ overlap_count: number }>>(
    `SELECT count(*)::int AS overlap_count
     FROM appointments first_appointment
     JOIN appointments second_appointment
       ON first_appointment.id < second_appointment.id
      AND first_appointment.dealership_id = second_appointment.dealership_id
      AND (
        first_appointment.technician_id = second_appointment.technician_id
        OR first_appointment.service_bay_id = second_appointment.service_bay_id
      )
      AND first_appointment.scheduled_period && second_appointment.scheduled_period
     WHERE first_appointment.customer_id = $1
       AND second_appointment.customer_id = $1
       AND first_appointment.status IN ('CONFIRMED', 'IN_PROGRESS')
       AND second_appointment.status IN ('CONFIRMED', 'IN_PROGRESS')`,
    [customerId],
  );

  return Number(rows[0]?.overlap_count ?? 0);
}
