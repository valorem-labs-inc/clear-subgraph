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

// Used in handleDailyMetrics for Redeem/Transfer events
export class RedeemOrTransferAmounts {
  _underlyingAmountTotal: BigInt;
  _exerciseAmountTotal: BigInt;

  constructor() {
    this._underlyingAmountTotal = BigInt.fromI32(0);
    this._exerciseAmountTotal = BigInt.fromI32(0);
  }

  get underlyingAmountTotal(): BigInt {
    return this._underlyingAmountTotal;
  }
  get exerciseAmountTotal(): BigInt {
    return this._exerciseAmountTotal;
  }

  set underlyingAmountTotal(value: BigInt) {
    this._underlyingAmountTotal = value;
  }
  set exerciseAmountTotal(value: BigInt) {
    this._exerciseAmountTotal = value;
  }
}

/**
 * @param {string} eventKind "write" | "exercise" | "redeem" | "transfer"
 */
export function handleDailyMetrics(
  eventKind: string,
  timestamp: BigInt,
  optionType: OptionType,
  quantity: BigInt,
  redeemOrTransferAmounts: RedeemOrTransferAmounts | null
): void {
  // get tokens
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const exerciseToken = fetchToken(optionType.exerciseAsset);

  // get asset market prices for metrics
  const underlyingPriceUSD = getTokenPriceUSD(underlyingToken.id);
  const exercisePriceUSD = getTokenPriceUSD(exerciseToken.id);

  // calculate total token amounts for notional values
  let underlyingAmountTotal = BigInt.fromI32(0);
  let exerciseAmountTotal = BigInt.fromI32(0);
  if (eventKind == "write") {
    underlyingAmountTotal = optionType.underlyingAmount.times(quantity);
    exerciseAmountTotal = optionType.exerciseAmount.times(BigInt.fromI32(0));
  }
  if (eventKind == "exercise") {
    underlyingAmountTotal = optionType.underlyingAmount.times(
      BigInt.fromI32(0)
    );
    exerciseAmountTotal = optionType.exerciseAmount.times(quantity);
  }
  if (eventKind == "redeem" || eventKind == "transfer") {
    underlyingAmountTotal = redeemOrTransferAmounts!.underlyingAmountTotal;
    exerciseAmountTotal = redeemOrTransferAmounts!.exerciseAmountTotal;
  }

  // get prices in USD
  const underlyingTotalUSD = underlyingPriceUSD
    .times(underlyingAmountTotal.toBigDecimal())
    .div(exponentToBigDecimal(BigInt.fromI64(underlyingToken.decimals)));
  const exerciseTotalUSD = exercisePriceUSD
    .times(exerciseAmountTotal.toBigDecimal())
    .div(exponentToBigDecimal(BigInt.fromI64(exerciseToken.decimals)));

  // get daily metrics
  const dailyOSEMetrics = fetchDailyOSEMetrics(timestamp);
  const underlyingDaily = fetchDailyTokenMetrics(underlyingToken.id, timestamp);
  const exerciseDaily = fetchDailyTokenMetrics(exerciseToken.id, timestamp);

  // save previous TVLs
  const dailyTVLUSDBefore = dailyOSEMetrics.totalValueLockedUSD;
  const underlyingTVLUSDBefore = underlyingDaily.totalValueLockedUSD;
  const exerciseTVLUSDBefore = exerciseDaily.totalValueLockedUSD;

  // calculate new TVLs
  const underlyingTVLUSDAfter = underlyingPriceUSD.times(
    underlyingToken.totalValueLocked
      .toBigDecimal()
      .div(exponentToBigDecimal(BigInt.fromI64(underlyingToken.decimals)))
  );
  const exerciseTVLUSDAfter = exercisePriceUSD.times(
    exerciseToken.totalValueLocked
      .toBigDecimal()
      .div(exponentToBigDecimal(BigInt.fromI64(exerciseToken.decimals)))
  );

  /**
   *  Update Daily OSE Metrics
   */
  // By saving the before/after TVL in USD, we are able to maintain consistent records
  dailyOSEMetrics.totalValueLockedUSD = dailyOSEMetrics.totalValueLockedUSD
    .minus(underlyingTVLUSDBefore)
    .minus(exerciseTVLUSDBefore)
    .plus(underlyingTVLUSDAfter)
    .plus(exerciseTVLUSDAfter);

  if (eventKind == "write") {
    // Update Written + Settled + Sum with notional value of Underlying Asset
    dailyOSEMetrics.notionalVolWrittenUSD = dailyOSEMetrics.notionalVolWrittenUSD.plus(
      underlyingTotalUSD
    );
    dailyOSEMetrics.notionalVolSettledUSD = dailyOSEMetrics.notionalVolSettledUSD.plus(
      underlyingTotalUSD
    );
    dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
      underlyingTotalUSD
    );
  }
  if (eventKind == "exercise") {
    // Update Exercised + Settled + Sum with notional value of Exercise Asset
    dailyOSEMetrics.notionalVolExercisedUSD = dailyOSEMetrics.notionalVolExercisedUSD.plus(
      exerciseTotalUSD
    );
    dailyOSEMetrics.notionalVolSettledUSD = dailyOSEMetrics.notionalVolSettledUSD.plus(
      exerciseTotalUSD
    );
    dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
      exerciseTotalUSD
    );
  }
  if (eventKind == "redeem") {
    // Update Redeemed + Sum with notional value of the position (Underlying & Exercise)
    dailyOSEMetrics.notionalVolRedeemedUSD = dailyOSEMetrics.notionalVolRedeemedUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
    dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
  }
  if (eventKind == "transfer") {
    // Update Transferred + Sum with notional value of the position (Underlying & Exercise)
    dailyOSEMetrics.notionalVolTransferredUSD = dailyOSEMetrics.notionalVolTransferredUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
    dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
  }
  dailyOSEMetrics.save();

  /**
   *  Update Daily Token(s)' Metrics
   */
  if (eventKind == "write") {
    // Update TVL with incoming underlying token values
    underlyingDaily.totalValueLocked = underlyingToken.totalValueLocked;
    underlyingDaily.totalValueLockedUSD = underlyingTVLUSDAfter;

    // Update Underlying Token's Written + Settled + Sum with notional value
    underlyingDaily.notionalVolWritten = underlyingDaily.notionalVolWritten.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolSettled = underlyingDaily.notionalVolSettled.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolSum = underlyingDaily.notionalVolSum.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolWrittenUSD = underlyingDaily.notionalVolWrittenUSD.plus(
      underlyingTotalUSD
    );
    underlyingDaily.notionalVolSettledUSD = underlyingDaily.notionalVolSettledUSD.plus(
      underlyingTotalUSD
    );
    underlyingDaily.notionalVolSumUSD = underlyingDaily.notionalVolSumUSD.plus(
      underlyingTotalUSD
    );
  }

  if (eventKind == "exercise") {
    // Update TVL with *outgoing* underlying token values
    underlyingDaily.totalValueLocked = underlyingToken.totalValueLocked;
    underlyingDaily.totalValueLockedUSD = underlyingTVLUSDAfter;

    // Update TVL with *incoming* underlying token values
    exerciseDaily.totalValueLocked = exerciseToken.totalValueLocked;
    exerciseDaily.totalValueLockedUSD = exerciseTVLUSDAfter;

    // Update Exercise Token's Exercised + Settled + Sum with notional value
    exerciseDaily.notionalVolExercised = exerciseDaily.notionalVolExercised.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolExercisedUSD = exerciseDaily.notionalVolExercisedUSD.plus(
      exerciseTotalUSD
    );

    exerciseDaily.notionalVolSettled = exerciseDaily.notionalVolSettled.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolSettledUSD = exerciseDaily.notionalVolSettledUSD.plus(
      exerciseTotalUSD
    );

    exerciseDaily.notionalVolSum = exerciseDaily.notionalVolSum.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolSumUSD = exerciseDaily.notionalVolSumUSD.plus(
      exerciseTotalUSD
    );
  }

  if (eventKind == "redeem") {
    // Update Underlying Token's TVL with outgoing underlying token values
    underlyingDaily.totalValueLocked = underlyingToken.totalValueLocked;
    underlyingDaily.totalValueLockedUSD = underlyingTVLUSDAfter;

    // Update Underlying Token's Redeemed + Sum with notional value of underlying tokens redeemed
    underlyingDaily.notionalVolRedeemed = underlyingDaily.notionalVolRedeemed.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolRedeemedUSD = underlyingDaily.notionalVolRedeemedUSD.plus(
      underlyingTotalUSD
    );

    underlyingDaily.notionalVolSum = underlyingDaily.notionalVolSum.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolSumUSD = underlyingDaily.notionalVolSumUSD.plus(
      underlyingTotalUSD
    );

    // Update Exercise Token's TVL with outgoing exercise token values
    exerciseDaily.totalValueLocked = exerciseToken.totalValueLocked;
    exerciseDaily.totalValueLockedUSD = exerciseTVLUSDAfter;

    // Update Exercise Token's Redeemed + Sum with notional value of exercise tokens redeemed
    exerciseDaily.notionalVolRedeemed = exerciseDaily.notionalVolRedeemed.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolRedeemedUSD = exerciseDaily.notionalVolRedeemedUSD.plus(
      exerciseTotalUSD
    );

    exerciseDaily.notionalVolSum = exerciseDaily.notionalVolSum.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolSumUSD = exerciseDaily.notionalVolSumUSD.plus(
      exerciseTotalUSD
    );
  }

  if (eventKind == "transfer") {
    // Update Underlying Token's Transferred + Sum with notional value of underlying tokens transferred
    underlyingDaily.notionalVolTransferred = underlyingDaily.notionalVolTransferred.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolTransferredUSD = underlyingDaily.notionalVolTransferredUSD.plus(
      underlyingTotalUSD
    );

    underlyingDaily.notionalVolSum = underlyingDaily.notionalVolSum.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolSumUSD = underlyingDaily.notionalVolSumUSD.plus(
      underlyingTotalUSD
    );

    // Update Exercise Token's Transferred + Sum with notional value of exercise tokens transferred
    exerciseDaily.notionalVolTransferred = exerciseDaily.notionalVolTransferred.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolTransferredUSD = exerciseDaily.notionalVolTransferredUSD.plus(
      exerciseTotalUSD
    );

    exerciseDaily.notionalVolSum = exerciseDaily.notionalVolSum.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolSumUSD = exerciseDaily.notionalVolSumUSD.plus(
      exerciseTotalUSD
    );
  }
  exerciseDaily.save();
  underlyingDaily.save();
}
