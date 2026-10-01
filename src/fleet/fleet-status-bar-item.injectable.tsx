import { ClickableDiv, Span } from "@k8slens/element-components";
import { getInjectable2 } from "@k8slens/injectable";
import { statusBarItemInjectionToken } from "@k8slens/status-bar-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { fleetMonitorInjectable } from "./fleet-monitor.injectable";
import { notificationSettingsInjectable } from "./notification-settings.injectable";
import { openFleetOverviewInjectable } from "./open-fleet-overview.injectable";

// The critical and warning alerts of every connected cluster, wherever the user is in Lens, without the view open.
// It keeps watching the clusters that are connected, and does not connect the others: that is the view's to do.
const FleetAlertCount = observer(() => {
  const monitor = useInject(fleetMonitorInjectable)();
  const openFleetOverview = useInject(openFleetOverviewInjectable)();
  const { critical, warning } = monitor.totals.get();
  const notifications = useInject(notificationSettingsInjectable)().state.get();
  const silenced =
    notifications.kind === "off"
      ? " Notifications are off."
      : notifications.kind === "paused"
        ? ` Notifications are paused until ${new Date(notifications.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "";

  useEffect(() => monitor.start({ autoConnect: false }), [monitor]);

  const tooltip =
    (critical + warning === 0
      ? "Multi-Cluster View: nothing firing on your connected clusters."
      : `Multi-Cluster View: ${critical} critical and ${warning} warning alerts on your connected clusters. Click to see them.`) + silenced;

  return (
    <ClickableDiv $flex={{ gap: "xs", verticalAlign: "center" }} $onClick={() => void openFleetOverview()} $tooltip={tooltip}>
      {silenced && <Span aria-label="Notifications silenced">🔕</Span>}
      {critical > 0 && <Span $color="critical">● {critical} critical</Span>}
      {warning > 0 && <Span $color="warning">● {warning} warning</Span>}
      {critical + warning === 0 && <Span $color="success">● All clusters OK</Span>}
    </ClickableDiv>
  );
});

export const fleetStatusBarItemInjectable = getInjectable2({
  id: "fleet-overview-status-bar-item",
  instantiate: () => () => ({
    Component: () => <FleetAlertCount />,
    position: "right" as const,
    orderNumber: 50,
  }),
  injectionToken: statusBarItemInjectionToken,
});
