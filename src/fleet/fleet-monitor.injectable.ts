import {
  allClusterRecordsReactiveInjectionToken,
  type ClusterRecord,
  connectClusterInjectionToken,
} from "@k8slens/cluster-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { coreV1, kubeResourcesInjectionToken, type NodeV1, nodeKind, type PodV1, podKind } from "@k8slens/kubernetes-contracts";
import { queryPrometheusRangeInjectionToken } from "@k8slens/prometheus-contracts";
import type { Subscription } from "@k8slens/subscribable";
import { action, computed, type IComputedValue, type IObservableValue, observable, reaction, runInAction } from "mobx";
import {
  type ClusterResources,
  type FleetAlert,
  eventAlerts,
  type EventV1,
  lastValue,
  nodeAlerts,
  type Resource,
  podAlerts,
  prometheusAlerts,
  type PrometheusSample,
  severityOrder,
  summarizeResources,
} from "./fleet-model";
import { eventKind } from "./event-kind";

type Loadable<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: IComputedValue<T> }
  | { readonly status: "error"; readonly error: string };

export type PrometheusState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly sample: PrometheusSample; readonly at: number }
  | { readonly status: "unavailable"; readonly error: string; readonly at: number };

interface Tracked {
  readonly nodes: IObservableValue<Loadable<readonly NodeV1[]>>;
  readonly pods: IObservableValue<Loadable<readonly PodV1[]>>;
  readonly events: IObservableValue<Loadable<readonly EventV1[]>>;
  readonly prometheus: IObservableValue<PrometheusState>;
  readonly subscriptions: Subscription<unknown>[];
}

export interface ClusterView {
  readonly record: ClusterRecord;
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly connectError?: string;
  readonly loading: boolean;
  readonly error?: string;
  readonly resources?: ClusterResources;
  readonly prometheus: PrometheusState | undefined;
  readonly alerts: readonly FleetAlert[];
}

const pollIntervalMs = 30_000;
const connectTimeoutMs = 60_000;
const unavailableRetryMs = 5 * 60_000;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const queries = {
  alerts: `ALERTS{alertstate="firing"}`,
  cpu: [
    `sum(rate(node_cpu_seconds_total{mode!~"idle|iowait|steal"}[5m]))`,
    `sum(rate(container_cpu_usage_seconds_total{container!="",pod!=""}[5m]))`,
  ],
  memory: [
    `sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)`,
    `sum(container_memory_working_set_bytes{container!="",pod!=""})`,
  ],
  storage: [
    `sum(node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs"} - node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs"})`,
  ],
};

