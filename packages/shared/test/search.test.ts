import { describe, it, expect } from 'vitest';
import { EMPTY_CRITERIA, MAX_SEARCH_TEXT, apiQuery, criteriaToParams } from '../src/search';

describe('criteriaToParams search text', () => {
  it('sends trimmed text as q and leaves blank text out', () => {
    expect(criteriaToParams({ ...EMPTY_CRITERIA, text: '  Golden Arena ' }).get('q')).toBe('Golden Arena');
    expect(criteriaToParams({ ...EMPTY_CRITERIA, text: '   ' }).has('q')).toBe(false);
    expect(apiQuery(EMPTY_CRITERIA, 0)).toBe('?limit=20&cursor=0');
  });

  it('cuts text to the length the API accepts', () => {
    expect(criteriaToParams({ ...EMPTY_CRITERIA, text: 'x'.repeat(MAX_SEARCH_TEXT + 5) }).get('q')).toHaveLength(MAX_SEARCH_TEXT);
  });
});
