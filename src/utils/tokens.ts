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

// export function updateDailyTokenMetrics(
//   token: Token,
//   event: ethereum.Event
// ): DailyTokenMetrics {
//   let timestamp = event.block.timestamp.toI32();
//   let dayID = timestamp / 86400;
//   let dayStartTimestamp = dayID * 86400;

//   let tokenDayID = token.id
//     .toString()
//     .concat("-")
//     .concat(dayID.toString());

//   let DailyTokenMetrics = DailyTokenMetrics.load(tokenDayID);
//   if (DailyTokenMetrics === null) {
//     DailyTokenMetrics = new DailyTokenMetrics(tokenDayID);
//     DailyTokenMetrics.date = dayStartTimestamp;
//     DailyTokenMetrics.token = token.id;
//     DailyTokenMetrics.volume = BigDecimal.zero();
//     DailyTokenMetrics.volumeUSD = BigDecimal.zero();
//     DailyTokenMetrics.EngineDailyMetrics = dayID.toString();
//     // DailyTokenMetrics.feesUSD = ZERO_BD
//   }

//   DailyTokenMetrics.totalValueLocked = token.totalValueLocked;
//   // DailyTokenMetrics.totalValueLockedUSD = token.totalValueLockedUSD;
//   DailyTokenMetrics.save();

//   return DailyTokenMetrics as DailyTokenMetrics;
// }