export const fleetMonitorInjectable = getInjectable2({
  id: "fleet-overview-fleet-monitor",
  consumptions: [
    allClusterRecordsReactiveInjectionToken,
    connectClusterInjectionToken,
    kubeResourcesInjectionToken,
    queryPrometheusRangeInjectionToken,
  ],

  instantiate: (di) => {
    const allClusterRecords = di.inject(allClusterRecordsReactiveInjectionToken);
    const connectCluster = di.inject(connectClusterInjectionToken);
    const kubeResources = di.inject(kubeResourcesInjectionToken)();
    const queryPrometheusRange = di.inject(queryPrometheusRangeInjectionToken)();

    const records = observable.box<IComputedValue<ClusterRecord[]> | undefined>(undefined, { deep: false });
    const tracked = observable.map<string, Tracked>({}, { deep: false });
    const connecting = observable.map<string, "connecting" | { error: string }>();
    const now = observable.box(Date.now());
    const lastRefresh = observable.box<number | undefined>(undefined);

    let users = 0;
    let stopRunning: (() => void) | undefined;

    const load = <T>(box: IObservableValue<Loadable<T>>, subscription: Subscription<T>) => {
      subscription.claim();
      subscription.value.then(
        (value) => runInAction(() => box.set({ status: "ready", value })),
        (error) => runInAction(() => box.set({ status: "error", error: errorText(error) })),
      );
    };

    const firstAnswer = async (clusterId: string, candidates: string[], range: { start: number; end: number; step: number }) => {
      let lastError: unknown;

      for (const query of candidates) {
        try {
          const value = lastValue(await queryPrometheusRange(clusterId, query, range));

          if (value !== undefined) {
            return value;
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        throw lastError;
      }

      return undefined;
    };

    const pollPrometheus = async (clusterId: string, force: boolean) => {
      const entry = tracked.get(clusterId);

      if (!entry) {
        return;
      }

      const current = entry.prometheus.get();

      if (!force && current.status === "unavailable" && Date.now() - current.at < unavailableRetryMs) {
        return;
      }

      const end = Math.floor(Date.now() / 1000);
      const range = { start: end - 120, end, step: 60 };
      const [alerts, cpu, memory, storage] = await Promise.allSettled([
        queryPrometheusRange(clusterId, queries.alerts, range),
        firstAnswer(clusterId, queries.cpu, range),
        firstAnswer(clusterId, queries.memory, range),
        firstAnswer(clusterId, queries.storage, range),
      ]);

      if (!tracked.has(clusterId)) {
        return;
      }

      runInAction(() => {
        if ([alerts, cpu, memory, storage].every((result) => result.status === "rejected")) {
          entry.prometheus.set({
            status: "unavailable",
            error: errorText((alerts as PromiseRejectedResult).reason),
            at: Date.now(),
          });

          return;
        }

        entry.prometheus.set({
          status: "ready",
          at: Date.now(),
          sample: {
            cpuUsedCores: cpu.status === "fulfilled" ? cpu.value : undefined,
            memoryUsedBytes: memory.status === "fulfilled" ? memory.value : undefined,
            storageUsedBytes: storage.status === "fulfilled" ? storage.value : undefined,
            alerts: alerts.status === "fulfilled" ? prometheusAlerts(clusterId, alerts.value) : [],
          },
        });
      });
    };

    const track = action((clusterId: string) => {
      const entry: Tracked = {
        nodes: observable.box<Loadable<readonly NodeV1[]>>({ status: "loading" }, { deep: false }),
        pods: observable.box<Loadable<readonly PodV1[]>>({ status: "loading" }, { deep: false }),
        events: observable.box<Loadable<readonly EventV1[]>>({ status: "loading" }, { deep: false }),
        prometheus: observable.box<PrometheusState>({ status: "loading" }, { deep: false }),
        subscriptions: [],
      };
      const nodes = kubeResources(nodeKind, coreV1, clusterId).subscribe();
      const pods = kubeResources(podKind, coreV1, clusterId).subscribe();

      const events = kubeResources(eventKind, coreV1, clusterId).subscribe();

      entry.subscriptions.push(nodes, pods, events);
      tracked.set(clusterId, entry);
      load(entry.nodes, nodes);
      load(entry.pods, pods);
      load(entry.events, events);
      void pollPrometheus(clusterId, true);
    });

    const untrack = action((clusterId: string) => {
      tracked.get(clusterId)?.subscriptions.forEach((subscription) => subscription.dispose());
      tracked.delete(clusterId);
    });

    const refresh = action(() => {
      lastRefresh.set(Date.now());

      for (const [clusterId, entry] of tracked) {
        entry.subscriptions.forEach((subscription) => subscription.refresh());
        void pollPrometheus(clusterId, true);
      }
    });

    const run = () => {
      let stopped = false;
      let stopReaction: (() => void) | undefined;
      let stopAutoConnect: (() => void) | undefined;

      void allClusterRecords().then((computedRecords) => {
        if (stopped) {
          return;
        }

        runInAction(() => records.set(computedRecords));

        // Opening the fleet connects every cluster it lists, once per opening; a cluster the user disconnects
        // afterwards stays disconnected until the fleet is opened again.
        const attempted = new Set<string>();

        stopAutoConnect = reaction(
          () => clusters.get().filter((cluster) => !cluster.connected && !cluster.connecting).map((cluster) => cluster.record.id),
          (ids) => {
            for (const id of ids) {
              if (!attempted.has(id)) {
                attempted.add(id);
                void connect(id);
              }
            }
          },
          { fireImmediately: true },
        );

        stopReaction = reaction(
          () => computedRecords.get().filter((record) => record.isConnected.get()).map((record) => record.id),
          (connectedIds) => {
            for (const id of connectedIds) {
              if (!tracked.has(id)) {
                track(id);
              }
            }

            for (const id of [...tracked.keys()]) {
              if (!connectedIds.includes(id)) {
                untrack(id);
              }
            }
          },
          { fireImmediately: true },
        );
      });

      const timer = setInterval(() => {
        runInAction(() => now.set(Date.now()));

        for (const clusterId of tracked.keys()) {
          void pollPrometheus(clusterId, false);
        }
      }, pollIntervalMs);

      return () => {
        stopped = true;
        clearInterval(timer);
        stopReaction?.();
        stopAutoConnect?.();
        [...tracked.keys()].forEach(untrack);
      };
    };

    const clusterView = (record: ClusterRecord): ClusterView => {
      const entry = tracked.get(record.id);
      const connectState = connecting.get(record.id);
      const base = {
        record,
        connected: record.isConnected.get(),
        connecting: connectState === "connecting",
        connectError: typeof connectState === "object" ? connectState.error : undefined,
      };

      if (!entry) {
        return { ...base, loading: false, prometheus: undefined, alerts: [] };
      }

      const nodes = entry.nodes.get();
      const pods = entry.pods.get();
      const prometheus = entry.prometheus.get();
      const nodeList = nodes.status === "ready" ? nodes.value.get() : [];
      const podList = pods.status === "ready" ? pods.value.get() : [];
      const events = entry.events.get();
      const eventList = events.status === "ready" ? events.value.get() : [];
      const sample = prometheus.status === "ready" ? prometheus.sample : undefined;
      const error = nodes.status === "error" ? nodes.error : pods.status === "error" ? pods.error : undefined;
      const alerts = [
        ...(sample?.alerts ?? []),
        ...nodeAlerts(record.id, nodeList),
        ...podAlerts(record.id, podList, now.get()),
        ...eventAlerts(record.id, eventList),
      ];

      const resources = nodes.status === "ready" ? summarizeResources(nodeList, podList, sample) : undefined;

      return {
        ...base,
        loading: nodes.status === "loading",
        error,
        resources,
        prometheus,
        alerts,
      };
    };

    // Lens can hold two entries for one cluster (one left behind by another integration). Extensions only see
    // names, so a disconnected entry is hidden when a connected one carries the same name.
    const withoutDisconnectedTwins = (views: ClusterView[]) => {
      const connectedNames = new Set(views.filter((view) => view.connected).map((view) => view.record.name.get()));

      return views.filter((view) => view.connected || !connectedNames.has(view.record.name.get()));
    };

    const clusters = computed(() =>
      withoutDisconnectedTwins((records.get()?.get() ?? []).map(clusterView))
        .sort((a, b) => Number(b.connected) - Number(a.connected) || a.record.name.get().localeCompare(b.record.name.get())),
    );

    const alerts = computed(() =>
      clusters
        .get()
        .flatMap((cluster) => cluster.alerts)
        .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (b.since ?? 0) - (a.since ?? 0)),
    );

    const sumResource = (pick: (resources: ClusterResources) => Resource, list: ClusterResources[]): Resource => {
      const withUsage = list.filter((resources) => pick(resources).used !== undefined);

      return {
        capacity: list.reduce((sum, resources) => sum + pick(resources).capacity, 0),
        allocatable: list.reduce((sum, resources) => sum + pick(resources).allocatable, 0),
        requested: list.reduce((sum, resources) => sum + pick(resources).requested, 0),
        limits: list.reduce((sum, resources) => sum + (pick(resources).limits ?? 0), 0),
        used: withUsage.length ? withUsage.reduce((sum, resources) => sum + (pick(resources).used ?? 0), 0) : undefined,
      };
    };

    const totals = computed(() => {
      const all = clusters.get();
      const list = all.flatMap((cluster) => (cluster.resources ? [cluster.resources] : []));
      const firing = alerts.get();

      return {
        clusters: all.length,
        connected: all.filter((cluster) => cluster.connected).length,
        withMetrics: all.filter((cluster) => cluster.prometheus?.status === "ready").length,
        nodesTotal: list.reduce((sum, resources) => sum + resources.nodesTotal, 0),
        nodesReady: list.reduce((sum, resources) => sum + resources.nodesReady, 0),
        cpu: sumResource((resources) => resources.cpu, list),
        memory: sumResource((resources) => resources.memory, list),
        storage: sumResource((resources) => resources.storage, list),
        gpu: sumResource((resources) => resources.gpu, list),
        pods: sumResource((resources) => resources.pods, list),
        critical: firing.filter((alert) => alert.severity === "critical").length,
        warning: firing.filter((alert) => alert.severity === "warning").length,
        info: firing.filter((alert) => alert.severity === "info").length,
      };
    });

    const connect = async (clusterId: string) => {
      runInAction(() => connecting.set(clusterId, "connecting"));

      let timer: ReturnType<typeof setTimeout> | undefined;

      // A connection that never answers would otherwise leave the card on "Connecting…" for good.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No answer after ${connectTimeoutMs / 1000}s`)), connectTimeoutMs);
      });

      try {
        await Promise.race([connectCluster(clusterId), timeout]);
        runInAction(() => connecting.delete(clusterId));
      } catch (error) {
        runInAction(() => connecting.set(clusterId, { error: errorText(error) }));
      } finally {
        clearTimeout(timer);
      }
    };

    return () => ({
      clusters,
      alerts,
      totals,
      isReady: computed(() => records.get() !== undefined),
      lastRefresh: computed(() => lastRefresh.get()),

      // Keeps the watches and polling alive while at least one dashboard is on screen.
      start: () => {
        users++;

        if (users === 1) {
          stopRunning = run();
        }

        return () => {
          users--;

          if (users === 0) {
            stopRunning?.();
            stopRunning = undefined;
          }
        };
      },

      refresh,
      connect,
    });
  },
});

export type FleetMonitor = ReturnType<ReturnType<typeof fleetMonitorInjectable.instantiate>>;
