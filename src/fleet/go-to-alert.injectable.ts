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

export const goToClusterInjectable = getInjectable2({
  id: "fleet-overview-go-to-cluster",
  consumptions: [navigateToNodesInjectionToken, showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const navigateToNodes = di.inject(navigateToNodesInjectionToken)();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    return () => async (clusterId: string) => {
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
