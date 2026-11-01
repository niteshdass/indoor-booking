import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { resetSports } from '../src/lib/sports';

// findBy*/waitFor give up after 1s by default, which the full run (API suite alongside) can exceed.
configure({ asyncUtilTimeout: 5000 });

afterEach(cleanup);
// Each test sees the full catalog unless it mocks GET /sports.
afterEach(resetSports);
