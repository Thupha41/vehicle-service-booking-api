import { isWithinBusinessHours } from './business-hours';

describe('isWithinBusinessHours', () => {
  const hours = {
    timezone: 'Asia/Ho_Chi_Minh',
    opensAt: '08:00:00',
    closesAt: '17:00:00',
  };

  it('accepts a period fully contained by local dealership hours', () => {
    expect(
      isWithinBusinessHours(
        new Date('2030-01-07T02:00:00.000Z'),
        new Date('2030-01-07T03:30:00.000Z'),
        hours,
      ),
    ).toBe(true);
  });

  it('rejects a period whose end exceeds closing time', () => {
    expect(
      isWithinBusinessHours(
        new Date('2030-01-07T09:30:00.000Z'),
        new Date('2030-01-07T10:30:00.000Z'),
        hours,
      ),
    ).toBe(false);
  });

  it('rejects a period spanning two local calendar days', () => {
    expect(
      isWithinBusinessHours(
        new Date('2030-01-07T16:30:00.000Z'),
        new Date('2030-01-07T17:30:00.000Z'),
        { ...hours, opensAt: '00:00:00', closesAt: '23:59:59' },
      ),
    ).toBe(false);
  });
});
