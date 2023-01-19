import { Address, BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { getBeginningOfDay, fetchDailyOSEMetrics } from ".";
import { ERC20 } from "../../generated/OptionSettlementEngine/ERC20";
import { Token, TokenDayData } from "../../generated/schema";

export function fetchToken(address: string): Token {
  let token = Token.load(address);
  if (token) return token;

  let tokenContract = ERC20.bind(Address.fromString(address));
  token = new Token(address);

  token.symbol = tokenContract.symbol();
  token.name = tokenContract.name();
  token.decimals = tokenContract.decimals();

  token.totalValueLocked = BigInt.fromI32(0);
  token.feesAccrued = BigInt.fromI32(0);

  token.save();

  return token;
}

export function fetchDailyTokenMetrics(
  tokenAddress: string,
  timestamp: BigInt
): TokenDayData {
  // find
  const dayStart = getBeginningOfDayInSeconds(timestamp);
  let tokenMetrics = TokenDayData.load(
    `${tokenAddress}-${dayStart.toString()}`
  );
  if (tokenMetrics) return tokenMetrics;

  // init
  const token = fetchToken(tokenAddress);
  const dailyOSEMetrics = fetchDailyOSEMetrics(timestamp);

  // find the last recorded day metrics to carry over TVL USD
  let lastDayData: TokenDayData | null = null;
  for (let i = 1; i < 31; i++) {
    const previousDayStart = getBeginningOfDayInSeconds(
      timestamp.minus(BigInt.fromI32(i).times(SECONDS_IN_DAY))
    );

    const previousDaysMetrics = TokenDayData.load(
      `${tokenAddress}-${previousDayStart.toString()}`
    );

    if (previousDaysMetrics != null) {
      // set variable and break search loop
      lastDayData = previousDaysMetrics;
      break;
    }
  }

  tokenMetrics = new TokenDayData(`${tokenAddress}-${dayStart.toString()}`);
  tokenMetrics.date = dayStart.toI32();
  tokenMetrics.totalValueLocked = token.totalValueLocked;
  tokenMetrics.totalValueLockedUSD = lastDayData
    ? lastDayData.totalValueLockedUSD
    : BigDecimal.fromString("0"); // init with 0 for first event after contract deployment
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
  tokenMetrics.dayData = dailyOSEMetrics.id;
  tokenMetrics.save();

  return tokenMetrics;
}
