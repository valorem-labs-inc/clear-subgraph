import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import {
  Transaction,
  OptionSettlementEngine as OSE,
  DayData,
  OptionType,
} from "../../generated/schema";
import { OptionSettlementEngine } from "../../generated/OptionSettlementEngine/OptionSettlementEngine";
import { fetchDailyTokenMetrics, fetchToken } from "./tokens";
import { exponentToBigDecimal, getTokenPriceUSD } from "./price";

export * from "./tokens";
export * from "./constants";
export * from "./price";

// Retrieves or creates a daily data entity for tracking Volume and TVL.
export function fetchDailyOSEMetrics(timestamp: BigInt): DayData {
  // find
  const dayStart = getBeginningOfDayInSeconds(timestamp);
  let dailyOSEMetrics = DayData.load(dayStart.toString());
  if (dailyOSEMetrics) return dailyOSEMetrics;

  // init
  dailyOSEMetrics = new DayData(dayStart.toString());
  dailyOSEMetrics.date = dayStart.toI32();

  // find the last recorded day metrics to carry over TVL USD
  let lastDayData: DayData | null = null;
  for (let i = 1; i < 31; i++) {
    const previousDayStart = getBeginningOfDayInSeconds(
      timestamp.minus(BigInt.fromI32(i).times(SECONDS_IN_DAY))
    );

    const previousDaysMetrics = DayData.load(previousDayStart.toString());

    if (previousDaysMetrics != null) {
      // set variable and break search loop
      lastDayData = previousDaysMetrics;
      break;
    }
  }

  dailyOSEMetrics.totalValueLockedUSD = lastDayData
    ? lastDayData.totalValueLockedUSD
    : BigDecimal.fromString("0"); // init with 0 for first event after contract deployment
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

export const SECONDS_IN_DAY = BigInt.fromI32(86400);

export function getBeginningOfDayInSeconds(timestamp: BigInt): BigInt {
  return timestamp.div(SECONDS_IN_DAY).times(SECONDS_IN_DAY);
}

}
