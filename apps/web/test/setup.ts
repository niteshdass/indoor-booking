import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetSports } from '../src/lib/sports';

afterEach(cleanup);
// Each test sees the full catalog unless it mocks GET /sports.
afterEach(resetSports);
