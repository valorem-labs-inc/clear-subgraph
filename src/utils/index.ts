import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import {
  Transaction,
  Account,
  OptionSettlementEngine as OSE,
  DayData,
} from "../../generated/schema";
import { OptionSettlementEngine } from "../../generated/OptionSettlementEngine/OptionSettlementEngine";

export * from "./tokens";

// Retrieves or creates a daily data entity for tracking Volume and TVL.
export function fetchDailyOSEMetrics(timestamp: BigInt): DayData {
  const day = getBeginningOfDay(timestamp);
  const dateUnix = BigInt.fromI64(day.getTime());

  let dailyOSEMetrics = DayData.load(dateUnix.toString());
  if (dailyOSEMetrics) return dailyOSEMetrics;

  // init
  dailyOSEMetrics = new DayData(dateUnix.toString());
  dailyOSEMetrics.notionalVolWrittenUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolExercisedUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolRedeemedUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolTransferredUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolSumUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolSettledUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolFeesAccruedUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.notionalVolFeesSweptUSD = BigDecimal.fromString("0");
  dailyOSEMetrics.save();

  return dailyOSEMetrics;
}

export function fetchOptionSettlementEngine(contractAddress: string): OSE {
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

export function fetchTransaction(txHash: string): Transaction {
  let tx = Transaction.load(txHash);
  if (tx) return tx;

  // init
  tx = new Transaction(txHash);
  tx.save();
  return tx;
}

export function getBeginningOfDay(timestamp: BigInt): Date {
  const dayStartTimestamp = (timestamp.toI32() / 86400) * 86400;
  const dayStartMilliseconds = dayStartTimestamp * 1000;
  return new Date(dayStartMilliseconds);
}
