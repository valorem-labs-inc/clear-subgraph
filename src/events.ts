// Credit to https://github.com/OpenZeppelin/openzeppelin-subgraphs, included under MIT License

import { ethereum } from "@graphprotocol/graph-ts";

export namespace events {
  export function id(event: ethereum.Event): string {
    return event.block.number
      .toString()
      .concat("-")
      .concat(event.logIndex.toString());
  }
}
