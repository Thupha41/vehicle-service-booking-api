import 'reflect-metadata';

import type { DataSource } from 'typeorm';

export const SEED_IDS = {
  dealership: '10000000-0000-4000-8000-000000000001',
  customer: '20000000-0000-4000-8000-000000000001',
  vehicle: '30000000-0000-4000-8000-000000000001',
  serviceTypes: {
    oilChange: '40000000-0000-4000-8000-000000000001',
    brakeService: '40000000-0000-4000-8000-000000000002',
    evDiagnostic: '40000000-0000-4000-8000-000000000003',
  },
  skills: {
    general: '50000000-0000-4000-8000-000000000001',
    brakes: '50000000-0000-4000-8000-000000000002',
    ev: '50000000-0000-4000-8000-000000000003',
  },
  technicians: {
    alex: '60000000-0000-4000-8000-000000000001',
    jordan: '60000000-0000-4000-8000-000000000002',
  },
  bays: {
    standard: '70000000-0000-4000-8000-000000000001',
    lift: '70000000-0000-4000-8000-000000000002',
    ev: '70000000-0000-4000-8000-000000000003',
  },
  shifts: {
    alex: '80000000-0000-4000-8000-000000000001',
    jordan: '80000000-0000-4000-8000-000000000002',
  },
} as const;

const BUSINESS_HOUR_IDS = [
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000005',
  '90000000-0000-4000-8000-000000000006',
] as const;

