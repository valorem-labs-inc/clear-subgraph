import { Address, BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { ERC20 } from "../../generated/OptionSettlementEngine/ERC20";
import { Token, DailyTokenMetrics } from "../../generated/schema";

export function loadOrInitializeToken(address: string): Token {
  let token = Token.load(address);
  if (token) return token;

  let tokenContract = ERC20.bind(Address.fromString(address));
  token = new Token(address);

  token.symbol = tokenContract.symbol();
  token.name = tokenContract.name();
  token.decimals = tokenContract.decimals();

  token.tvl = BigInt.fromI32(0);
  token.feesAccrued = BigInt.fromI32(0);

  token.save();

  return token;
}

export function loadOrInitializeDailyTokenMetrics(
  tokenAddress: string,
  timestamp: BigInt
): TokenDayData {
  const day = getBeginningOfDay(timestamp);
  const dateUnix = BigInt.fromI64(day.getTime());

  let tokenMetrics = TokenDayData.load(`${tokenAddress}-${dateUnix}`);
  if (tokenMetrics) return tokenMetrics;

  // init
  const token = loadOrInitializeToken(tokenAddress);
  const dailyOSEMetrics = loadOrInitializeDailyOSEMetrics(timestamp);

  tokenMetrics = new TokenDayData(`${tokenAddress}-${dateUnix}`);
  tokenMetrics.totalValueLocked = token.totalValueLocked;
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
