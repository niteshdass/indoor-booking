import type { AppServices } from '../services';
import { sslcommerzGateway } from './sslcommerz';
import { stripeGateway } from './stripe';

export const GATEWAY_KEYS = ['stripe', 'sslcommerz'] as const;
export type GatewayKey = (typeof GATEWAY_KEYS)[number];

export type StripeCredentials = { secretKey: string; webhookSecret: string };
/** `live` picks the endpoints: false is the SSLCommerz sandbox. */
export type SslcommerzCredentials = { storeId: string; storePassword: string; live: boolean };
/** Sealed per gateway; each adapter reads its own shape. */
export type GatewayCredentials = StripeCredentials | SslcommerzCredentials;

/** What a webhook delivery carries: the raw body (signatures cover the exact bytes) and its headers. */
export type WebhookDelivery = { rawBody: Buffer; header(name: string): string | undefined };

/** A refund as the gateway reports it; `refundRef` is null when it refused before creating one. */
export type GatewayRefund = { refundRef: string | null; status: 'pending' | 'succeeded' | 'failed'; failureCode: string | null };

/** `won` also covers an inquiry that closed without becoming a dispute: the money stayed. */
export const DISPUTE_STATUSES = ['open', 'won', 'lost'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

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
  /** The charge behind PaymentIntent `gatewayRef` now has `amountRefunded` refunded in all, ours and any made at the gateway. */
  | { kind: 'charge_refunded'; gatewayRef: string | null; amountRefunded: number; currency: string }
  /** A cardholder disputed the charge behind PaymentIntent `gatewayRef`, or the dispute closed. */
  | {
      kind: 'dispute';
      disputeRef: string;
      gatewayRef: string | null;
      status: DisputeStatus;
      amount: number;
      currency: string;
      reason: string | null;
    }
  | { kind: 'ignored' }
);

export interface PaymentGateway {
  key: GatewayKey;
  /** Whether the player is sent to the gateway's own page (no in-app element, no client secret). */
  hosted: boolean;
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
      /** Hosted gateways: where the player's browser comes back to (`result` is added) and where notices go. */
      returnUrl?: string;
      notifyUrl?: string;
      customer?: { name: string; email: string | null; phone: string | null };
    },
  ): Promise<{ gatewayRef: string | null; linkRef: string | null; clientSecret: string | null; url: string | null }>;
  /**
   * Verifies the delivery (a signature, or a call back to the gateway) and normalizes the event;
   * throws GatewayError('invalid_signature') when these credentials cannot vouch for it.
   */
  handleWebhook(c: GatewayCredentials, delivery: WebhookDelivery): Promise<GatewayEvent>;
  /**
   * Asks the gateway what became of payment `paymentId` (for a missed notification): a `succeeded`
   * event when it was paid, `closed` when it never will be, null while it may still be. Only gateways
   * that can lose notifications implement it.
   */
  lookupPayment?(c: GatewayCredentials, input: { paymentId: string; currency: string }): Promise<GatewayEvent | null>;
  /**
   * Cancels an open intent or expires an open link; no call when it never reached the gateway.
   * Throws GatewayError when the payment cannot be stopped (already paid).
   */
  cancelPayment(
    c: GatewayCredentials,
    input: { kind: 'intent' | 'link'; paymentId: string; gatewayRef: string | null; linkRef: string | null },
  ): Promise<void>;
  /**
   * A refusal that will not change on retry comes back as a failed refund with its code; anything
   * else (unreachable, 5xx) throws GatewayError('gateway_error'). `refundId` is stored on the gateway's refund.
   */
  refund(
    c: GatewayCredentials,
    input: { gatewayRef: string; amount: number; currency: string; idempotencyKey: string; refundId: string },
  ): Promise<GatewayRefund>;
  /**
   * The refund made for `refundId`, if the gateway has one (a call that timed out may still have landed).
   * `refundRef` is the gateway's id for it once known.
   */
  findRefund(c: GatewayCredentials, input: { gatewayRef: string; refundId: string; refundRef: string | null }): Promise<GatewayRefund | null>;
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
  if (key === 'stripe') return stripeGateway(services.stripe);
  if (key === 'sslcommerz') return sslcommerzGateway(services.sslcommerz);
  return null;
}
