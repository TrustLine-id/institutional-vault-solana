# Trustline Web SDK (Solana)

TypeScript SDK to integrate Trustline Solana verification in any frontend (React, Vue, Next.js, or plain browser apps).

## Installation

```sh
npm install @trustline.id/websdk-solana
```

## Quick Start

```ts
import { trustline } from '@trustline.id/websdk-solana';

trustline.init({
  clientId: 'YOUR_CLIENT_ID',
  apiUrl: 'https://api.trustline.id/api/v0', // optional
  loginUri: 'https://yourapp.com/auth/trustline/callback', // optional
});

const result = await trustline.validate({
  chainId: 103,
  subject: 'SUBJECT_WALLET_PUBKEY',
  scope: 'VAULT_PUBKEY',
  protectedProgram: 'PROTECTED_PROGRAM_ID',
  instruction: txInstruction, // TransactionInstruction from @solana/web3.js
  validationMode: null, // optional
  approvalRequired: false, // optional
});

if ('result' in result) {
  console.log(result.result);
}
```

If `openSessionSolana` returns `authRequired: true` and no JWT is provided, `validate()` automatically opens the Trustline auth UI flow and then continues with `validateSolana`.

## API

### `trustline.init(options)`

```ts
trustline.init({
  clientId: string,
  apiUrl?: string,
});
```

### `trustline.openSessionSolana(params)`

Calls backend `openSessionSolana`.

```ts
const open = await trustline.openSessionSolana({
  chainId: 103,
  subject: '...',
  scope: '...',
  protectedProgram: '...',
  instruction: txInstruction,
  validationMode: null,
  approvalRequired: false,
});
```

### `trustline.validateSolana({ sessionId }, jwt?)`

Calls backend `validateSolana` using a session created by `openSessionSolana`.

```ts
const validate = await trustline.validateSolana({ sessionId: '...' }, 'OPTIONAL_JWT');
```

### `trustline.validate(params)`

Convenience helper that executes both steps:
1. `openSessionSolana`
2. `validateSolana`

Pass the same params as `openSessionSolana` plus optional `jwt`.

You can also pass JWT as second arg for compatibility:

```ts
await trustline.validate(params, jwt);
```

### `buildInstructionPayload(instruction)`

If needed, you can explicitly convert a `TransactionInstruction` into the payload used by Trustline:

```ts
import { buildInstructionPayload } from '@trustline.id/websdk-solana';

const instruction = buildInstructionPayload(txInstruction);
```

## Notes

- `instruction` can be either:
  - a `TransactionInstruction`-like object (recommended), or
  - a prebuilt payload `{ data, accounts }`.
- `instruction.accounts` must contain only the protected instruction account metas (exclude trailing runtime Trustline accounts).
- Account order and signer/writable flags must match the final Solana instruction exactly.
- This package is now Solana-first and does not include EVM-specific policy/EIP-712 helpers.
