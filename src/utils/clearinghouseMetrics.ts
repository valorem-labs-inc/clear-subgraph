import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { ValoremOptionsClearinghouse } from "../../generated/ValoremOptionsClearinghouse/ValoremOptionsClearinghouse";
import {
  ValoremOptionsClearinghouse as OCH,
  DayData,
  OptionType,
} from "../../generated/schema";
import {
  getTokenPriceUSD,
  exponentToBigDecimal,
  fetchToken,
  fetchDailyTokenMetrics,
} from ".";

export function fetchValoremOptionsClearinghouse(contractAddress: string): OCH {
  let och = OCH.load(contractAddress);

  if (och === null) {
    const valoremOptionsClearinghouse = ValoremOptionsClearinghouse.bind(
      Address.fromString(contractAddress)
    );
    let initialFeeToAddress = valoremOptionsClearinghouse.feeTo().toHexString();
    och = new OCH(contractAddress);
    och.feeToAddress = initialFeeToAddress;
    och.feesEnabled = false;
    och.save();
  }

  return och;
}

/**
 * Used in Redeem/Transfer event handlers to pass both tokens' total amounts
 * @export
 * @class RedeemOrTransferAmounts
 */
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
 * Updates the Daily OCH Metrics and the Daily Token Metrics for a given Write/Exercise/Redeem/Transfer event
 * @param {string} eventKind "write" | "exercise" | "redeem" | "transfer"
 * @param {BigInt} timestamp
 * @param {OptionType} optionType
 * @param {BigInt} quantity
 * @param {(RedeemOrTransferAmounts | null)} redeemOrTransferAmounts
 */
export function handleDailyMetrics(
  eventKind: string,
  timestamp: BigInt,
  optionType: OptionType,
  quantity: BigInt,
  ochAddress: string,
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
  const dailyOCHMetrics = fetchDailyOCHMetrics(timestamp, ochAddress);
  const underlyingDaily = fetchDailyTokenMetrics(
    underlyingToken.id,
    timestamp,
    ochAddress
  );
  const exerciseDaily = fetchDailyTokenMetrics(
    exerciseToken.id,
    timestamp,
    ochAddress
  );

  // save previous TVLs
  const dailyTVLUSDBefore = dailyOCHMetrics.totalValueLockedUSD;
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
   *  Update Daily OCH Metrics
   */
  // By saving the before/after TVL in USD, we are able to maintain consistent records
  dailyOCHMetrics.totalValueLockedUSD = dailyOCHMetrics.totalValueLockedUSD
    .minus(underlyingTVLUSDBefore)
    .minus(exerciseTVLUSDBefore)
    .plus(underlyingTVLUSDAfter)
    .plus(exerciseTVLUSDAfter);

  if (eventKind == "write") {
    // Update Written + Settled + Sum with notional value of Underlying Asset
    dailyOCHMetrics.notionalVolWrittenUSD = dailyOCHMetrics.notionalVolWrittenUSD.plus(
      underlyingTotalUSD
    );
    dailyOCHMetrics.notionalVolSettledUSD = dailyOCHMetrics.notionalVolSettledUSD.plus(
      underlyingTotalUSD
    );
    dailyOCHMetrics.notionalVolCoreSumUSD = dailyOCHMetrics.notionalVolCoreSumUSD.plus(
      underlyingTotalUSD
    );
  } else if (eventKind == "exercise") {
    // Update Exercised + Settled + Sum with notional value of Exercise Asset
    dailyOCHMetrics.notionalVolExercisedUSD = dailyOCHMetrics.notionalVolExercisedUSD.plus(
      exerciseTotalUSD
    );
    dailyOCHMetrics.notionalVolSettledUSD = dailyOCHMetrics.notionalVolSettledUSD.plus(
      exerciseTotalUSD
    );
    dailyOCHMetrics.notionalVolCoreSumUSD = dailyOCHMetrics.notionalVolCoreSumUSD.plus(
      exerciseTotalUSD
    );
  } else if (eventKind == "redeem") {
    // Update Redeemed + Sum with notional value of the position (Underlying & Exercise)
    dailyOCHMetrics.notionalVolRedeemedUSD = dailyOCHMetrics.notionalVolRedeemedUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
    dailyOCHMetrics.notionalVolCoreSumUSD = dailyOCHMetrics.notionalVolCoreSumUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
  } else if (eventKind == "transfer") {
    // Update Transferred + Sum with notional value of the position (Underlying & Exercise)
    dailyOCHMetrics.notionalVolTransferredUSD = dailyOCHMetrics.notionalVolTransferredUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
    dailyOCHMetrics.notionalVolCoreSumUSD = dailyOCHMetrics.notionalVolCoreSumUSD.plus(
      underlyingTotalUSD.plus(exerciseTotalUSD)
    );
  }
  dailyOCHMetrics.save();

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
    underlyingDaily.notionalVolCoreSum = underlyingDaily.notionalVolCoreSum.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolWrittenUSD = underlyingDaily.notionalVolWrittenUSD.plus(
      underlyingTotalUSD
    );
    underlyingDaily.notionalVolSettledUSD = underlyingDaily.notionalVolSettledUSD.plus(
      underlyingTotalUSD
    );
    underlyingDaily.notionalVolCoreSumUSD = underlyingDaily.notionalVolCoreSumUSD.plus(
      underlyingTotalUSD
    );
  } else if (eventKind == "exercise") {
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

    exerciseDaily.notionalVolCoreSum = exerciseDaily.notionalVolCoreSum.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolCoreSumUSD = exerciseDaily.notionalVolCoreSumUSD.plus(
      exerciseTotalUSD
    );
  } else if (eventKind == "redeem") {
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

    underlyingDaily.notionalVolCoreSum = underlyingDaily.notionalVolCoreSum.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolCoreSumUSD = underlyingDaily.notionalVolCoreSumUSD.plus(
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

    exerciseDaily.notionalVolCoreSum = exerciseDaily.notionalVolCoreSum.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolCoreSumUSD = exerciseDaily.notionalVolCoreSumUSD.plus(
      exerciseTotalUSD
    );
  } else if (eventKind == "transfer") {
    // Update Underlying Token's Transferred + Sum with notional value of underlying tokens transferred
    underlyingDaily.notionalVolTransferred = underlyingDaily.notionalVolTransferred.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolTransferredUSD = underlyingDaily.notionalVolTransferredUSD.plus(
      underlyingTotalUSD
    );

    underlyingDaily.notionalVolCoreSum = underlyingDaily.notionalVolCoreSum.plus(
      underlyingAmountTotal
    );
    underlyingDaily.notionalVolCoreSumUSD = underlyingDaily.notionalVolCoreSumUSD.plus(
      underlyingTotalUSD
    );

    // Update Exercise Token's Transferred + Sum with notional value of exercise tokens transferred
    exerciseDaily.notionalVolTransferred = exerciseDaily.notionalVolTransferred.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolTransferredUSD = exerciseDaily.notionalVolTransferredUSD.plus(
      exerciseTotalUSD
    );

    exerciseDaily.notionalVolCoreSum = exerciseDaily.notionalVolCoreSum.plus(
      exerciseAmountTotal
    );
    exerciseDaily.notionalVolCoreSumUSD = exerciseDaily.notionalVolCoreSumUSD.plus(
      exerciseTotalUSD
    );
  }
  exerciseDaily.save();
  underlyingDaily.save();
}

