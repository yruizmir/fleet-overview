import { DashboardIcon } from "@k8slens/icon";
import { NavigatorItemIcon, NavigatorItemLabel, NavigatorLeafIndicator } from "@k8slens/navigator-components";
import { getNavigatorItemKind, getNavigatorItemKindInjectableBunch, navigatorRootKind } from "@k8slens/navigator-contracts";
import { useInject } from "@k8slens/use-inject";
import { computed } from "mobx";
import { openFleetOverviewInjectable } from "./open-fleet-overview.injectable";

interface FleetEntry {
  readonly id: string;
  readonly name: string;
  readonly orderNumber: number;
}

export const fleetNavigatorKind = getNavigatorItemKind<FleetEntry, []>()("fleet-overview");

const FleetNavigatorRow = () => {
  const openFleetOverview = useInject(openFleetOverviewInjectable)();

  return (
    <>
      <NavigatorLeafIndicator />
      <NavigatorItemIcon>
        <DashboardIcon />
      </NavigatorItemIcon>
      <NavigatorItemLabel onClick={() => void openFleetOverview()}>Multi-Cluster View</NavigatorItemLabel>
    </>
  );
};

export default getNavigatorItemKindInjectableBunch({
  kind: fleetNavigatorKind,
  parentKind: navigatorRootKind,
  description: "Opens the multi-cluster view: physical resources and alerts of every cluster in one tab.",

  items: {
    instantiate: () => async () => computed(() => [{ id: "fleet-overview", name: "Multi-Cluster View", orderNumber: 5 }]),
  },

  Component: FleetNavigatorRow,
});
