import { Div, Span } from "@k8slens/element-components";
import { getInjectable2 } from "@k8slens/injectable";
import { PlainButton } from "@k8slens/input-components";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
import { askAiAboutAlertInjectable } from "./ask-ai-about-alert.injectable";
import type { FleetAlert } from "./fleet-model";
import { goToAlertInjectable } from "./go-to-alert.injectable";
import { SparkleIcon } from "./sparkle-icon";

// A critical alert as a Lens notification the user can act on from where they are: open what it is about, or
// troubleshoot it with Ask AI, either of which also dismisses the notification.
export const notifyCriticalAlertInjectable = getInjectable2({
  id: "fleet-overview-notify-critical-alert",
  consumptions: [showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();
    const goToAlert = di.inject(goToAlertInjectable)();
    const askAiAboutAlert = di.inject(askAiAboutAlertInjectable)();

    return () => (alert: FleetAlert, clusterName: string) => {
      let dismiss: (() => void) | undefined;

      const open = async () => {
        dismiss?.();
        await goToAlert(alert);
      };

      // Ask AI opens in the cluster's own dock, so the resource is opened first, as from the view.
      const troubleshoot = async () => {
        await open();
        await askAiAboutAlert(alert, clusterName);
      };

      const button = { $padding: { horizontal: "s", vertical: "xxs" }, $border: { color: "white", width: "xxs", radius: "m" } } as const;

      dismiss = showErrorNotification(
        <Div $flex={{ direction: "vertical", gap: "s" }}>
          <Span>
            <b>
              Critical on {clusterName}: {alert.title}.
            </b>{" "}
            {alert.detail}
          </Span>
          <Div $flex={{ gap: "s" }}>
            <PlainButton onClick={() => void open()} $tooltip="Go to what this alert is about" $color="white" {...button}>
              Open
            </PlainButton>
            <PlainButton onClick={() => void troubleshoot()} $tooltip="Troubleshoot this alert with Ask AI" $color="white" {...button}>
              <Span $flex={{ gap: "xs", verticalAlign: "center" }}>
                <SparkleIcon />
                Ask AI
              </Span>
            </PlainButton>
          </Div>
        </Div>,
      );
    };
  },
});
