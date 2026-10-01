import { Div, Span } from "@k8slens/element-components";
import { PlainButton } from "@k8slens/input-components";
import { getExtensionPreferencePageInjectableBunch } from "@k8slens/preferences-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import type { ReactNode } from "react";
import packageJson from "../../package.json";
import { alertMutesInjectable } from "./alert-mutes.injectable";
import { NotificationsToggle, RefreshIntervalField } from "./fleet-dashboard";
import { silencedAlertsInjectable } from "./silenced-alerts.injectable";

// The extension's settings, in Lens Preferences > Extensions > Multi-Cluster View: Lens gives extensions no place
// for settings on their details page, so this is where they all are, beside the same controls in the view.

const Setting = ({ title, children, control }: { title: string; children: ReactNode; control: ReactNode }) => (
  <Div $flex={{ gap: "l", verticalAlign: "center", horizontalAlign: "space-between", wrap: true }} $padding={{ vertical: "m" }}>
    <Div $flex={{ direction: "vertical", gap: "xxs" }} $style={{ maxWidth: 520 }}>
      <Span $font={{ bold: true }} $color="textHighlight">
        {title}
      </Span>
      <Span $color="textMuted">{children}</Span>
    </Div>
    {control}
  </Div>
);

const RefreshSetting = () => (
  <Setting title="Auto-refresh" control={<RefreshIntervalField />}>
    How often Prometheus usage and alerts are fetched, and clusters that are down are tried again: 30 seconds at least.
    Pods, nodes, workloads and events are live whatever it is.
  </Setting>
);

const NotificationsSetting = () => (
  <Setting title="Notifications" control={<NotificationsToggle />}>
    A notification for each new critical alert on a connected cluster. Paused or off, alerts still show in the view and
    the status bar, which adds 🔕.
  </Setting>
);

const MutedSetting = observer(() => {
  const mutes = useInject(alertMutesInjectable)();
  const count = mutes.count.get();

  return (
    <Setting
      title="Muted alerts"
      control={
        <PlainButton $disabled={count === 0} onClick={mutes.unmuteAll} $tooltip="Show every muted alert again now">
          Unmute all
        </PlainButton>
      }
    >
      {count === 0
        ? "No alert is muted. Mute 24h on an alert hides it from the counts, the status bar and the notifications."
        : `${count} alert${count === 1 ? " is" : "s are"} muted, each for 24 hours from when you muted it.`}
    </Setting>
  );
});

const SilencedSetting = observer(() => {
  const silenced = useInject(silencedAlertsInjectable)();
  const count = silenced.count.get();

  return (
    <Setting
      title="Alerts that never notify"
      control={
        <PlainButton $disabled={count === 0} onClick={silenced.notifyAboutAllAgain} $tooltip="Notify about all of them again">
          Notify about all again
        </PlainButton>
      }
    >
      {count === 0
        ? "None. Never notify me about this alert, on a notification, stops notifications for that alert only."
        : `${count} alert${count === 1 ? "" : "s"} never notify. They stay listed and counted in the view.`}
    </Setting>
  );
});

export default getExtensionPreferencePageInjectableBunch({
  packageJson,
  blocks: [
    { id: "refresh", orderNumber: 10, Component: RefreshSetting },
    { id: "notifications", orderNumber: 20, Component: NotificationsSetting },
    { id: "muted", orderNumber: 30, Component: MutedSetting },
    { id: "silenced", orderNumber: 40, Component: SilencedSetting },
  ],
});