export async function seedDatabase(targetDataSource?: DataSource): Promise<void> {
  const seedDataSource = targetDataSource ?? (await import('./data-source')).default;
  const ownsConnection = !seedDataSource.isInitialized;

  if (ownsConnection) {
    await seedDataSource.initialize();
  }

  try {
    await seedDataSource.transaction(async (manager) => {
      await manager.query(
        `
          INSERT INTO dealerships (id, name, timezone, active)
          VALUES ($1, 'Keyloop Demo London', 'Europe/London', true)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            timezone = EXCLUDED.timezone,
            active = EXCLUDED.active,
            updated_at = now()
        `,
        [SEED_IDS.dealership],
      );

      for (let index = 0; index < BUSINESS_HOUR_IDS.length; index += 1) {
        await manager.query(
          `
            INSERT INTO dealership_business_hours
              (id, dealership_id, day_of_week, opens_at, closes_at)
            VALUES ($1, $2, $3, '08:00', '17:00')
            ON CONFLICT (dealership_id, day_of_week) DO UPDATE SET
              opens_at = EXCLUDED.opens_at,
              closes_at = EXCLUDED.closes_at
          `,
          [BUSINESS_HOUR_IDS[index], SEED_IDS.dealership, index + 1],
        );
      }

      await manager.query(
        `
          INSERT INTO customers (id, name, email, phone)
          VALUES ($1, 'Taylor Morgan', 'taylor.morgan@example.com', '+44 7700 900123')
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            updated_at = now()
        `,
        [SEED_IDS.customer],
      );

      await manager.query(
        `
          INSERT INTO vehicles (id, customer_id, vin, make, model)
          VALUES ($1, $2, 'WVWZZZ1JZXW000001', 'Volkswagen', 'Golf')
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            vin = EXCLUDED.vin,
            make = EXCLUDED.make,
            model = EXCLUDED.model,
            updated_at = now()
        `,
        [SEED_IDS.vehicle, SEED_IDS.customer],
      );

      const serviceTypes = [
        [SEED_IDS.serviceTypes.oilChange, 'OIL_CHANGE', 'Oil change', 60, 'STANDARD'],
        [SEED_IDS.serviceTypes.brakeService, 'BRAKE_SERVICE', 'Brake service', 90, 'LIFT'],
        [SEED_IDS.serviceTypes.evDiagnostic, 'EV_DIAGNOSTIC', 'EV diagnostic', 120, 'EV'],
      ] as const;

      for (const serviceType of serviceTypes) {
        await manager.query(
          `
            INSERT INTO service_types
              (id, code, name, duration_minutes, required_bay_type, active)
            VALUES ($1, $2, $3, $4, $5, true)
            ON CONFLICT (id) DO UPDATE SET
              code = EXCLUDED.code,
              name = EXCLUDED.name,
              duration_minutes = EXCLUDED.duration_minutes,
              required_bay_type = EXCLUDED.required_bay_type,
              active = EXCLUDED.active,
              updated_at = now()
          `,
          [...serviceType],
        );
      }

      const skills = [
        [SEED_IDS.skills.general, 'GENERAL_SERVICE', 'General service'],
        [SEED_IDS.skills.brakes, 'BRAKES', 'Brake systems'],
        [SEED_IDS.skills.ev, 'EV_CERTIFIED', 'Electric vehicle systems'],
      ] as const;

      for (const skill of skills) {
        await manager.query(
          `
            INSERT INTO skills (id, code, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET
              code = EXCLUDED.code,
              name = EXCLUDED.name
          `,
          [...skill],
        );
      }

      const requiredSkills = [
        [SEED_IDS.serviceTypes.oilChange, SEED_IDS.skills.general],
        [SEED_IDS.serviceTypes.brakeService, SEED_IDS.skills.general],
        [SEED_IDS.serviceTypes.brakeService, SEED_IDS.skills.brakes],
        [SEED_IDS.serviceTypes.evDiagnostic, SEED_IDS.skills.general],
        [SEED_IDS.serviceTypes.evDiagnostic, SEED_IDS.skills.ev],
      ] as const;

      for (const requiredSkill of requiredSkills) {
        await manager.query(
          `
            INSERT INTO service_type_required_skills (service_type_id, skill_id)
            VALUES ($1, $2)
            ON CONFLICT (service_type_id, skill_id) DO NOTHING
          `,
          [...requiredSkill],
        );
      }

      const technicians = [
        [SEED_IDS.technicians.alex, 'Alex Rivera'],
        [SEED_IDS.technicians.jordan, 'Jordan Lee'],
      ] as const;

      for (const technician of technicians) {
        await manager.query(
          `
            INSERT INTO technicians (id, dealership_id, name, active)
            VALUES ($1, $2, $3, true)
            ON CONFLICT (id) DO UPDATE SET
              dealership_id = EXCLUDED.dealership_id,
              name = EXCLUDED.name,
              active = EXCLUDED.active,
              updated_at = now()
          `,
          [technician[0], SEED_IDS.dealership, technician[1]],
        );
      }

      const technicianSkills = [
        [SEED_IDS.technicians.alex, SEED_IDS.skills.general],
        [SEED_IDS.technicians.alex, SEED_IDS.skills.brakes],
        [SEED_IDS.technicians.jordan, SEED_IDS.skills.general],
        [SEED_IDS.technicians.jordan, SEED_IDS.skills.ev],
      ] as const;

      for (const technicianSkill of technicianSkills) {
        await manager.query(
          `
            INSERT INTO technician_skills (technician_id, skill_id)
            VALUES ($1, $2)
            ON CONFLICT (technician_id, skill_id) DO NOTHING
          `,
          [...technicianSkill],
        );
      }

      const shifts = [
        [SEED_IDS.shifts.alex, SEED_IDS.technicians.alex],
        [SEED_IDS.shifts.jordan, SEED_IDS.technicians.jordan],
      ] as const;

      for (const shift of shifts) {
        await manager.query(
          `
            INSERT INTO technician_shifts (id, technician_id, working_period)
            VALUES (
              $1,
              $2,
              tstzrange('2020-01-01T00:00:00Z', '2100-01-01T00:00:00Z', '[)')
            )
            ON CONFLICT (id) DO UPDATE SET
              technician_id = EXCLUDED.technician_id,
              working_period = EXCLUDED.working_period
          `,
          [...shift],
        );
      }

      const bays = [
        [SEED_IDS.bays.standard, 'Bay 1', 'STANDARD'],
        [SEED_IDS.bays.lift, 'Lift Bay 1', 'LIFT'],
        [SEED_IDS.bays.ev, 'EV Bay 1', 'EV'],
      ] as const;

      for (const bay of bays) {
        await manager.query(
          `
            INSERT INTO service_bays (id, dealership_id, name, bay_type, active)
            VALUES ($1, $2, $3, $4, true)
            ON CONFLICT (id) DO UPDATE SET
              dealership_id = EXCLUDED.dealership_id,
              name = EXCLUDED.name,
              bay_type = EXCLUDED.bay_type,
              active = EXCLUDED.active,
              updated_at = now()
          `,
          [bay[0], SEED_IDS.dealership, bay[1], bay[2]],
        );
      }
    });

    console.info('Scenario A seed data applied successfully.');
  } finally {
    if (ownsConnection && seedDataSource.isInitialized) {
      await seedDataSource.destroy();
    }
  }
}

if (require.main === module) {
  void seedDatabase().catch((error: unknown) => {
    console.error('Scenario A seed failed.', error);
    process.exitCode = 1;
  });
}
