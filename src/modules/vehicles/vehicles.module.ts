import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleRepository } from './repositories/vehicle.repository';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleEntity])],
  providers: [VehicleRepository],
  exports: [TypeOrmModule, VehicleRepository],
})
export class VehiclesModule {}
