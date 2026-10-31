import type { AppServices } from '../services';
import { stripeGateway } from './stripe';

export type GatewayCredentials = { secretKey: string; webhookSecret: string };

/** A refund as the gateway reports it; `refundRef` is null when it refused before creating one. */
export type GatewayRefund = { refundRef: string | null; status: 'pending' | 'succeeded' | 'failed'; failureCode: string | null };

/** A gateway webhook reduced to what the booking flow cares about. */
export type GatewayEvent = {
  id: string;
  type: string;
  /** Whether the gateway sent it from live mode (false for test mode). */
  livemode: boolean;
} & (
  | { kind: 'succeeded'; paymentId: string | null; gatewayRef: string; amount: number; currency: string }
  /** `gatewayRef`: the PaymentIntent, when the event is about one. */
  | { kind: 'attempt_failed'; paymentId: string | null; gatewayRef: string | null; failureCode: string | null }
  | { kind: 'closed'; paymentId: string | null; gatewayRef: string | null }
  | { kind: 'refund_updated'; refundRef: string; status: GatewayRefund['status']; failureCode: string | null }
  | { kind: 'ignored' }
);

export interface PaymentGateway {
  key: 'stripe';
  /** Whether this gateway can charge `currency` exactly (country is the account's concern). */
  supports(country: string, currency: string): boolean;
  verifyCredentials(c: GatewayCredentials): Promise<{ accountId: string }>;
  createPayment(
    c: GatewayCredentials,
    input: {
      kind: 'intent' | 'link';
      amount: number;
      currency: string;
      metadata: Record<string, string>;
      description: string;
      idempotencyKey: string;
      expiresAt?: Date;
      successUrl?: string;
    },
  ): Promise<{ gatewayRef: string | null; linkRef: string | null; clientSecret: string | null; url: string | null }>;
  /** Verifies the signature and normalizes the event; throws GatewayError('invalid_signature'). */
  handleWebhook(c: GatewayCredentials, rawBody: Buffer, signature: string | undefined): GatewayEvent;
  /** Cancels an open intent or expires an open link; no call when it never reached the gateway. */
  cancelPayment(
    c: GatewayCredentials,
    input: { kind: 'intent' | 'link'; gatewayRef: string | null; linkRef: string | null },
  ): Promise<void>;
  /**
   * A refusal that will not change on retry comes back as a failed refund with its code; anything
   * else (unreachable, 5xx) throws GatewayError('gateway_error'). `refundId` is stored on the gateway's refund.
   */
  refund(
    c: GatewayCredentials,
    input: { gatewayRef: string; amount: number; idempotencyKey: string; refundId: string },
  ): Promise<GatewayRefund>;
  /** The refund made for `refundId`, if the gateway has one (a call that timed out may still have landed). */
  findRefund(c: GatewayCredentials, input: { gatewayRef: string; refundId: string }): Promise<GatewayRefund | null>;
}

export type GatewayErrorCode = 'invalid_credentials' | 'invalid_signature' | 'gateway_error';

const MESSAGES: Record<GatewayErrorCode, string> = {
  invalid_credentials: 'The payment gateway rejected the credentials',
  invalid_signature: 'Invalid webhook signature',
  gateway_error: 'The payment gateway could not complete the request',
};

/** Fixed text only: never the provider's message, which could echo a key. */
export class GatewayError extends Error {
  constructor(public readonly code: GatewayErrorCode) {
    super(MESSAGES[code]);
    this.name = 'GatewayError';
  }
}

export function gatewayFor(services: AppServices, key: string): PaymentGateway | null {
  return key === 'stripe' ? stripeGateway(services.stripe) : null;
}
