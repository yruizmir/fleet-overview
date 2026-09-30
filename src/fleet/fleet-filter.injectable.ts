import { getInjectable2 } from "@k8slens/injectable";
import { action, computed, observable } from "mobx";
import type { FleetAlert, Severity } from "./fleet-model";
import { fleetMonitorInjectable } from "./fleet-monitor.injectable";

// What the alerts panel shows: which severities, and optionally one cluster.
export const fleetFilterInjectable = getInjectable2({
  id: "fleet-overview-fleet-filter",

  instantiate: (di) => {
    const monitor = di.inject(fleetMonitorInjectable)();
    // Nothing selected shows everything; selecting narrows to what is selected.
    const severities = observable.set<Severity>();
    const clusterId = observable.box<string | undefined>(undefined);

    const toggle = <T>(set: Set<T>, value: T) => {
      if (set.has(value)) {
        set.delete(value);
      } else {
        set.add(value);
      }
    };

    const inCluster = (alert: FleetAlert) => clusterId.get() === undefined || alert.clusterId === clusterId.get();
    const severityMatches = (alert: FleetAlert) => severities.size === 0 || severities.has(alert.severity);

    const visibleAlerts = computed(() =>
      monitor.alerts.get().filter((alert) => inCluster(alert) && severityMatches(alert)),
    );

    const severityCounts = computed(() => {
      const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };

      for (const alert of monitor.alerts.get()) {
        if (inCluster(alert)) counts[alert.severity]++;
      }

      return counts;
    });

    const totalCount = computed(() => monitor.alerts.get().filter(inCluster).length);

    return () => ({
      severities,
      clusterId,
      visibleAlerts,
      severityCounts,
      totalCount,
      showAll: action(() => severities.clear()),
      toggleSeverity: action((severity: Severity) => toggle(severities, severity)),
      showCluster: action((id: string | undefined) => clusterId.set(clusterId.get() === id ? undefined : id)),
    });
  },
});
