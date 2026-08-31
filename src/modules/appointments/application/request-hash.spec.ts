import { createBookingRequestHash } from './request-hash';

describe('createBookingRequestHash', () => {
  const baseRequest = {
    customerId: '11111111-1111-4111-8111-111111111111',
    vehicleId: '22222222-2222-4222-8222-222222222222',
    dealershipId: '33333333-3333-4333-8333-333333333333',
    serviceTypeId: '44444444-4444-4444-8444-444444444444',
    desiredStartAt: '2030-01-07T09:00:00+07:00',
  };

  it('is deterministic', () => {
    expect(createBookingRequestHash(baseRequest)).toBe(
      createBookingRequestHash({ ...baseRequest }),
    );
  });

  it('normalizes equivalent instants before hashing', () => {
    expect(createBookingRequestHash(baseRequest)).toBe(
      createBookingRequestHash({
        ...baseRequest,
        desiredStartAt: '2030-01-07T02:00:00Z',
      }),
    );
  });

  it('changes when booking identity changes', () => {
    expect(createBookingRequestHash(baseRequest)).not.toBe(
      createBookingRequestHash({
        ...baseRequest,
        vehicleId: '55555555-5555-4555-8555-555555555555',
      }),
    );
  });
});
