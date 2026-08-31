import { Module } from '@nestjs/common';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ResourcesModule } from '../resources/resources.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { AppointmentsService } from './application/appointments.service';
import { AppointmentsController } from './appointments.controller';

@Module({
  imports: [ReferenceDataModule, VehiclesModule, ResourcesModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
