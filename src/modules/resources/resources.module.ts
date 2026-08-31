import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ServiceBayUnavailabilityEntity } from './entities/service-bay-unavailability.entity';
import { ServiceBayEntity } from './entities/service-bay.entity';
import { TechnicianShiftEntity } from './entities/technician-shift.entity';
import { TechnicianSkillEntity } from './entities/technician-skill.entity';
import { TechnicianUnavailabilityEntity } from './entities/technician-unavailability.entity';
import { TechnicianEntity } from './entities/technician.entity';
import { ResourceAllocationRepository } from './repositories/resource-allocation.repository';

const entities = [
  TechnicianEntity,
  TechnicianSkillEntity,
  TechnicianShiftEntity,
  TechnicianUnavailabilityEntity,
  ServiceBayEntity,
  ServiceBayUnavailabilityEntity,
];

@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  providers: [ResourceAllocationRepository],
  exports: [TypeOrmModule, ResourceAllocationRepository],
})
export class ResourcesModule {}
