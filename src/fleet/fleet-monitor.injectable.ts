import {
  allClusterRecordsReactiveInjectionToken,
  type ClusterRecord,
  connectClusterInjectionToken,
} from "@k8slens/cluster-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import {
  appsV1,
  batchV1,
  coreV1,
  daemonSetKind,
  type DaemonSetV1,
  deploymentKind,
  type DeploymentV1,
  jobKind,
  type JobV1,
  kubeResourcesInjectionToken,
  type NodeV1,
  nodeKind,
  persistentVolumeClaimKind,
  type PersistentVolumeClaimV1,
  type PodV1,
  podKind,
  statefulSetKind,
  type StatefulSetV1,
} from "@k8slens/kubernetes-contracts";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
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
  workloadAlerts,
} from "./fleet-model";
import { alertMutesInjectable } from "./alert-mutes.injectable";
import { selectNotifiable } from "./notification-policy";
import { silencedAlertsInjectable } from "./silenced-alerts.injectable";
import { notificationSettingsInjectable } from "./notification-settings.injectable";
import { notifyCriticalAlertInjectable } from "./notify-critical-alert.injectable";
import { eventKind } from "./event-kind";
import { refreshIntervalInjectable } from "./refresh-interval.injectable";

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
  readonly deployments: IObservableValue<Loadable<readonly DeploymentV1[]>>;
  readonly statefulSets: IObservableValue<Loadable<readonly StatefulSetV1[]>>;
  readonly daemonSets: IObservableValue<Loadable<readonly DaemonSetV1[]>>;
  readonly jobs: IObservableValue<Loadable<readonly JobV1[]>>;
  readonly claims: IObservableValue<Loadable<readonly PersistentVolumeClaimV1[]>>;
  readonly prometheus: IObservableValue<PrometheusState>;
  readonly subscriptions: Subscription<unknown>[];
  readonly trackedAt: number;
}

export interface ClusterView {
  readonly record: ClusterRecord;
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly connectError?: string;
  // Disconnected by the user while the view was open: not reconnected until they press Connect.
  readonly autoConnectPaused: boolean;
  // When the next automatic attempt is due for a cluster that keeps failing to connect.
  readonly nextAttemptAt?: number;
  readonly loading: boolean;
  readonly error?: string;
  readonly resources?: ClusterResources;
  readonly prometheus: PrometheusState | undefined;
  // Firing and not muted; what the counts, the status bar and the notifications go by.
  readonly alerts: readonly FleetAlert[];
  readonly mutedAlerts: readonly FleetAlert[];
  // The kubelet version most of its nodes run, "v1.31.2".
  readonly version?: string;
}

