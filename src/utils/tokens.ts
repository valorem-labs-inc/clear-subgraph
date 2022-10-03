import { Address, BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { ERC20 } from "../../generated/OptionSettlementEngine/ERC20";
import { Token, TokenDayData } from "../../generated/schema";

export function loadOrInitializeToken(tokenAddress: Address): Token {
  let token = Token.load(tokenAddress.toHexString());
  if (token) {
    return token;
  }

  return initializeToken(tokenAddress);
}

export function initializeToken(tokenAddress: Address): Token {
  let tokenContract = ERC20.bind(tokenAddress);

  let token = new Token(tokenAddress.toHexString());

  token.name = tokenContract.name();
  token.symbol = tokenContract.symbol();
  token.decimals = BigInt.fromI32(tokenContract.decimals());
  token.totalValueLocked = BigDecimal.zero();
  token.totalValueLockedUSD = BigDecimal.zero();

  token.save();

  return token;
}

export function updateTokenDayData(
  token: Token,
  event: ethereum.Event
): TokenDayData {
  let timestamp = event.block.timestamp.toI32();
  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;

  let tokenDayID = token.id.toString().concat("-").concat(dayID.toString());

  let tokenDayData = TokenDayData.load(tokenDayID);
  if (tokenDayData === null) {
    tokenDayData = new TokenDayData(tokenDayID);
    tokenDayData.date = dayStartTimestamp;
    tokenDayData.token = token.id;
    tokenDayData.volume = BigDecimal.zero();
    tokenDayData.volumeUSD = BigDecimal.zero();
    // tokenDayData.feesUSD = ZERO_BD
  }

  tokenDayData.totalValueLocked = token.totalValueLocked;
  tokenDayData.totalValueLockedUSD = token.totalValueLockedUSD;
  tokenDayData.save();

  return tokenDayData as TokenDayData;
}
