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

// The logs the assistant reads before anything else. Extensions cannot read logs themselves, but the assistant
// runs kubectl against the cluster, so the briefing names the exact commands. `--previous` is the run that crashed:
// a container in CrashLoopBackOff or OOMKilled has restarted, and its current log says little about why.
const logsText = (alert: FleetAlert): string[] => {
  const { target } = alert;

  switch (target.type) {
    case "pod":
      return [
        `kubectl logs ${target.name} -n ${target.namespace} --all-containers --tail=200`,
        `kubectl logs ${target.name} -n ${target.namespace} --all-containers --previous --tail=200`,
      ];
    case "node":
      return [
        `kubectl get pods -A --field-selector spec.nodeName=${target.name}`,
        `kubectl get --raw "/api/v1/nodes/${target.name}/proxy/logs/?query=kubelet&tailLines=200"`,
      ];
    case "namespace":
      return [
        `kubectl get pods -n ${target.namespace}`,
        `kubectl logs <failing pod> -n ${target.namespace} --all-containers --previous --tail=200`,
      ];
    case "cluster":
      return ["kubectl get pods -A | grep -vE 'Running|Completed'", "kubectl logs <failing pod> -n <namespace> --all-containers --previous --tail=200"];
  }
};

// Starts an Ask AI conversation on the alert's cluster, briefed with what the multi-cluster view saw.
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
          prompt: `Troubleshoot "${alert.title}" on ${targetText(alert)}: read its logs, find the root cause and tell me how to fix it.`,
          context: [
            `The Multi-Cluster View extension flagged this ${alert.severity} alert on the cluster "${clusterName}".`,
            `- Alert: ${alert.title}`,
            `- Details: ${alert.detail}`,
            `- Source: ${sourceText[alert.source]}`,
            `- Affected resource: ${targetText(alert)}`,
            `- Start with: \`${inspectText(alert)}\``,
            alert.since ? `- Last seen: ${new Date(alert.since).toISOString()}` : "",
            "",
            "Read the logs first, before guessing at a cause; the root cause is usually in them:",
            ...logsText(alert).map((command) => `- \`${command}\``),
            "",
            "Quote the log lines that show the cause. Then inspect the affected resources and their events, explain the likely cause, and give the exact commands or manifest changes that fix it. If a log command is refused or returns nothing, say so and carry on with the rest.",
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
