import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { VehicleEntity } from '../entities/vehicle.entity';

/** Read-only query port owned by the Vehicle context. */
@Injectable()
export class VehicleRepository {
  findById(manager: EntityManager, id: string): Promise<VehicleEntity | null> {
    return manager.findOneBy(VehicleEntity, { id });
  }
}
