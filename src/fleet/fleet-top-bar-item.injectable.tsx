import { IconButton } from "@k8slens/icon";
import { getTopBarItemInjectableBunch } from "@k8slens/top-bar-contracts";
import { useInject } from "@k8slens/use-inject";
import { openFleetOverviewInjectable } from "./open-fleet-overview.injectable";

const FleetOverviewButton = () => {
  const openFleetOverview = useInject(openFleetOverviewInjectable)();

  return (
    <IconButton
      iconName="dashboard"
      size={20}
      $onClick={() => void openFleetOverview()}
      $tooltip="Multi-Cluster View: resources and alerts of all clusters"
    />
  );
};

export default getTopBarItemInjectableBunch({
  id: "fleet-overview-fleet-overview-button",
  side: "right",
  orderNumber: 55,
  Component: FleetOverviewButton,
});
