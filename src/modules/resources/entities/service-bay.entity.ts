import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'service_bays' })
export class ServiceBayEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'dealership_id', type: 'uuid' })
  dealershipId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'bay_type', type: 'varchar', length: 40 })
  bayType!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
