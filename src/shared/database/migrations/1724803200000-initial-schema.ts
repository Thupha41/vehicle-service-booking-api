import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1724803200000 implements MigrationInterface {
  name = 'InitialSchema1724803200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await queryRunner.query(`
      CREATE TABLE dealerships (
        id uuid PRIMARY KEY,
        name varchar(160) NOT NULL,
        timezone varchar(80) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT dealerships_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT dealerships_timezone_not_blank CHECK (btrim(timezone) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE dealership_business_hours (
        id uuid PRIMARY KEY,
        dealership_id uuid NOT NULL,
        day_of_week smallint NOT NULL,
        opens_at time without time zone NOT NULL,
        closes_at time without time zone NOT NULL,
        CONSTRAINT dealership_business_hours_dealership_fk
          FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE CASCADE,
        CONSTRAINT dealership_business_hours_day_check
          CHECK (day_of_week BETWEEN 1 AND 7),
        CONSTRAINT dealership_business_hours_period_check
          CHECK (closes_at > opens_at),
        CONSTRAINT dealership_business_hours_day_key
          UNIQUE (dealership_id, day_of_week)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE customers (
        id uuid PRIMARY KEY,
        name varchar(160) NOT NULL,
        email varchar(254) NOT NULL,
        phone varchar(40),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT customers_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT customers_email_key UNIQUE (email)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE vehicles (
        id uuid PRIMARY KEY,
        customer_id uuid NOT NULL,
        vin varchar(17) NOT NULL,
        make varchar(80) NOT NULL,
        model varchar(80) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vehicles_customer_fk
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT vehicles_vin_key UNIQUE (vin),
        CONSTRAINT vehicles_id_customer_key UNIQUE (id, customer_id),
        CONSTRAINT vehicles_vin_format_check
          CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
        CONSTRAINT vehicles_make_not_blank CHECK (btrim(make) <> ''),
        CONSTRAINT vehicles_model_not_blank CHECK (btrim(model) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE service_types (
        id uuid PRIMARY KEY,
        code varchar(50) NOT NULL,
        name varchar(160) NOT NULL,
        duration_minutes integer NOT NULL,
        required_bay_type varchar(40) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT service_types_code_key UNIQUE (code),
        CONSTRAINT service_types_code_not_blank CHECK (btrim(code) <> ''),
        CONSTRAINT service_types_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT service_types_duration_positive CHECK (duration_minutes > 0),
        CONSTRAINT service_types_bay_type_not_blank
          CHECK (btrim(required_bay_type) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE skills (
        id uuid PRIMARY KEY,
        code varchar(50) NOT NULL,
        name varchar(160) NOT NULL,
        CONSTRAINT skills_code_key UNIQUE (code),
        CONSTRAINT skills_code_not_blank CHECK (btrim(code) <> ''),
        CONSTRAINT skills_name_not_blank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE service_type_required_skills (
        service_type_id uuid NOT NULL,
        skill_id uuid NOT NULL,
        CONSTRAINT service_type_required_skills_pk
          PRIMARY KEY (service_type_id, skill_id),
        CONSTRAINT service_type_required_skills_service_type_fk
          FOREIGN KEY (service_type_id) REFERENCES service_types(id) ON DELETE CASCADE,
        CONSTRAINT service_type_required_skills_skill_fk
          FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE technicians (
        id uuid PRIMARY KEY,
        dealership_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technicians_dealership_fk
          FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT,
        CONSTRAINT technicians_id_dealership_key UNIQUE (id, dealership_id),
        CONSTRAINT technicians_name_not_blank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE technician_skills (
        technician_id uuid NOT NULL,
        skill_id uuid NOT NULL,
        CONSTRAINT technician_skills_pk PRIMARY KEY (technician_id, skill_id),
        CONSTRAINT technician_skills_technician_fk
          FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
        CONSTRAINT technician_skills_skill_fk
          FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE technician_shifts (
        id uuid PRIMARY KEY,
        technician_id uuid NOT NULL,
        working_period tstzrange NOT NULL,
        CONSTRAINT technician_shifts_technician_fk
          FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
        CONSTRAINT technician_shifts_valid_period CHECK (
          NOT isempty(working_period)
          AND lower_inc(working_period)
          AND NOT upper_inc(working_period)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE technician_unavailability (
        id uuid PRIMARY KEY,
        technician_id uuid NOT NULL,
        blocked_period tstzrange NOT NULL,
        reason varchar(255),
        CONSTRAINT technician_unavailability_technician_fk
          FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
        CONSTRAINT technician_unavailability_valid_period CHECK (
          NOT isempty(blocked_period)
          AND lower_inc(blocked_period)
          AND NOT upper_inc(blocked_period)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE service_bays (
        id uuid PRIMARY KEY,
        dealership_id uuid NOT NULL,
        name varchar(120) NOT NULL,
        bay_type varchar(40) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT service_bays_dealership_fk
          FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT,
        CONSTRAINT service_bays_id_dealership_key UNIQUE (id, dealership_id),
        CONSTRAINT service_bays_name_key UNIQUE (dealership_id, name),
        CONSTRAINT service_bays_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT service_bays_type_not_blank CHECK (btrim(bay_type) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE service_bay_unavailability (
        id uuid PRIMARY KEY,
        service_bay_id uuid NOT NULL,
        blocked_period tstzrange NOT NULL,
        reason varchar(255),
        CONSTRAINT service_bay_unavailability_service_bay_fk
          FOREIGN KEY (service_bay_id) REFERENCES service_bays(id) ON DELETE CASCADE,
        CONSTRAINT service_bay_unavailability_valid_period CHECK (
          NOT isempty(blocked_period)
          AND lower_inc(blocked_period)
          AND NOT upper_inc(blocked_period)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE appointments (
        id uuid PRIMARY KEY,
        idempotency_key varchar(128) NOT NULL,
        idempotency_request_hash char(64) NOT NULL,
        customer_id uuid NOT NULL,
        vehicle_id uuid NOT NULL,
        service_type_id uuid NOT NULL,
        dealership_id uuid NOT NULL,
        technician_id uuid NOT NULL,
        service_bay_id uuid NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        scheduled_period tstzrange GENERATED ALWAYS AS (
          tstzrange(starts_at, ends_at, '[)')
        ) STORED,
        service_duration_minutes integer NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'CONFIRMED',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT appointments_idempotency_key_key UNIQUE (idempotency_key),
        CONSTRAINT appointments_customer_fk
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT appointments_vehicle_customer_fk
          FOREIGN KEY (vehicle_id, customer_id)
          REFERENCES vehicles(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT appointments_service_type_fk
          FOREIGN KEY (service_type_id) REFERENCES service_types(id) ON DELETE RESTRICT,
        CONSTRAINT appointments_dealership_fk
          FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT,
        CONSTRAINT appointments_technician_dealership_fk
          FOREIGN KEY (technician_id, dealership_id)
          REFERENCES technicians(id, dealership_id) ON DELETE RESTRICT,
        CONSTRAINT appointments_service_bay_dealership_fk
          FOREIGN KEY (service_bay_id, dealership_id)
          REFERENCES service_bays(id, dealership_id) ON DELETE RESTRICT,
        CONSTRAINT appointment_valid_period CHECK (ends_at > starts_at),
        CONSTRAINT appointments_duration_positive CHECK (service_duration_minutes > 0),
        CONSTRAINT appointments_status_check CHECK (
          status IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
        ),
        CONSTRAINT appointments_technician_no_overlap
          EXCLUDE USING gist (
            dealership_id WITH =,
            technician_id WITH =,
            scheduled_period WITH &&
          ) WHERE (status IN ('CONFIRMED', 'IN_PROGRESS')),
        CONSTRAINT appointments_service_bay_no_overlap
          EXCLUDE USING gist (
            dealership_id WITH =,
            service_bay_id WITH =,
            scheduled_period WITH &&
          ) WHERE (status IN ('CONFIRMED', 'IN_PROGRESS'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX technician_shifts_period_idx
      ON technician_shifts USING gist (technician_id, working_period)
    `);
    await queryRunner.query(`
      CREATE INDEX technician_unavailability_period_idx
      ON technician_unavailability USING gist (technician_id, blocked_period)
    `);
    await queryRunner.query(`
      CREATE INDEX service_bay_unavailability_period_idx
      ON service_bay_unavailability USING gist (service_bay_id, blocked_period)
    `);
    await queryRunner.query(`
      CREATE INDEX technicians_dealership_active_idx
      ON technicians (dealership_id, active)
    `);
    await queryRunner.query(`
      CREATE INDEX service_bays_dealership_type_active_idx
      ON service_bays (dealership_id, bay_type, active)
    `);
    await queryRunner.query(`
      CREATE INDEX appointments_customer_created_idx
      ON appointments (customer_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS appointments`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_bay_unavailability`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_bays`);
    await queryRunner.query(`DROP TABLE IF EXISTS technician_unavailability`);
    await queryRunner.query(`DROP TABLE IF EXISTS technician_shifts`);
    await queryRunner.query(`DROP TABLE IF EXISTS technician_skills`);
    await queryRunner.query(`DROP TABLE IF EXISTS technicians`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_type_required_skills`);
    await queryRunner.query(`DROP TABLE IF EXISTS skills`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_types`);
    await queryRunner.query(`DROP TABLE IF EXISTS vehicles`);
    await queryRunner.query(`DROP TABLE IF EXISTS customers`);
    await queryRunner.query(`DROP TABLE IF EXISTS dealership_business_hours`);
    await queryRunner.query(`DROP TABLE IF EXISTS dealerships`);
    // btree_gist may be shared by other schemas/applications; provisioning owns
    // the extension lifecycle, so rolling back this schema intentionally leaves it installed.
  }
}
