import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'technician_skills' })
export class TechnicianSkillEntity {
  @PrimaryColumn({ name: 'technician_id', type: 'uuid' })
  technicianId!: string;

  @PrimaryColumn({ name: 'skill_id', type: 'uuid' })
  skillId!: string;
}
