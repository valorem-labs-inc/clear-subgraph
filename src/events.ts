/**
 * The following code is credited to https://github.com/OpenZeppelin/openzeppelin-subgraphs
 * Included under MIT License
 * Extended to support Valorem
 */

import { ethereum } from "@graphprotocol/graph-ts";

export namespace events {
  export function id(event: ethereum.Event): string {
    return event.block.number
      .toString()
      .concat("-")
      .concat(event.logIndex.toString());
  }
}
