import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, reviewerName } from '../src';

describe('reviews', () => {
  it('reviewerName shortens to first name and last initial', () => {
    expect(reviewerName('Karim Hossain')).toBe('Karim H.');
    expect(reviewerName('  Anna  Maria   Petrova ')).toBe('Anna P.');
    expect(reviewerName('Олег Иванов')).toBe('Олег И.');
    expect(reviewerName('Madonna')).toBe('Madonna');
    expect(reviewerName('   ')).toBeNull();
    expect(reviewerName(null)).toBeNull();
  });

  it('review.manage is an owner and manager permission, not staff', () => {
    expect(PERMISSIONS).toContain('review.manage');
    expect(SYSTEM_ROLES.owner).toContain('review.manage');
    expect(SYSTEM_ROLES.manager).toContain('review.manage');
    expect(SYSTEM_ROLES.staff).not.toContain('review.manage');
  });
});
