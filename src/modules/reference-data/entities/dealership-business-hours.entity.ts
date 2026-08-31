import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'dealership_business_hours' })
export class DealershipBusinessHoursEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'dealership_id', type: 'uuid' })
  dealershipId!: string;

  /** ISO weekday: Monday = 1, Sunday = 7. */
  @Column({ name: 'day_of_week', type: 'smallint' })
  dayOfWeek!: number;

  @Column({ name: 'opens_at', type: 'time' })
  opensAt!: string;

  @Column({ name: 'closes_at', type: 'time' })
  closesAt!: string;
}
