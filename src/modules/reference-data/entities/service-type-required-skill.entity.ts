import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'service_type_required_skills' })
export class ServiceTypeRequiredSkillEntity {
  @PrimaryColumn({ name: 'service_type_id', type: 'uuid' })
  serviceTypeId!: string;

  @PrimaryColumn({ name: 'skill_id', type: 'uuid' })
  skillId!: string;
}
