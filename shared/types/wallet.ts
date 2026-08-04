export interface WalletLedgerEntry {
    id: number;
    amount: number;
    reason: string;
    createdAt: string;
}

export interface WalletOverviewResponse {
    balance: number;
    ledger: WalletLedgerEntry[];
}
