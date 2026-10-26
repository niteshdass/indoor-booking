import mongoose, { type ClientSession } from 'mongoose';
import type { Config } from '../config';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';
import { gatewayFor, type GatewayCredentials, type PaymentGateway } from './gateway';
import { open } from './secretBox';
import type { AppServices } from '../services';

const { ObjectId } = mongoose.Schema.Types;

export const GATEWAY_MODES = ['test', 'live'] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

/** One mode's keys. Test and live keys of one Stripe account share its account id. */
const keySetSchema = new mongoose.Schema(
  {
    /** Sealed JSON `{ secretKey, webhookSecret }`; never returned by the API. */
    credentialsEncrypted: { type: String, required: true },
    /** Public by design: the web Payment Element needs it. */
    publishableKey: { type: String, required: true },
    accountId: { type: String, required: true },
  },
  { _id: false },
);

const gatewaySchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    gateway: { type: String, enum: ['stripe'], required: true },
    keys: {
      test: { type: keySetSchema, default: null },
      live: { type: keySetSchema, default: null },
    },
    /** The mode new payments are taken in; its keys are always present. */
    mode: { type: String, enum: GATEWAY_MODES, required: true },
    enabled: { type: Boolean, required: true },
  },
  { timestamps: true },
);
gatewaySchema.index({ ownerId: 1, gateway: 1 }, { unique: true });
gatewaySchema.plugin(tenantScoped);

export const PaymentGatewayAccount = mongoose.model('PaymentGatewayAccount', gatewaySchema, 'paymentGateways');
export type PaymentGatewayAccountDoc = InstanceType<typeof PaymentGatewayAccount>;

export const credentialsAad = (ownerId: string, gateway: string) => `${ownerId}:${gateway}`;

export type LoadedGateway = {
  row: PaymentGatewayAccountDoc;
  mode: GatewayMode;
  accountId: string;
  publishableKey: string;
  creds: GatewayCredentials;
  gateway: PaymentGateway;
};

/** Decrypts one mode's keys of a loaded row; null when that mode has none. */
export function unsealMode(row: PaymentGatewayAccountDoc, mode: GatewayMode, config: Config, gateway: PaymentGateway): LoadedGateway | null {
  const set = row.keys?.[mode];
  if (!set || !config.paymentsKey) return null;
  const creds = JSON.parse(open(set.credentialsEncrypted, config.paymentsKey, credentialsAad(String(row.ownerId), gateway.key))) as GatewayCredentials;
  return { row, mode, accountId: set.accountId, publishableKey: set.publishableKey, creds, gateway };
}

/**
 * The owner's gateway with one mode's decrypted keys: `mode` (a payment's own) or else the active one.
 * Null when absent, unknown, that mode has no keys, or no encryption key. Ignores `enabled`.
 */
export async function loadGateway(
  ownerId: string,
  key: string,
  config: Config,
  services: AppServices,
  opts: { mode?: GatewayMode | null; session?: ClientSession } = {},
): Promise<LoadedGateway | null> {
  const gateway = gatewayFor(services, key);
  if (!gateway || !config.paymentsKey) return null;
  const row = await PaymentGatewayAccount.findOne({ ownerId, gateway: key }).session(opts.session ?? null);
  if (!row) return null;
  return unsealMode(row, (opts.mode ?? row.mode) as GatewayMode, config, gateway);
}
