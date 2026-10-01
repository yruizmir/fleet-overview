import { getInjectable2 } from "@k8slens/injectable";
import { action, computed, observable } from "mobx";
import type { FleetAlert, Severity } from "./fleet-model";
import { type ClusterView, fleetMonitorInjectable } from "./fleet-monitor.injectable";

export type ClusterSort = "health" | "name";

// The minor of "v1.31.2", 31; undefined for anything else.
const minorOf = (version: string | undefined) => {
  const minor = version?.match(/^v?1\.(\d+)/)?.[1];

  return minor === undefined ? undefined : Number(minor);
};

// Worst first: critical alerts, then warnings, then the rest; disconnected clusters last.
const healthRank = (cluster: ClusterView) =>
  !cluster.connected ? 3 : cluster.alerts.some((alert) => alert.severity === "critical") ? 0 : cluster.alerts.length > 0 ? 1 : 2;

// What the alerts panel shows (which severities, optionally one cluster, muted or not), and which cluster cards
// show and in what order.
export const fleetFilterInjectable = getInjectable2({
  id: "fleet-overview-fleet-filter",

  instantiate: (di) => {
    const monitor = di.inject(fleetMonitorInjectable)();
    // Nothing selected shows everything; selecting narrows to what is selected.
    const severities = observable.set<Severity>();
    const clusterId = observable.box<string | undefined>(undefined);
    const showMuted = observable.box(false);
    const clusterQuery = observable.box("");
    const sortBy = observable.box<ClusterSort>("health");

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
      (showMuted.get() ? monitor.mutedAlerts : monitor.alerts).get().filter((alert) => inCluster(alert) && severityMatches(alert)),
    );

    const visibleClusters = computed(() => {
      const query = clusterQuery.get().trim().toLowerCase();
      const matching = monitor.clusters.get().filter((cluster) => !query || cluster.record.name.get().toLowerCase().includes(query));
      const byName = (a: ClusterView, b: ClusterView) => a.record.name.get().localeCompare(b.record.name.get());

      return sortBy.get() === "name"
        ? [...matching].sort(byName)
        : [...matching].sort(
            (a, b) =>
              healthRank(a) - healthRank(b) ||
              b.alerts.filter((alert) => alert.severity === "critical").length - a.alerts.filter((alert) => alert.severity === "critical").length ||
              b.alerts.length - a.alerts.length ||
              byName(a, b),
          );
    });

    // The newest minor version any connected cluster runs, so a card can say how far behind its own is.
    const newestMinor = computed(() =>
      Math.max(0, ...monitor.clusters.get().map((cluster) => minorOf(cluster.version) ?? 0)),
    );

    const minorsBehind = (cluster: ClusterView) => {
      const minor = minorOf(cluster.version);

      return minor === undefined ? 0 : newestMinor.get() - minor;
    };

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
      showMuted: computed(() => showMuted.get()),
      clusterQuery: computed(() => clusterQuery.get()),
      sortBy: computed(() => sortBy.get()),
      visibleAlerts,
      visibleClusters,
      minorsBehind,
      severityCounts,
      totalCount,
      showAll: action(() => severities.clear()),
      toggleSeverity: action((severity: Severity) => toggle(severities, severity)),
      showCluster: action((id: string | undefined) => clusterId.set(clusterId.get() === id ? undefined : id)),
      toggleMuted: action(() => showMuted.set(!showMuted.get())),
      searchClusters: action((query: string) => clusterQuery.set(query)),
      sortClusters: action((sort: ClusterSort) => sortBy.set(sort)),
    });
  },
});
