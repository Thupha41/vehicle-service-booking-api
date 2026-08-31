import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'skills' })
export class SkillEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;
}
