import { BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import { ERC1155Contract, ValoremDayData } from "../../generated/schema";

export function updateValoremDayData(event: ethereum.Event): ValoremDayData {
  let valorem = ERC1155Contract.load(
    event.address.toHexString()
  ) as ERC1155Contract;

  let timestamp = event.block.timestamp.toI32();

  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;

  let valoremDayData = ValoremDayData.load(dayID.toString());

  if (valoremDayData === null) {
    valoremDayData = new ValoremDayData(dayID.toString());
    valoremDayData.date = dayStartTimestamp;
    valoremDayData.totalValueLockedUSD = BigDecimal.zero();
  }

  valoremDayData.totalValueLockedUSD = valorem.totalValueLockedUSD;

  valoremDayData.save();

  return valoremDayData;
}
