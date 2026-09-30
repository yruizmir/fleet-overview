import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import { getTabKind, getTabKindInjectableBunch, type TabProps } from "@k8slens/tab-contracts";
import { FleetDashboard, FleetDashboardTitle } from "./fleet-dashboard";

export const fleetTabKind = getTabKind()("fleet-overview");

const FleetTab = (_props: TabProps<typeof mainViewTabHostKind>) => <FleetDashboard />;
const FleetTabTitle = (_props: TabProps<typeof mainViewTabHostKind>) => <FleetDashboardTitle />;

export default getTabKindInjectableBunch({
  tabHostKind: mainViewTabHostKind,
  kind: fleetTabKind,
  Component: FleetTab,
  Title: FleetTabTitle,
});
