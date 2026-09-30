import { getCommandInjectableBunch } from "@k8slens/command-palette-contracts";
import { openFleetOverviewInjectable } from "./open-fleet-overview.injectable";

export default getCommandInjectableBunch({
  id: "fleet-overview.open",
  title: "Fleet: Open overview",
  action: {
    instantiate: (di) => {
      const openFleetOverview = di.inject(openFleetOverviewInjectable)();

      return () => () => openFleetOverview();
    },
  },
});
