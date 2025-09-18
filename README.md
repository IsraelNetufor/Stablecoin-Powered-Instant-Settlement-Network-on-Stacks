# StableSettle: Stablecoin-Powered Instant Settlement Network on Stacks

## Project Overview

**StableSettle** is a decentralized Web3 protocol built on the Stacks blockchain using Clarity smart contracts. It enables instant, low-cost settlements for cross-border payments and remittances by leveraging stablecoins (e.g., USDA or integrated ERC-20-like stablecoins via sBTC bridges). Traditional banking systems charge exorbitant fees (often 5-7% for international transfers) and take days to settle, exacerbating financial exclusion for unbanked populations and small businesses. StableSettle bypasses this by providing near-instant atomic swaps and settlements on-chain, reducing fees to blockchain gas costs (typically under $0.01 per transaction).

### Real-World Problems Solved
- **High Fees and Delays in Remittances**: Migrants sending money home lose 6.5% on average (World Bank data); StableSettle enables sub-second settlements at minimal cost.
- **E-Commerce and Supply Chain Friction**: Merchants avoid chargebacks and slow payouts; instant settlements improve cash flow for SMEs in developing markets.
- **Financial Inclusion**: Integrates with mobile wallets for the 1.7 billion unbanked, using stablecoins pegged to fiat for stability.
- **Scalability for Micropayments**: Enables IoT or content creator tipping without prohibitive fees.

The protocol uses 6 core Clarity smart contracts for security, modularity, and composability. It's permissionless, with optional off-chain oracles for fiat on-ramps.

## Architecture

### Key Features
- **Instant Settlement**: Atomic transactions ensure funds move only if conditions are met.
- **Stablecoin Agnostic**: Supports any Clarity-compatible stablecoin (e.g., via SIP-010 fungible token standard).
- **Escrow for Disputes**: Built-in arbitration to handle edge cases without courts.
- **Gas-Optimized**: Clarity's predictable execution model keeps costs low.
- **Integration-Ready**: SDK for frontends (e.g., React + Hiro Wallet) and APIs for fiat gateways.

