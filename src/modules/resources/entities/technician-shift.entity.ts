import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'technician_shifts' })
export class TechnicianShiftEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId!: string;

  /** PostgreSQL canonical tstzrange text, always stored with [start, end) bounds. */
  @Column({ name: 'working_period', type: 'tstzrange' })
  workingPeriod!: string;
}
