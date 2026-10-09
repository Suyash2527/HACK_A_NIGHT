# SakshyaRegistry deployment — Ethereum Sepolia testnet

| Field | Value |
|---|---|
| Contract address | `0x149A343Edc8da1edDb170E5308aBfe28C5BC4fDA` |
| Chain ID | 11155111 |
| Deployment tx | `0xc90fc3fe6ba5da6b5135d3f6a996c69fe3692451a9743a7c7919e4b0a6b7f553` |
| Block | 11878129 |
| Gas used / fee | 12938397 / 0.012938397 ETH |
| Deployer | `0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0` |
| Roles | admin `0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0`, recorder `0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0`, verifier `0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0` |
| Crypto profile 1 | `0x768416189f5d00e7a3b1f71bdcd569079e1cc1f4ef83590d23510497125a5b56` = sha256("Sakshya/v1;kem=ML-KEM-768(FIPS203);kdf=HKDF-SHA-256;aead=AES-256-GCM;sig=ML-DSA-65(FIPS204);hash=SHA-256;merkle=SHA-256-sorted-pairs,4096B-chunks") |
| ABI | `contracts/deployments/abi/SakshyaRegistry.json` |
| Explorer (tx) | https://sepolia.etherscan.io/tx/0xc90fc3fe6ba5da6b5135d3f6a996c69fe3692451a9743a7c7919e4b0a6b7f553 |
| Explorer (contract) | https://sepolia.etherscan.io/address/0x149A343Edc8da1edDb170E5308aBfe28C5BC4fDA |
| Deployed at | 2026-10-09T15:05:03.882Z |

Verify source:

```bash
npx hardhat verify --network sepolia 0x149A343Edc8da1edDb170E5308aBfe28C5BC4fDA 0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0 0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0 0x49e656b1E4D40d1c263F9FF05e56F336de99a8a0 0x768416189f5d00e7a3b1f71bdcd569079e1cc1f4ef83590d23510497125a5b56
```

Backend env:

```
QS_CHAIN=sepolia
QS_REGISTRY_ADDRESS=0x149A343Edc8da1edDb170E5308aBfe28C5BC4fDA
QS_REGISTRY_DEPLOY_BLOCK=11878129
```
