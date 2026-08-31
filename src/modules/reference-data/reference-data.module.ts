import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CustomerEntity } from './entities/customer.entity';
import { DealershipBusinessHoursEntity } from './entities/dealership-business-hours.entity';
import { DealershipEntity } from './entities/dealership.entity';
import { ServiceTypeRequiredSkillEntity } from './entities/service-type-required-skill.entity';
import { ServiceTypeEntity } from './entities/service-type.entity';
import { SkillEntity } from './entities/skill.entity';
import { ReferenceDataRepository } from './repositories/reference-data.repository';

const entities = [
  DealershipEntity,
  DealershipBusinessHoursEntity,
  CustomerEntity,
  ServiceTypeEntity,
  SkillEntity,
  ServiceTypeRequiredSkillEntity,
];

@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  providers: [ReferenceDataRepository],
  exports: [TypeOrmModule, ReferenceDataRepository],
})
export class ReferenceDataModule {}
