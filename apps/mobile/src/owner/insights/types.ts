import type { BookingStatus } from '@booking/shared';
import type { OwnerBooking } from '../types';

export const OVERVIEW_DAYS = [7, 30, 90] as const;
export type OverviewDays = (typeof OVERVIEW_DAYS)[number];

export type Kpi = { value: number; previous: number };

export type OverviewDay = {
  date: string;
  online: number;
  walkin: number;
  bookings: number;
  minutes: number;
  previous: { revenue: number; bookings: number; minutes: number };
};

/** GET /owners/:ownerId/reports/overview. Money in minor units of `currency`. */
export type Overview = {
  range: { from: string; to: string; days: number; previous: { from: string; to: string } };
  currency: string;
  timezone: string;
  /** Platform fees owed for the period (revenue is already net of them). */
  platformFees: number;
  kpis: Record<'revenue' | 'bookings' | 'minutes' | 'utilization' | 'averageBooking' | 'cancellationRate', Kpi>;
  daily: OverviewDay[];
  mix: { courts: number; addons: number; cancellationFees: number; collected: number; outstanding: number };
  /** Booked hours, Monday first, by local start hour. */
  heatmap: number[][];
  courts: { id: string; name: string; revenue: number; bookings: number; minutes: number; openMinutes: number; previousRevenue: number }[];
  statuses: Partial<Record<BookingStatus, number>>;
  players: { value: number; previous: number; newValue: number; newPrevious: number };
  methods: { method: 'card' | 'cash' | 'wallet'; amount: number; count: number }[];
  recent: OwnerBooking[];
};
