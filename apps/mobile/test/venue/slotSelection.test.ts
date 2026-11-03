import { toggleSlot, type SlotJson } from '@booking/shared';

// The selection rules are tested in packages/shared; this pins that the app gets them from there.
const slot = (i: number, status: SlotJson['status'] = 'available'): SlotJson => ({
  startAt: `2026-11-05T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
  endAt: `2026-11-05T${String(11 + i).padStart(2, '0')}:00:00.000Z`,
  localStart: '',
  localEnd: '',
  price: 1000,
  status,
});

describe('shared slot selection', () => {
  const slots = [slot(0), slot(1, 'booked'), slot(2), slot(3)];
  it('extends a run with an adjacent slot and restarts on a gap', () => {
    expect(toggleSlot(slots, [slots[2]!.startAt], slots[3]!.startAt)).toEqual([slots[2]!.startAt, slots[3]!.startAt]);
    expect(toggleSlot(slots, [slots[0]!.startAt], slots[2]!.startAt)).toEqual([slots[2]!.startAt]);
  });
  it('ignores a booked slot', () => {
    expect(toggleSlot(slots, [], slots[1]!.startAt)).toEqual([]);
  });
});
