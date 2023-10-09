import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";

export enum RoundingMode {
  NEAREST = 0,
  UP = 1,
  DOWN = 2,
}

export function roundBigDecimalToBigInt(
  value: BigDecimal,
  mode: RoundingMode = RoundingMode.NEAREST
): BigInt {
  // Extract the integer part of the BigDecimal
  let integerPart = BigInt.fromString(value.toString().split(".")[0]);

  // early escape
  if (mode === RoundingMode.DOWN) {
    return integerPart;
  }

  // Get the fractional part of the BigDecimal
  let fractionalPart = value.minus(integerPart.toBigDecimal());

  /**
   * If rounding mode is 'nearest' and the fractional part is GTE 0.5
   * or
   * If rounding mode is 'up' and the fractional part is GT 0
   * -> add one to the integer part
   */
  if (
    (mode === RoundingMode.NEAREST &&
      fractionalPart >= BigDecimal.fromString("0.5")) ||
    (mode === RoundingMode.UP && fractionalPart > BigDecimal.fromString("0"))
  ) {
    integerPart = integerPart.plus(BigInt.fromI32(1));
  }

  return integerPart;
}