/**
 * The following code is credited to https://github.com/Uniswap/v3-subgraph,
 * Included under GNU GPL v3 License
 * Extended to support Valorem
 */

/**
 * Retrieves or creates Daily Metrics for the entirety of the Option Settlement Engine
 * @param {BigInt} timestamp
 * @return {DayData}
 */
export function fetchDailyOCHMetrics(
  timestamp: BigInt,
  ochAddress: string
): DayData {
  const dayStart = getBeginningOfDayInSeconds(timestamp);
  let dailyOCHMetrics = DayData.load(dayStart.toString());
  if (dailyOCHMetrics) return dailyOCHMetrics;

  dailyOCHMetrics = new DayData(dayStart.toString());
  dailyOCHMetrics.date = dayStart.toI32();

  // find the last recorded day metrics (past 30 days) to carry over TVL USD
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

  dailyOCHMetrics.totalValueLockedUSD = lastDayData
    ? lastDayData.totalValueLockedUSD
    : BigDecimal.fromString("0"); // init with 0 for first event after contract deployment
  dailyOCHMetrics.notionalVolWrittenUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.notionalVolExercisedUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.notionalVolRedeemedUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.notionalVolTransferredUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.notionalVolCoreSumUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.notionalVolSettledUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.volFeesAccruedUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.volFeesSweptUSD = BigDecimal.fromString("0");
  dailyOCHMetrics.och = ochAddress;
  dailyOCHMetrics.save();

  return dailyOCHMetrics;
}

export const SECONDS_IN_DAY = BigInt.fromI32(86400);

export function getBeginningOfDayInSeconds(timestamp: BigInt): BigInt {
  return timestamp.div(SECONDS_IN_DAY).times(SECONDS_IN_DAY);
}
