import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'service_bay_unavailability' })
export class ServiceBayUnavailabilityEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'service_bay_id', type: 'uuid' })
  serviceBayId!: string;

  @Column({ name: 'blocked_period', type: 'tstzrange' })
  blockedPeriod!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;
}
