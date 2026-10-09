import { expect } from "chai";
import {
  assertChainId,
  assertMainnetAllowed,
  ChainConfigError,
  CHAINS,
  chainById,
  MAINNET_ACK,
  resolveChain,
} from "../config/networks.ts";
import { profileForNetwork } from "../scripts/lib/preflight.ts";

describe("network config & mainnet guard", () => {
  it("Amoy profile: chain 80002, POL, env-configurable RPC", () => {
    expect(CHAINS.amoy.chainId).to.equal(80002);
    expect(CHAINS.amoy.nativeToken).to.equal("POL");
    expect(resolveChain({ QS_CHAIN: "amoy" }).rpcUrl).to.equal("https://polygon-amoy.drpc.org");
    expect(resolveChain({ QS_CHAIN: "amoy", AMOY_RPC_URL: "https://my.rpc" }).rpcUrl).to.equal("https://my.rpc");
  });

  it("Sepolia profile: chain 11155111, ETH, Etherscan explorer, not a mainnet", () => {
    expect(CHAINS.sepolia.chainId).to.equal(11155111);
    expect(CHAINS.sepolia.nativeToken).to.equal("ETH");
    expect(CHAINS.sepolia.explorerUrl).to.equal("https://sepolia.etherscan.io");
    expect(CHAINS.sepolia.isMainnet).to.equal(false);
    expect(resolveChain({ QS_CHAIN: "sepolia" }).chainId).to.equal(11155111);
    expect(chainById(11155111)?.key).to.equal("sepolia");
    expect(profileForNetwork("sepolia").chainId).to.equal(11155111);
    expect(() => assertChainId(CHAINS.sepolia, 1n)).to.throw(ChainConfigError, /expects 11155111/);
  });

  it("defaults to the local chain", () => {
    expect(resolveChain({}).chainId).to.equal(31337);
  });

  it("refuses mainnet without BOTH the acknowledgement and NODE_ENV=production", () => {
    expect(() => resolveChain({ QS_CHAIN: "polygon" })).to.throw(ChainConfigError, /Refusing/);
    expect(() => resolveChain({ QS_CHAIN: "polygon", QS_ALLOW_MAINNET: MAINNET_ACK })).to.throw(ChainConfigError);
    expect(() => resolveChain({ QS_CHAIN: "polygon", NODE_ENV: "production" })).to.throw(ChainConfigError);
    expect(() => resolveChain({ QS_CHAIN: "polygon", QS_ALLOW_MAINNET: "yes", NODE_ENV: "production" })).to.throw(ChainConfigError);
    expect(resolveChain({ QS_CHAIN: "polygon", QS_ALLOW_MAINNET: MAINNET_ACK, NODE_ENV: "production" }).chainId).to.equal(137);
  });

  it("never blocks testnets", () => {
    expect(() => assertMainnetAllowed(CHAINS.amoy, {})).to.not.throw();
    expect(() => assertMainnetAllowed(CHAINS.local, {})).to.not.throw();
  });

  it("rejects unknown chains and mismatched chain IDs", () => {
    expect(() => resolveChain({ QS_CHAIN: "goerli" })).to.throw(ChainConfigError, /Unknown chain/);
    expect(() => assertChainId(CHAINS.amoy, 137n)).to.throw(ChainConfigError, /expects 80002/);
    expect(() => assertChainId(CHAINS.amoy, 80002n)).to.not.throw();
    expect(chainById(80002)?.key).to.equal("amoy");
  });

  it("maps Hardhat network names to chain profiles", () => {
    expect(profileForNetwork("amoy").chainId).to.equal(80002);
    expect(profileForNetwork("hardhatMainnet").key).to.equal("local"); // in-process EDR, not Polygon
    expect(() => profileForNetwork("goerli")).to.throw();
  });
});
