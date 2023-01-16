import {
  Address,
  BigDecimal,
  BigInt,
  ethereum,
  store,
} from "@graphprotocol/graph-ts";
import {
  // ERC1155Contract,
  // OptionSettlementEngine,
  // EngineDailyMetrics,
  Transaction,
  Account,
  Token,
  OptionSettlementEngine as OSE,
  // DailyTokenMetrics,
  DailyTokenMetrics,
  DailyOSEMetrics,
} from "../../generated/schema";
import { OptionSettlementEngine } from "../../generated/OptionSettlementEngine/OptionSettlementEngine";
import { loadOrInitializeToken } from "./tokens";

export * from "./tokens";

// Retrieves or creates a daily data entity for tracking Volume and TVL.
// Code adapted from https://github.com/Uniswap/v3-subgraph/blob/bf03f940f17c3d32ee58bd37386f26713cff21e2/src/utils/intervalUpdates.ts#L23
// export function updateEngineDailyMetrics(
//   event: ethereum.Event
// ): EngineDailyMetrics {
//   let valorem = ERC1155Contract.load(
//     event.address.toHexString()
//   ) as ERC1155Contract;

//   let timestamp = event.block.timestamp.toI32();

//   let dayID = timestamp / 86400;
//   let dayStartTimestamp = dayID * 86400;

//   let EngineDailyMetrics = EngineDailyMetrics.load(dayID.toString());

//   if (EngineDailyMetrics === null) {
//     EngineDailyMetrics = new EngineDailyMetrics(dayID.toString());
//     EngineDailyMetrics.date = dayStartTimestamp;
//     // EngineDailyMetrics.totalValueLockedUSD = BigDecimal.zero(); // TODO REMOVE
//     EngineDailyMetrics.volumeUSD = BigDecimal.zero();
//     EngineDailyMetrics.feesAccrued = BigDecimal.zero();
//     EngineDailyMetrics.feesSwept = BigDecimal.zero();
//   }

//   // EngineDailyMetrics.totalValueLockedUSD = valorem.totalValueLockedUSD; // TODO REMOVE

//   EngineDailyMetrics.save();

//   return EngineDailyMetrics;
// }

export function loadOrInitializeOptionSettlementEngine(
  contractAddress: string
): OSE {
  let ose = OSE.load(contractAddress);

  if (ose === null) {
    const optionSettlementEngine = OptionSettlementEngine.bind(
      Address.fromString(contractAddress)
    );
    let initialFeeToAddress = optionSettlementEngine.feeTo().toHexString();
    ose = new OSE(contractAddress);
    ose.feeToAddress = initialFeeToAddress;
    ose.feesEnabled = false;
    ose.save();
  }

  return ose;
}

export function loadOrInitializeTransaction(txHash: string): Transaction {
  let tx = Transaction.load(txHash);
  if (tx) return tx;

  // init
  tx = new Transaction(txHash);
  tx.save();
  return tx;
}

export function checkForDuplicateTransferSingleOrBatch(
  txHash: string
): Transaction {
  // create Transaction entity to check against Transfers
  const tx = loadOrInitializeTransaction(txHash);
  if (tx.transferTx) {
    if ((tx.transferTx as string[])[0]) {
      store.remove("ERC1155Transfer", (tx.transferTx as string[])[0]);
    }
  }

  return tx;
}

export function loadOrInitializeAccount(address: string): Account {
  let account = Account.load(address);
  if (account) return account;

  // init
  account = new Account(address);
  account.optionIDsOwned = new Array<string>();
  account.save();
  return account;
}

export function getBeginningOfDay(timestamp: BigInt): Date {
  const dayStartTimestamp = (timestamp.toI32() / 86400) * 86400;
  const dayStartMilliseconds = dayStartTimestamp * 1000;
  return new Date(dayStartMilliseconds);
}

export function loadOrInitializeDailyTokenMetrics(
  tokenAddress: string,
  timestamp: BigInt
): DailyTokenMetrics {
  const day = getBeginningOfDay(timestamp);
  const dateUnix = BigInt.fromI64(day.getTime());

  let tokenMetrics = DailyTokenMetrics.load(`${tokenAddress}-${dateUnix}`);
  if (tokenMetrics) return tokenMetrics;

  // init
  const token = loadOrInitializeToken(tokenAddress);
  const dailyOSEMetrics = loadOrInitializeDailyOSEMetrics(timestamp);

  tokenMetrics = new DailyTokenMetrics(`${tokenAddress}-${dateUnix}`);
  tokenMetrics.dateUnix = dateUnix;
  tokenMetrics.dateISO = day.toISOString();
  tokenMetrics.tvl = token.tvl;
  tokenMetrics.notionalVolWritten = BigInt.fromI32(0);
  tokenMetrics.notionalVolExercised = BigInt.fromI32(0);
  tokenMetrics.notionalVolRedeemed = BigInt.fromI32(0);
  tokenMetrics.notionalVolTransferred = BigInt.fromI32(0);
  tokenMetrics.notionalVolSum = BigInt.fromI32(0);
  tokenMetrics.notionalVolSettled = BigInt.fromI32(0);
  tokenMetrics.notionalVolFeesAccrued = BigInt.fromI32(0);
  tokenMetrics.notionalVolFeesSwept = BigInt.fromI32(0);
  tokenMetrics.notionalVolWrittenUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolExercisedUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolRedeemedUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolTransferredUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolSumUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolSettledUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolFeesAccruedUSD = BigDecimal.fromString("0");
  tokenMetrics.notionalVolFeesSweptUSD = BigDecimal.fromString("0");
  tokenMetrics.token = token.id;
  tokenMetrics.dailyOSEMetrics = dailyOSEMetrics.id;
  tokenMetrics.save();

  return tokenMetrics;
}

export function loadOrInitializeDailyOSEMetrics(
  timestamp: BigInt
): DailyOSEMetrics {
  const day = getBeginningOfDay(timestamp);
  const dateUnix = BigInt.fromI64(day.getTime());

  let oseMetrics = DailyOSEMetrics.load(`OSE-${dateUnix}`);
  if (oseMetrics) return oseMetrics;

  // init
  oseMetrics = new DailyOSEMetrics(`OSE-${dateUnix}`);
  oseMetrics.dateUnix = dateUnix;
  oseMetrics.dateISO = day.toISOString();
  oseMetrics.notionalVolWrittenUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolExercisedUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolRedeemedUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolTransferredUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolSumUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolSettledUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolFeesAccruedUSD = BigDecimal.fromString("0");
  oseMetrics.notionalVolFeesSweptUSD = BigDecimal.fromString("0");
  oseMetrics.save();

  return oseMetrics;
}
