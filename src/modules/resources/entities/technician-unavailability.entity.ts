import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'technician_unavailability' })
export class TechnicianUnavailabilityEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId!: string;

  @Column({ name: 'blocked_period', type: 'tstzrange' })
  blockedPeriod!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;
}
