import { askAiInjectionToken } from "@k8slens/ask-ai-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
import type { FleetAlert } from "./fleet-model";

const sourceText: Record<FleetAlert["source"], string> = {
  prometheus: "a firing Prometheus alert (from the ALERTS metric)",
  node: "a node condition reported by the node's status",
  pod: "a pod container state reported by the pod's status",
  event: "Kubernetes Warning events, grouped by object and reason",
};

const targetText = (alert: FleetAlert) => {
  const { target } = alert;

  switch (target.type) {
    case "pod":
      return `the pod ${target.namespace}/${target.name}`;
    case "node":
      return `the node ${target.name}`;
    case "namespace":
      return `the namespace ${target.namespace}`;
    case "cluster":
      return "the cluster as a whole";
  }
};

// Where to start looking, as the kubectl the assistant would run.
const inspectText = (alert: FleetAlert) => {
  const { target } = alert;

  switch (target.type) {
    case "pod":
      return `kubectl describe pod ${target.name} -n ${target.namespace}`;
    case "node":
      return `kubectl describe node ${target.name}`;
    case "namespace":
      return `kubectl get pods,events -n ${target.namespace}`;
    case "cluster":
      return "kubectl get nodes; kubectl get events -A --field-selector type=Warning";
  }
};

// Starts an Ask AI conversation on the alert's cluster, briefed with what the fleet overview saw.
export const askAiAboutAlertInjectable = getInjectable2({
  id: "fleet-overview-ask-ai-about-alert",
  consumptions: [askAiInjectionToken, showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const askAi = di.inject(askAiInjectionToken)();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    return () => async (alert: FleetAlert, clusterName: string) => {
      try {
        await askAi({
          clusterId: alert.clusterId,
          prompt: `Troubleshoot "${alert.title}" on ${targetText(alert)}: find the root cause and tell me how to fix it.`,
          context: [
            `The Fleet Overview extension flagged this ${alert.severity} alert on the cluster "${clusterName}".`,
            `- Alert: ${alert.title}`,
            `- Details: ${alert.detail}`,
            `- Source: ${sourceText[alert.source]}`,
            `- Affected resource: ${targetText(alert)}`,
            `- Start with: \`${inspectText(alert)}\``,
            alert.since ? `- Last seen: ${new Date(alert.since).toISOString()}` : "",
            "",
            "Inspect the affected resources, their events and logs, explain the likely cause, and give the exact commands or manifest changes that fix it.",
          ]
            .filter((line) => line !== "")
            .join("\n"),
        });
      } catch (error) {
        showErrorNotification(error as Error);
      }
    };
  },
});
