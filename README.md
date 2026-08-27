# BOT RWA Valuator

BOT RWA Valuator is a small, client-side Web3 hackathon MVP for transparent real-world asset estimates and compact, verifiable records on BOT Chain.

## Included files

```text
index.html
style.css
app.js
RWAValuator.sol
package.json
.env.example
README.md
```

## What it does

- Supports Real Estate, Vehicle, Equipment, Agricultural Asset, and Invoice inputs.
- Runs all valuation calculations locally with clearly separated, editable rules in `app.js`.
- Produces an estimated value, risk score, confidence score, explanation, valuation factors, and deterministic SHA-256 report hash.
- Connects to MetaMask or another EVM-compatible browser wallet without charging for connection.
- Detects the current network and can request a switch to BOT Chain (chain ID `677`).
- Sends a real `recordValuation` transaction through `viem` only when the user approves it and a deployed contract address is configured.
- Waits for the actual BOT Chain transaction receipt before showing `Valuation recorded`.
- Reads the connected wallet's `ValuationRecorded` events and compares stored hashes for verification.

The application never fabricates a contract address, wallet address, balance, transaction hash, receipt, or blockchain history. If the contract address is empty, recording is disabled and the interface clearly says deployment is required. Full reports stay off-chain.

## Run locally

```bash
pnpm install
pnpm --filter @workspace/bot-rwa-valuator run dev
```

The local valuation and hash verification features work without a wallet or deployed contract.

## Deploy to Vercel

Import the repository into Vercel. The app is a static Vite build with no backend requirement. Set the Vercel environment variable `VITE_CONTRACT_ADDRESS` to the address of the deployed `RWAValuator` contract before building. The public BOT Chain RPC and explorer defaults are already in `app.js`.

## Deploy the contract

Compile and deploy `RWAValuator.sol` to BOT Chain using a Solidity toolchain and a deployer wallet. Never put a deployment private key in this frontend. After deployment, set the resulting address as `VITE_CONTRACT_ADDRESS`.

The contract stores only:

- Asset ID, asset type, and currency
- Estimated value
- Risk and confidence scores
- Report hash
- Submitter wallet and timestamp

It emits `ValuationRecorded` and exposes `getValuation(string assetId)`. It does not store private documents or large reports.

## Configuration

See `.env.example`:

```text
BOT_CHAIN_RPC=https://rpc.botchain.ai
BOT_CHAIN_ID=677
BOT_CHAIN_EXPLORER=https://scan.botchain.ai/
CONTRACT_ADDRESS=
VITE_CONTRACT_ADDRESS=
```

This is a local rule-based algorithmic estimate. It uses a transparent local rule-based algorithm; no external AI or LLM is required.