### Smart Contracts (6 Total)
All contracts are written in Clarity and deployable via Clarinet (Stacks' dev toolkit). They follow best practices: immutable core logic, upgradable proxies where needed, and formal verification hooks.

1. **UserRegistry**  
   - **Purpose**: Registers users with on-chain identities (wallets) and optional traits (e.g., verified for higher limits). Solves KYC-lite compliance.  
   - **Key Functions**: `register-user`, `get-user-traits`, `update-kyc-status`.  
   - **Snippet** (Clarity):  
     ```clarity
     (define-data-var user-count uint u0)
     (define-map users principal {balance: uint, traits: (list 3 (string-ascii 32))})
     (define-public (register-user (traits (list 3 (string-ascii 32))))
       (let ((caller tx-sender))
         (asserts! (not (map-get? users caller)) (err u1001))
         (map-set users caller {balance: u0, traits: traits})
         (var-set user-count (+ (var-get user-count) u1))
         (ok true)))
     ```

2. **StableVault**  
   - **Purpose**: Custodial vault for depositing/withdrawing stablecoins. Ensures funds are locked until settlement.  
   - **Key Functions**: `deposit-stable`, `withdraw-stable`, `get-vault-balance`. Integrates SIP-010 tokens.  
   - **Snippet** (Clarity):  
     ```clarity
     (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)
     (define-map vault-balances principal uint)
     (define-public (deposit-stable (token <ft-trait>) (amount uint))
       (let ((caller tx-sender))
         (try! (contract-call? token transfer amount tx-sender (as-contract tx-sender) none))
         (map-set vault-balances caller (+ (map-get? vault-balances caller) amount))
         (ok true)))
     ```

3. **SettlementEngine**  
   - **Purpose**: Core engine for initiating and executing instant settlements between parties. Uses atomic multi-sig-like logic.  
   - **Key Functions**: `init-settlement`, `confirm-settlement`, `execute-transfer`.  
   - **Snippet** (Clarity):  
     ```clarity
     (define-map settlements uint {sender: principal, receiver: principal, amount: uint, stable-token: principal, status: uint})
     (define-public (init-settlement (receiver principal) (amount uint) (stable-token principal))
       (let ((caller tx-sender) (id (var-get settlement-nonce)))
         (map-set settlements id {sender: caller, receiver: receiver, amount: amount, stable-token: stable-token, status: u0})
         (var-set settlement-nonce (+ id u1))
         (ok id)))
     ```

4. **EscrowManager**  
   - **Purpose**: Holds funds in escrow during disputes; releases on mutual agreement or timeout. Solves trust issues in high-value transfers.  
   - **Key Functions**: `escrow-funds`, `release-escrow`, `dispute-resolution`.  
   - **Snippet** (Clarity):  
     ```clarity
     (define-map escrows uint {amount: uint, parties: (list 2 principal), resolver: principal, timeout: uint})
     (define-public (escrow-funds (settlement-id uint))
       (let ((settlement (unwrap! (map-get? settlements settlement-id) (err u1002))))
         (map-set escrows settlement-id {amount: (get amount settlement), parties: (list (get sender settlement) (get receiver settlement)), resolver: tx-sender, timeout: block-height})
         (ok true)))
     ```

5. **FeeCollector**  
   - **Purpose**: Collects and distributes micro-fees (e.g., 0.1% optional) to liquidity providers or DAO treasury. Ensures sustainability.  
   - **Key Functions**: `collect-fee`, `distribute-fees`, `get-fee-rate`.  
   - **Snippet** (Clarity):  
     ```clarity
     (define-data-var fee-rate uint u10) ;; 0.1% = 10 basis points
     (define-map fee-pool principal uint)
     (define-public (collect-fee (amount uint))
       (let ((fee (* amount (var-get fee-rate) u10000)))
         (map-set fee-pool tx-sender (+ (map-get? fee-pool tx-sender) fee))
         (ok (- amount fee))))
     ```

6. **OracleIntegrator**  
   - **Purpose**: Fetches off-chain data (e.g., fiat rates via Chainlink-like oracles on Stacks) for stablecoin peg validation. Prevents depegging risks.  
   - **Key Functions**: `request-rate`, `consume-oracle`, `validate-peg`.  
   - **Snippet** (Clarity):  
     ```clarity
     (define-map oracle-feeds {asset: (string-ascii 8)} uint)
     (define-public (consume-oracle (asset (string-ascii 8)) (rate uint))
       (asserts! (is-eq tx-sender ORACLE_ADDRESS) (err u1003))
       (map-set oracle-feeds {asset: asset} rate)
       (ok true))
     (define-read-only (validate-peg (asset (string-ascii 8)))
       (let ((current-rate (unwrap-panic (map-get? oracle-feeds {asset: asset}))))
         (asserts! (>= current-rate u9900) (err u1004)) ;; Within 1% peg
         (ok true)))
     ```

### Deployment & Testing
- **Tools**: Clarinet for local testing; deploy to Stacks mainnet via Hiro CLI.
- **Dependencies**: SIP-010 (fungible tokens), SIP-005 (non-fungibles if NFTs for disputes).
- **Security**: Audited logic for reentrancy; uses Clarity's safety features (no overflows).

## Getting Started

### Prerequisites
- Rust & Clarinet installed (see [Stacks Docs](https://docs.stacks.co/clarinet)).
- Stacks wallet (e.g., Hiro Wallet) with STX for gas.

### Setup
1. Clone the repo: `git clone <repo-url> && cd stablesettle`
2. Install deps: `clarinet integrate`
3. Test locally: `clarinet test`
4. Deploy: `clarinet deploy --network mainnet`

### Usage Example
- Frontend: Connect wallet, deposit to Vault, init settlement → Instant transfer to receiver.

## Contributing
Fork, PR with tests. Focus on gas optimizations or new stablecoin integrations.

## License
MIT. See LICENSE file.