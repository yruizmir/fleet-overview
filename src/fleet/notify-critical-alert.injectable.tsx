import { ClickableDiv, Div, Span } from "@k8slens/element-components";
import { getInjectable2 } from "@k8slens/injectable";
import { PlainButton } from "@k8slens/input-components";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
import { alertMutesInjectable } from "./alert-mutes.injectable";
import { askAiAboutAlertInjectable } from "./ask-ai-about-alert.injectable";
import type { FleetAlert } from "./fleet-model";
import { goToAlertInjectable } from "./go-to-alert.injectable";
import { notificationSettingsInjectable } from "./notification-settings.injectable";
import { silencedAlertsInjectable } from "./silenced-alerts.injectable";
import { SparkleIcon } from "./sparkle-icon";

// A critical alert as a Lens notification the user can act on from where they are: open what it is about,
// troubleshoot it with Ask AI, mute it for a day, pause every notification for a day, or never be notified about
// this alert again. Each of those also dismisses the notification.
export const notifyCriticalAlertInjectable = getInjectable2({
  id: "fleet-overview-notify-critical-alert",
  consumptions: [showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();
    const goToAlert = di.inject(goToAlertInjectable)();
    const askAiAboutAlert = di.inject(askAiAboutAlertInjectable)();
    const mutes = di.inject(alertMutesInjectable)();
    const notificationSettings = di.inject(notificationSettingsInjectable)();
    const silencedAlerts = di.inject(silencedAlertsInjectable)();

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

      const andDismiss = (act: () => void) => () => {
        act();
        dismiss?.();
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
          <Div $flex={{ gap: "s", wrap: true }}>
            <PlainButton onClick={() => void open()} $tooltip="Go to what this alert is about" $color="white" {...button}>
              Open
            </PlainButton>
            <PlainButton onClick={() => void troubleshoot()} $tooltip="Troubleshoot this alert with Ask AI" $color="white" {...button}>
              <Span $flex={{ gap: "xs", verticalAlign: "center" }}>
                <SparkleIcon />
                Ask AI
              </Span>
            </PlainButton>
            <PlainButton
              onClick={andDismiss(() => mutes.mute(alert.key))}
              $tooltip="Hide this alert for 24 hours: out of the counts, the status bar and the notifications"
              $color="white"
              {...button}
            >
              Mute 24h
            </PlainButton>
            <PlainButton
              onClick={andDismiss(notificationSettings.pauseForADay)}
              $tooltip="No notifications for 24 hours. The alerts still show in Multi-Cluster View and the status bar"
              $color="white"
              {...button}
            >
              Mute all 24h
            </PlainButton>
          </Div>
          <ClickableDiv
            role="checkbox"
            aria-checked={false}
            $flex={{ gap: "xs", verticalAlign: "center" }}
            $onClick={andDismiss(() => silencedAlerts.silence(alert.key))}
            $tooltip="No more notifications for this alert. It stays listed in Multi-Cluster View, where its row can turn them back on"
          >
            <Span aria-hidden="true">☐</Span>
            Never notify me about this alert
          </ClickableDiv>
        </Div>,
      );
    };
  },
});
