import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'technicians' })
export class TechnicianEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'dealership_id', type: 'uuid' })
  dealershipId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