const connectTimeoutMs = 60_000;
const unavailableRetryMs = 5 * 60_000;
// A cluster that keeps failing to connect is tried less and less often, up to this far apart.
const maxConnectBackoffMs = 10 * 60_000;
// A cluster's alerts in its first minute of being watched are what it already had: no notification for those.
const notifyAfterMs = 60_000;
const maxNotificationsAtOnce = 3;
const clockTickMs = 10_000;
const mostCommon = (values: readonly (string | undefined)[]) => {
  const counts = new Map<string, number>();

  values.forEach((value) => value && counts.set(value, (counts.get(value) ?? 0) + 1));

  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

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
    showErrorNotificationInjectionToken,
  ],

  instantiate: (di) => {
    const allClusterRecords = di.inject(allClusterRecordsReactiveInjectionToken);
    const connectCluster = di.inject(connectClusterInjectionToken);
    const kubeResources = di.inject(kubeResourcesInjectionToken)();
    const queryPrometheusRange = di.inject(queryPrometheusRangeInjectionToken)();
    const refreshInterval = di.inject(refreshIntervalInjectable)();
    const mutes = di.inject(alertMutesInjectable)();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();
    const notifyCriticalAlert = di.inject(notifyCriticalAlertInjectable)();
    const notificationSettings = di.inject(notificationSettingsInjectable)();
    const silencedAlerts = di.inject(silencedAlertsInjectable)();
    const pollIntervalMs = computed(() => refreshInterval.seconds.get() * 1000);

    const records = observable.box<IComputedValue<ClusterRecord[]> | undefined>(undefined, { deep: false });
    const tracked = observable.map<string, Tracked>({}, { deep: false });
    const connecting = observable.map<string, "connecting" | { error: string }>();
    const now = observable.box(Date.now());
    const lastRefresh = observable.box<number | undefined>(undefined);
    // How many surfaces want clusters connected for them (the dashboard), as opposed to only watching those
    // already connected (the status bar).
    const autoConnectUsers = observable.box(0);
    const paused = observable.set<string>();
    const failures = observable.map<string, number>();
    const lastAttempt = observable.map<string, number>();

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
        deployments: observable.box<Loadable<readonly DeploymentV1[]>>({ status: "loading" }, { deep: false }),
        statefulSets: observable.box<Loadable<readonly StatefulSetV1[]>>({ status: "loading" }, { deep: false }),
        daemonSets: observable.box<Loadable<readonly DaemonSetV1[]>>({ status: "loading" }, { deep: false }),
        jobs: observable.box<Loadable<readonly JobV1[]>>({ status: "loading" }, { deep: false }),
        claims: observable.box<Loadable<readonly PersistentVolumeClaimV1[]>>({ status: "loading" }, { deep: false }),
        prometheus: observable.box<PrometheusState>({ status: "loading" }, { deep: false }),
        subscriptions: [],
        trackedAt: Date.now(),
      };
      const nodes = kubeResources(nodeKind, coreV1, clusterId).subscribe();
      const pods = kubeResources(podKind, coreV1, clusterId).subscribe();
      const events = kubeResources(eventKind, coreV1, clusterId).subscribe();
      const deployments = kubeResources(deploymentKind, appsV1, clusterId).subscribe();
      const statefulSets = kubeResources(statefulSetKind, appsV1, clusterId).subscribe();
      const daemonSets = kubeResources(daemonSetKind, appsV1, clusterId).subscribe();
      const jobs = kubeResources(jobKind, batchV1, clusterId).subscribe();
      const claims = kubeResources(persistentVolumeClaimKind, coreV1, clusterId).subscribe();

      entry.subscriptions.push(nodes, pods, events, deployments, statefulSets, daemonSets, jobs, claims);
      tracked.set(clusterId, entry);
      load(entry.nodes, nodes);
      load(entry.pods, pods);
      load(entry.events, events);
      load(entry.deployments, deployments);
      load(entry.statefulSets, statefulSets);
      load(entry.daemonSets, daemonSets);
      load(entry.jobs, jobs);
      load(entry.claims, claims);
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
      let retryDisconnected: (() => void) | undefined;
      let stopNotifications: (() => void) | undefined;

      void allClusterRecords().then((computedRecords) => {
        if (stopped) {
          return;
        }

        runInAction(() => records.set(computedRecords));

        // While the dashboard is open, every cluster it lists is kept connected: one that appears (clusters
        // discovered from a cloud account arrive late) is connected at once, and one that is down or failed is
        // tried again, less often each time it fails. One the user disconnects stays disconnected.
        const disconnectedIds = () =>
          autoConnectUsers.get() > 0
            ? clusters
                .get()
                .filter((cluster) => !cluster.connected && !cluster.connecting && !cluster.autoConnectPaused)
                .map((cluster) => cluster.record.id)
            : [];

        const connectDue = (ids: string[]) => {
          const at = Date.now();

          for (const id of ids) {
            if (at >= nextAttemptAt(id)) {
              void attempt(id);
            }
          }
        };

        stopAutoConnect = reaction(disconnectedIds, connectDue, { fireImmediately: true });
        retryDisconnected = () => connectDue(disconnectedIds());
        stopNotifications = notifyNewCriticals();

        let previouslyConnected: string[] = [];

        stopReaction = reaction(
          () => computedRecords.get().filter((record) => record.isConnected.get()).map((record) => record.id),
          (connectedIds) => {
            // Connected a moment ago and not now, and not by a failure of ours: the user disconnected it.
            runInAction(() => {
              for (const id of previouslyConnected) {
                if (!connectedIds.includes(id) && !connecting.has(id)) {
                  paused.add(id);
                }
              }
            });
            previouslyConnected = connectedIds;

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

      // The clock alerts measure ages and crash-loop windows by, ticking more often than the refresh so that a
      // pod created between two refreshes does not read as created "0s ago".
      const clock = setInterval(() => runInAction(() => now.set(Date.now())), clockTickMs);

      const tick = () => {
        runInAction(() => now.set(Date.now()));
        retryDisconnected?.();

        for (const clusterId of tracked.keys()) {
          void pollPrometheus(clusterId, false);
        }
      };

      // The user can change the interval while the dashboard is open; the timer follows it.
      let timer: ReturnType<typeof setInterval> | undefined;
      const stopTimer = reaction(
        () => pollIntervalMs.get(),
        (intervalMs) => {
          clearInterval(timer);
          timer = setInterval(tick, intervalMs);
        },
        { fireImmediately: true },
      );

      return () => {
        stopped = true;
        stopTimer();
        clearInterval(timer);
        clearInterval(clock);
        stopReaction?.();
        stopAutoConnect?.();
        stopNotifications?.();
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
        autoConnectPaused: paused.has(record.id),
        nextAttemptAt: failures.has(record.id) ? nextAttemptAt(record.id) : undefined,
      };

      if (!entry) {
        return { ...base, loading: false, prometheus: undefined, alerts: [], mutedAlerts: [] };
      }

      const nodes = entry.nodes.get();
      const pods = entry.pods.get();
      const prometheus = entry.prometheus.get();
      const nodeList = nodes.status === "ready" ? nodes.value.get() : [];
      const podList = pods.status === "ready" ? pods.value.get() : [];
      const events = entry.events.get();
      const eventList = events.status === "ready" ? events.value.get() : [];
      const ready = <T>(box: IObservableValue<Loadable<readonly T[]>>) => {
        const value = box.get();

        return value.status === "ready" ? value.value.get() : [];
      };
      const workloads = {
        deployments: ready(entry.deployments),
        statefulSets: ready(entry.statefulSets),
        daemonSets: ready(entry.daemonSets),
        jobs: ready(entry.jobs),
        claims: ready(entry.claims),
      };
      const sample = prometheus.status === "ready" ? prometheus.sample : undefined;
      const error = nodes.status === "error" ? nodes.error : pods.status === "error" ? pods.error : undefined;
      const firing = [
        ...(sample?.alerts ?? []),
        ...nodeAlerts(record.id, nodeList),
        ...podAlerts(record.id, podList, now.get()),
        ...workloadAlerts(record.id, workloads, now.get()),
        ...eventAlerts(record.id, eventList),
      ];

      const resources = nodes.status === "ready" ? summarizeResources(nodeList, podList, sample) : undefined;

      return {
        ...base,
        loading: nodes.status === "loading",
        error,
        resources,
        prometheus,
        alerts: firing.filter((alert) => !mutes.isMuted(alert.key)),
        mutedAlerts: firing.filter((alert) => mutes.isMuted(alert.key)),
        version: mostCommon(nodeList.map((node) => node.status?.nodeInfo?.kubeletVersion)),
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

    const bySeverity = (a: FleetAlert, b: FleetAlert) =>
      severityOrder[a.severity] - severityOrder[b.severity] || (b.since ?? 0) - (a.since ?? 0);

    const alerts = computed(() => clusters.get().flatMap((cluster) => cluster.alerts).sort(bySeverity));
    const mutedAlerts = computed(() => clusters.get().flatMap((cluster) => cluster.mutedAlerts).sort(bySeverity));

    // A critical alert that was not there before raises a Lens notification, wherever the user is. Not for what
    // a cluster already had when it started being watched, not for a muted alert, and a few at most at once.
    const notifyNewCriticals = () => {
      // Each critical alert seen, with when it was last seen.
      const seen = new Map<string, number>();
      const warmingUp = (alert: FleetAlert) => {
        const entry = tracked.get(alert.clusterId);

        return entry === undefined || Date.now() - entry.trackedAt <= notifyAfterMs;
      };

      return reaction(
        () => alerts.get().filter((alert) => alert.severity === "critical" && !silencedAlerts.isSilenced(alert.key)),
        (critical) => {
          const fresh = selectNotifiable(critical, seen, {
            now: Date.now(),
            silenced: notificationSettings.state.get().kind !== "on",
            warmingUp,
          });

          const nameOf = (clusterId: string) =>
            records.get()?.get().find((record) => record.id === clusterId)?.name.get() ?? clusterId;

          fresh.slice(0, maxNotificationsAtOnce).forEach((alert) => notifyCriticalAlert(alert, nameOf(alert.clusterId)));

          if (fresh.length > maxNotificationsAtOnce) {
            showErrorNotification(
              `${fresh.length - maxNotificationsAtOnce} more critical alerts. Click the alert count in the status bar to see them all.`,
            );
          }
        },
      );
    };

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

    const nextAttemptAt = (clusterId: string) => {
      const failed = failures.get(clusterId) ?? 0;
      const delay = failed === 0 ? pollIntervalMs.get() : Math.min(pollIntervalMs.get() * 2 ** failed, maxConnectBackoffMs);

      return (lastAttempt.get(clusterId) ?? 0) + delay;
    };

    // One connection attempt, automatic or not; a failure doubles the wait before the next automatic one.
    const attempt = async (clusterId: string) => {
      runInAction(() => {
        lastAttempt.set(clusterId, Date.now());
        connecting.set(clusterId, "connecting");
      });

      let timer: ReturnType<typeof setTimeout> | undefined;

      // A connection that never answers would otherwise leave the card on "Connecting…" for good.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No answer after ${connectTimeoutMs / 1000}s`)), connectTimeoutMs);
      });

      try {
        await Promise.race([connectCluster(clusterId), timeout]);
        runInAction(() => {
          connecting.delete(clusterId);
          failures.delete(clusterId);
        });
      } catch (error) {
        runInAction(() => {
          connecting.set(clusterId, { error: errorText(error) });
          failures.set(clusterId, (failures.get(clusterId) ?? 0) + 1);
        });
      } finally {
        clearTimeout(timer);
      }
    };

    // The user asked: connect now, and keep it connected again from here on.
    const connect = (clusterId: string) => {
      runInAction(() => {
        paused.delete(clusterId);
        failures.delete(clusterId);
      });

      return attempt(clusterId);
    };

    return () => ({
      clusters,
      alerts,
      mutedAlerts,
      totals,
      isReady: computed(() => records.get() !== undefined),
      lastRefresh: computed(() => lastRefresh.get()),

      // Keeps the watches and polling alive while something is on screen that shows them: the dashboard, which
      // also connects the clusters (`autoConnect`), or the status bar, which only watches those connected already.
      start: ({ autoConnect }: { autoConnect: boolean }) => {
        users++;

        if (autoConnect) {
          runInAction(() => autoConnectUsers.set(autoConnectUsers.get() + 1));
        }

        if (users === 1) {
          stopRunning = run();
        }

        return () => {
          users--;

          if (autoConnect) {
            runInAction(() => autoConnectUsers.set(autoConnectUsers.get() - 1));
          }

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
