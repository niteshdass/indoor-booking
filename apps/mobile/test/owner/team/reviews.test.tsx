import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES, type OwnerReviewJson } from '@booking/shared';
import ReviewsScreen from '../../../app/owner/[ownerId]/reviews';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  router: mockRouter,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return {
    ...actual,
    apiGet: (...a: unknown[]) => mockGet(...a),
    apiPost: (...a: unknown[]) => mockPost(...a),
    apiPut: (...a: unknown[]) => mockPut(...a),
  };
});

const review: OwnerReviewJson = {
  id: 'rv1',
  stars: 5,
  comment: 'Great turf, lights are bright.',
  reviewer: 'Fahim R.',
  createdAt: '2026-11-02T10:00:00.000Z',
  edited: false,
  reply: null,
  venueId: 'v1',
  bookingId: 'b1',
  reference: 'BK-1',
  flag: null,
  flagCleared: false,
  hidden: false,
};
const page = {
  reviews: [review],
  nextBefore: null,
  summary: [{ venueId: 'v1', name: 'Arena One', rating: { average: 4.6, count: 128 } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(page);
});

const renderReviews = (perms?: Parameters<typeof ownerValue>[0]) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <OwnerWrap value={ownerValue(perms)}>
        <ReviewsScreen />
      </OwnerWrap>
    </SafeAreaProvider>,
  );

describe('reviews', () => {
  it('shows the summary and reviews', async () => {
    await renderReviews();
    expect(await screen.findByText('Arena One · 4.6 ★ · 128 reviews')).toBeTruthy();
    expect(screen.getByText('Great turf, lights are bright.')).toBeTruthy();
  });

  it('filters by stars', async () => {
    await renderReviews();
    await fireEvent.press(await screen.findByRole('button', { name: '2 stars' }));
    await act(async () => {});
    expect(mockGet).toHaveBeenLastCalledWith('/owners/o1/reviews?stars=2');
  });

  it('posts a reply with PUT', async () => {
    mockPut.mockResolvedValue({
      review: { ...review, reply: { text: 'Thanks!', at: '', editedAt: null } },
    });
    await renderReviews();
    await fireEvent.press(await screen.findByRole('button', { name: 'Reply' }));
    await fireEvent.changeText(screen.getByLabelText('Your reply'), ' Thanks! ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save reply' }));
    await act(async () => {});
    expect(mockPut).toHaveBeenCalledWith('/owners/o1/reviews/rv1/reply', { text: 'Thanks!' });
    expect(screen.getByText('Thanks!')).toBeTruthy();
  });

  it('reports a review with a reason', async () => {
    mockPost.mockResolvedValue({ review: { ...review, flag: { at: '', reason: 'abuse' } } });
    await renderReviews();
    await fireEvent.press(await screen.findByRole('button', { name: 'Report' }));
    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), 'abuse');
    await fireEvent.press(screen.getByRole('button', { name: 'Flag review' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/reviews/rv1/flag', { reason: 'abuse' });
    expect(screen.getByText('Flagged, awaiting review')).toBeTruthy();
  });

  it('needs review.manage', async () => {
    await renderReviews({ perms: SYSTEM_ROLES.staff });
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
