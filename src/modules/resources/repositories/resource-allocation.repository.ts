import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface ResourceSearch {
  dealershipId: string;
  serviceTypeId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface AvailableResourceIds {
  technicianIds: string[];
  serviceBayIds: string[];
}

interface ResourceIdRow {
  id: string;
}

@Injectable()
export class ResourceAllocationRepository {
  async findAvailableResourceIds(
    manager: EntityManager,
    search: ResourceSearch,
  ): Promise<AvailableResourceIds> {
    const parameters = this.parameters(search);
    const technicianRows: ResourceIdRow[] = await manager.query(
      `${this.technicianCandidateQuery()}
       ORDER BY t.id`,
      parameters,
    );
    const serviceBayRows: ResourceIdRow[] = await manager.query(
      `${this.serviceBayCandidateQuery()}
       ORDER BY b.id`,
      parameters,
    );

    return {
      technicianIds: technicianRows.map(({ id }) => id),
      serviceBayIds: serviceBayRows.map(({ id }) => id),
    };
  }

  async findAndLockAvailableTechnician(
    manager: EntityManager,
    search: ResourceSearch,
  ): Promise<string | null> {
    const rows: ResourceIdRow[] = await manager.query(
      `${this.technicianCandidateQuery()}
       ORDER BY t.id
       LIMIT 1
       FOR UPDATE OF t SKIP LOCKED`,
      this.parameters(search),
    );

    return rows[0]?.id ?? null;
  }

  async findAndLockAvailableServiceBay(
    manager: EntityManager,
    search: ResourceSearch,
  ): Promise<string | null> {
    const rows: ResourceIdRow[] = await manager.query(
      `${this.serviceBayCandidateQuery()}
       ORDER BY b.id
       LIMIT 1
       FOR UPDATE OF b SKIP LOCKED`,
      this.parameters(search),
    );

    return rows[0]?.id ?? null;
  }

  private parameters(search: ResourceSearch): [string, string, Date, Date] {
    return [search.dealershipId, search.serviceTypeId, search.startsAt, search.endsAt];
  }

  private technicianCandidateQuery(): string {
    return `
      SELECT t.id
      FROM technicians t
      WHERE t.dealership_id = $1
        AND t.active = true
        AND NOT EXISTS (
          SELECT 1
          FROM service_type_required_skills required_skill
          WHERE required_skill.service_type_id = $2
            AND NOT EXISTS (
              SELECT 1
              FROM technician_skills technician_skill
              WHERE technician_skill.technician_id = t.id
                AND technician_skill.skill_id = required_skill.skill_id
            )
        )
        AND EXISTS (
          SELECT 1
          FROM technician_shifts shift
          WHERE shift.technician_id = t.id
            AND shift.working_period @>
              tstzrange($3::timestamptz, $4::timestamptz, '[)')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM technician_unavailability blocked
          WHERE blocked.technician_id = t.id
            AND blocked.blocked_period &&
              tstzrange($3::timestamptz, $4::timestamptz, '[)')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM appointments appointment
          WHERE appointment.dealership_id = $1
            AND appointment.technician_id = t.id
            AND appointment.status IN ('CONFIRMED', 'IN_PROGRESS')
            AND appointment.scheduled_period &&
              tstzrange($3::timestamptz, $4::timestamptz, '[)')
        )`;
  }

  private serviceBayCandidateQuery(): string {
    return `
      SELECT b.id
      FROM service_bays b
      INNER JOIN service_types service_type
        ON service_type.id = $2
       AND service_type.active = true
      WHERE b.dealership_id = $1
        AND b.active = true
        AND b.bay_type = service_type.required_bay_type
        AND NOT EXISTS (
          SELECT 1
          FROM service_bay_unavailability blocked
          WHERE blocked.service_bay_id = b.id
            AND blocked.blocked_period &&
              tstzrange($3::timestamptz, $4::timestamptz, '[)')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM appointments appointment
          WHERE appointment.dealership_id = $1
            AND appointment.service_bay_id = b.id
            AND appointment.status IN ('CONFIRMED', 'IN_PROGRESS')
            AND appointment.scheduled_period &&
              tstzrange($3::timestamptz, $4::timestamptz, '[)')
        )`;
  }
}
