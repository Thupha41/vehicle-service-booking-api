import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { CustomerEntity } from '../entities/customer.entity';
import { DealershipBusinessHoursEntity } from '../entities/dealership-business-hours.entity';
import { DealershipEntity } from '../entities/dealership.entity';
import { ServiceTypeEntity } from '../entities/service-type.entity';

/** Read-only query port owned by the Reference Data context. */
@Injectable()
export class ReferenceDataRepository {
  findActiveDealershipById(manager: EntityManager, id: string): Promise<DealershipEntity | null> {
    return manager.findOneBy(DealershipEntity, { id, active: true });
  }

  findBusinessHours(
    manager: EntityManager,
    dealershipId: string,
    isoWeekday: number,
  ): Promise<DealershipBusinessHoursEntity | null> {
    return manager.findOneBy(DealershipBusinessHoursEntity, {
      dealershipId,
      dayOfWeek: isoWeekday,
    });
  }

  findCustomerById(manager: EntityManager, id: string): Promise<CustomerEntity | null> {
    return manager.findOneBy(CustomerEntity, { id });
  }

  findActiveServiceTypeById(manager: EntityManager, id: string): Promise<ServiceTypeEntity | null> {
    return manager.findOneBy(ServiceTypeEntity, {
      id,
      active: true,
    });
  }
}
