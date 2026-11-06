import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultZoneFor } from '../../src/lib/regions';

const browserZone = (zone: string) =>
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...new Intl.DateTimeFormat().resolvedOptions(),
    timeZone: zone,
  });

afterEach(() => vi.restoreAllMocks());

describe('defaultZoneFor', () => {
  it("keeps the browser's zone when it belongs to the venue's country", () => {
    browserZone('Asia/Dhaka');
    expect(defaultZoneFor('BD')).toBe('Asia/Dhaka');
  });

  it("uses the country's zone for an owner setting up from abroad", () => {
    browserZone('Europe/London');
    expect(defaultZoneFor('BD')).toBe('Asia/Dhaka');
    expect(defaultZoneFor('IN')).toBe('Asia/Kolkata');
  });
});
