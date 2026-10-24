import mongoose, { type ClientSession } from 'mongoose';
import type { Config } from '../config';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';
import { gatewayFor, type GatewayCredentials, type PaymentGateway } from './gateway';
import { open } from './secretBox';
import type { AppServices } from '../services';

const { ObjectId } = mongoose.Schema.Types;

const gatewaySchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    gateway: { type: String, enum: ['stripe'], required: true },
    /** Sealed JSON `{ secretKey, webhookSecret }`; never returned by the API. */
    credentialsEncrypted: { type: String, required: true },
    /** Public by design: the web Payment Element needs it. */
    publishableKey: { type: String, required: true },
    accountId: { type: String, required: true },
    mode: { type: String, enum: ['test', 'live'], required: true },
    enabled: { type: Boolean, required: true },
  },
  { timestamps: true },
);
gatewaySchema.index({ ownerId: 1, gateway: 1 }, { unique: true });
gatewaySchema.plugin(tenantScoped);

export const PaymentGatewayAccount = mongoose.model('PaymentGatewayAccount', gatewaySchema, 'paymentGateways');
export type PaymentGatewayAccountDoc = InstanceType<typeof PaymentGatewayAccount>;

export const credentialsAad = (ownerId: string, gateway: string) => `${ownerId}:${gateway}`;

/** The owner's gateway row with decrypted credentials; null when absent, unknown or no encryption key. Ignores `enabled`. */
export async function loadGateway(
  ownerId: string,
  key: string,
  config: Config,
  services: AppServices,
  session?: ClientSession,
): Promise<{ row: PaymentGatewayAccountDoc; creds: GatewayCredentials; gateway: PaymentGateway } | null> {
  const gateway = gatewayFor(services, key);
  if (!gateway || !config.paymentsKey) return null;
  const row = await PaymentGatewayAccount.findOne({ ownerId, gateway: key }).session(session ?? null);
  if (!row) return null;
  const creds = JSON.parse(open(row.credentialsEncrypted, config.paymentsKey, credentialsAad(ownerId, key))) as GatewayCredentials;
  return { row, creds, gateway };
}
