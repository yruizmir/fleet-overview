import { runCliCommandInjectionToken } from "@k8slens/cli-contracts";
import { clusterNameInjectionToken } from "@k8slens/cluster-contracts";
import { navigateToKubeResourceDetailsInjectionToken } from "@k8slens/details-panel-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { coreV1, nodeKind, podKind } from "@k8slens/kubernetes-contracts";
import { navigateToNodesInjectionToken, navigateToPodsInjectionToken } from "@k8slens/kubernetes-resources-contracts";
import { isNavigationSupersededError } from "@k8slens/navigation-contracts";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
import type { FleetAlert } from "./fleet-model";

// Takes the user from an alert to the thing it is about: the pod, the node, or the namespace's pods.
export const goToAlertInjectable = getInjectable2({
  id: "fleet-overview-go-to-alert",
  consumptions: [
    navigateToKubeResourceDetailsInjectionToken,
    navigateToPodsInjectionToken,
    navigateToNodesInjectionToken,
    showErrorNotificationInjectionToken,
  ],

  instantiate: (di) => {
    const navigateToDetails = di.inject(navigateToKubeResourceDetailsInjectionToken)();
    const navigateToPods = di.inject(navigateToPodsInjectionToken)();
    const navigateToNodes = di.inject(navigateToNodesInjectionToken)();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    return () => async (alert: FleetAlert) => {
      const { clusterId, target } = alert;

      try {
        switch (target.type) {
          case "pod":
            await navigateToDetails({
              clusterId,
              kind: podKind,
              apiVersion: coreV1,
              ref: { namespace: target.namespace, name: target.name },
            });
            break;
          case "node":
            await navigateToDetails({ clusterId, kind: nodeKind, apiVersion: coreV1, ref: { name: target.name } });
            break;
          case "namespace":
            await navigateToPods({ clusterId, namespaces: [target.namespace] });
            break;
          case "cluster":
            await navigateToNodes({ clusterId });
            break;
        }
      } catch (error) {
        if (!isNavigationSupersededError(error)) {
          showErrorNotification(error as Error);
        }
      }
    };
  },
});

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

// Takes the user to a cluster's overview, the page with its CPU, memory and pods. Lens offers extensions no
// navigation there, so this asks the Lens CLI (`lens clusters connect <name> --open`), which connects the cluster
// and opens its overview tab. Without the CLI installed (Preferences > Lens CLI), or when it does not know the
// name, the cluster's nodes list is the nearest place an extension can reach.
export const goToClusterInjectable = getInjectable2({
  id: "fleet-overview-go-to-cluster",
  consumptions: [
    clusterNameInjectionToken,
    runCliCommandInjectionToken,
    navigateToNodesInjectionToken,
    showErrorNotificationInjectionToken,
  ],

  instantiate: (di) => {
    const clusterName = di.inject(clusterNameInjectionToken);
    const runCliCommand = di.inject(runCliCommandInjectionToken)();
    const navigateToNodes = di.inject(navigateToNodesInjectionToken)();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    const openOverview = async (clusterId: string) => {
      try {
        const output = await runCliCommand(`lens clusters connect ${shellQuote(await clusterName(clusterId))} --open`);

        // The CLI says so on its output, and exits fine, when it has no cluster of that name.
        return !/not found|required/i.test(output);
      } catch {
        return false;
      }
    };

    return () => async (clusterId: string) => {
      if (await openOverview(clusterId)) {
        return;
      }

      try {
        await navigateToNodes({ clusterId });
      } catch (error) {
        if (!isNavigationSupersededError(error)) {
          showErrorNotification(error as Error);
        }
      }
    };
  },
});
