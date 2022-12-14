import { Address, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import {
  ERC1155Contract,
  FeeSwitch,
  ValoremDayData,
} from "../../generated/schema";
import { OptionSettlementEngine } from "../../generated/OptionSettlementEngine/OptionSettlementEngine";

export * from "./tokens";

// Retrieves or creates a daily data entity for tracking Volume and TVL.
// Code adapted from https://github.com/Uniswap/v3-subgraph/blob/bf03f940f17c3d32ee58bd37386f26713cff21e2/src/utils/intervalUpdates.ts#L23
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
    valoremDayData.volumeUSD = BigDecimal.zero();
    valoremDayData.feesAccrued = BigDecimal.zero();
    valoremDayData.feesSwept = BigDecimal.zero();
  }

  valoremDayData.totalValueLockedUSD = valorem.totalValueLockedUSD;

  valoremDayData.save();

  return valoremDayData;
}

export function loadOrInitializeFeeSwitch(contractAddress: string): FeeSwitch {
  let feeSwitch = FeeSwitch.load(contractAddress);

  if (feeSwitch === null) {
    let optionSettlementEngine = OptionSettlementEngine.bind(
      Address.fromString(contractAddress)
    );
    let initialFeeToAddress = optionSettlementEngine.feeTo().toHexString();

    feeSwitch = new FeeSwitch(contractAddress);
    feeSwitch.feeToAddress = initialFeeToAddress;
    feeSwitch.isEnabled = false;
    feeSwitch.save();
  }

  return feeSwitch;
}
