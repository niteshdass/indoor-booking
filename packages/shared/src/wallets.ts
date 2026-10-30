export const WALLET_PROVIDERS = ['bkash', 'nagad', 'rocket'] as const;
export type WalletProvider = (typeof WALLET_PROVIDERS)[number];

/** A mobile-wallet number the owner takes manual payments on. */
export type ManualWallet = {
  provider: WalletProvider;
  number: string;
  accountType: 'personal' | 'merchant' | 'agent';
  note?: string;
};

export type PaymentMethods = {
  manualWallets: ManualWallet[];
  gateways: Array<'stripe' | 'sslcommerz'>;
};

export const TRX_ID_PATTERN = /^[A-Z0-9]{8,12}$/;

/** Cleans a wallet transaction id the customer typed; null when it is not a valid TrxID. */
export function normalizeTrxId(raw: string): string | null {
  const id = raw.replace(/\s+/g, '').toUpperCase();
  return TRX_ID_PATTERN.test(id) ? id : null;
}
