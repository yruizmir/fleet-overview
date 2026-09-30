import type { KubeResource, NodeV1, PodV1 } from "@k8slens/kubernetes-contracts";
import type { PrometheusSeries } from "@k8slens/prometheus-contracts";
import type { coreV1 } from "@k8slens/kubernetes-contracts";
import type { eventKind } from "./event-kind";
import { parseQuantity } from "./quantity";

export type EventV1 = KubeResource<typeof eventKind, typeof coreV1>;

export type Severity = "critical" | "warning" | "info";

export const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export type AlertTarget =
  | { readonly type: "node"; readonly name: string }
  | { readonly type: "pod"; readonly namespace: string; readonly name: string }
  | { readonly type: "namespace"; readonly namespace: string }
  | { readonly type: "cluster" };

export interface FleetAlert {
  readonly key: string;
  readonly clusterId: string;
  readonly source: "prometheus" | "node" | "pod" | "event";
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly since?: number;
  readonly target: AlertTarget;
}

export interface Resource {
  readonly capacity: number;
  readonly allocatable: number;
  readonly requested: number;
  readonly limits?: number;
  readonly used?: number;
}

export interface ClusterResources {
  readonly nodesTotal: number;
  readonly nodesReady: number;
  readonly cpu: Resource;
  readonly memory: Resource;
  readonly storage: Resource;
  readonly gpu: Resource;
  readonly pods: Resource;
}

export interface PrometheusSample {
  readonly cpuUsedCores?: number;
  readonly memoryUsedBytes?: number;
  readonly storageUsedBytes?: number;
  readonly alerts: readonly FleetAlert[];
}

const gpuResourceNames = ["nvidia.com/gpu", "amd.com/gpu", "gpu.intel.com/i915"];

const sumGpus = (resources: Record<string, string> | undefined) =>
  gpuResourceNames.reduce((sum, name) => sum + parseQuantity(resources?.[name]), 0);

const isActivePod = (pod: PodV1) =>
  !!pod.spec.nodeName && pod.status?.phase !== "Succeeded" && pod.status?.phase !== "Failed";

export const summarizeResources = (
  nodes: readonly NodeV1[],
  pods: readonly PodV1[],
  prometheus: PrometheusSample | undefined,
): ClusterResources => {
  let cpuCapacity = 0, cpuAllocatable = 0, memCapacity = 0, memAllocatable = 0;
  let storageCapacity = 0, storageAllocatable = 0, gpuCapacity = 0, gpuAllocatable = 0;
  let podCapacity = 0, podAllocatable = 0, nodesReady = 0;

  for (const node of nodes) {
    const capacity = node.status?.capacity;
    const allocatable = node.status?.allocatable;

    cpuCapacity += parseQuantity(capacity?.cpu);
    cpuAllocatable += parseQuantity(allocatable?.cpu);
    memCapacity += parseQuantity(capacity?.memory);
    memAllocatable += parseQuantity(allocatable?.memory);
    storageCapacity += parseQuantity(capacity?.["ephemeral-storage"]);
    storageAllocatable += parseQuantity(allocatable?.["ephemeral-storage"]);
    gpuCapacity += sumGpus(capacity);
    gpuAllocatable += sumGpus(allocatable);
    podCapacity += parseQuantity(capacity?.pods);
    podAllocatable += parseQuantity(allocatable?.pods);

    if (node.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")) {
      nodesReady++;
    }
  }

  let cpuLimits = 0, memLimits = 0;
  let cpuRequested = 0, memRequested = 0, storageRequested = 0, gpuRequested = 0, activePods = 0;

  for (const pod of pods) {
    if (!isActivePod(pod)) {
      continue;
    }

    activePods++;

    for (const container of pod.spec.containers ?? []) {
      const requests = container.resources?.requests;

      const limits = container.resources?.limits;

      cpuRequested += parseQuantity(requests?.cpu);
      cpuLimits += parseQuantity(limits?.cpu);
      memLimits += parseQuantity(limits?.memory);
      memRequested += parseQuantity(requests?.memory);
      storageRequested += parseQuantity(requests?.["ephemeral-storage"]);
      gpuRequested += sumGpus(container.resources?.limits ?? requests);
    }
  }

  return {
    nodesTotal: nodes.length,
    nodesReady,
    cpu: { capacity: cpuCapacity, allocatable: cpuAllocatable, requested: cpuRequested, limits: cpuLimits, used: prometheus?.cpuUsedCores },
    memory: { capacity: memCapacity, allocatable: memAllocatable, requested: memRequested, limits: memLimits, used: prometheus?.memoryUsedBytes },
    storage: { capacity: storageCapacity, allocatable: storageAllocatable, requested: storageRequested, used: prometheus?.storageUsedBytes },
    gpu: { capacity: gpuCapacity, allocatable: gpuAllocatable, requested: gpuRequested },
    pods: { capacity: podCapacity, allocatable: podAllocatable, requested: activePods, used: activePods },
  };
};

const pressureConditions = ["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"];

export const nodeAlerts = (clusterId: string, nodes: readonly NodeV1[]): FleetAlert[] =>
  nodes.flatMap((node): FleetAlert[] => {
    const name = node.metadata.name;
    const conditions = node.status?.conditions ?? [];
    const ready = conditions.find((condition) => condition.type === "Ready");
    const target: AlertTarget = { type: "node", name };
    const since = (time?: string) => (time ? Date.parse(time) : undefined);
    const alerts: FleetAlert[] = [];

    if (ready?.status !== "True") {
      alerts.push({
        key: `${clusterId}/node/${name}/NotReady`,
        clusterId,
        source: "node",
        severity: "critical",
        title: "NodeNotReady",
        detail: `${name}: ${ready?.message ?? "the node is not reporting Ready"}`,
        since: since(ready?.lastTransitionTime),
        target,
      });
    }

    for (const condition of conditions) {
      if (pressureConditions.includes(condition.type) && condition.status === "True") {
        alerts.push({
          key: `${clusterId}/node/${name}/${condition.type}`,
          clusterId,
          source: "node",
          severity: "warning",
          title: `Node${condition.type}`,
          detail: `${name}: ${condition.message ?? condition.type}`,
          since: since(condition.lastTransitionTime),
          target,
        });
      }
    }

    if (node.spec.unschedulable) {
      alerts.push({
        key: `${clusterId}/node/${name}/Cordoned`,
        clusterId,
        source: "node",
        severity: "info",
        title: "NodeCordoned",
        detail: `${name} is cordoned and takes no new pods`,
        target,
      });
    }

    return alerts;
  });

const badWaitingReasons: Record<string, Severity> = {
  CrashLoopBackOff: "critical",
  ImagePullBackOff: "warning",
  ErrImagePull: "warning",
  CreateContainerConfigError: "warning",
  CreateContainerError: "warning",
  InvalidImageName: "warning",
};

const pendingTooLongMs = 10 * 60 * 1000;

export const podAlerts = (clusterId: string, pods: readonly PodV1[], now: number): FleetAlert[] =>
  pods.flatMap((pod): FleetAlert[] => {
    const { name, namespace } = pod.metadata;
    const target: AlertTarget = { type: "pod", namespace: namespace ?? "default", name };
    const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];

    for (const status of statuses) {
      const reason = status.state?.waiting?.reason;

      if (reason && badWaitingReasons[reason]) {
        return [
          {
            key: `${clusterId}/pod/${namespace}/${name}/${reason}`,
            clusterId,
            source: "pod",
            severity: badWaitingReasons[reason],
            title: reason,
            detail: `${namespace}/${name} (${status.name}, ${status.restartCount} restarts)`,
            target,
          },
        ];
      }

      if (status.lastState?.terminated?.reason === "OOMKilled" && status.state?.running) {
        const finishedAt = status.lastState.terminated.finishedAt;
        const at = finishedAt ? Date.parse(finishedAt) : 0;

        if (now - at < 60 * 60 * 1000) {
          return [
            {
              key: `${clusterId}/pod/${namespace}/${name}/OOMKilled`,
              clusterId,
              source: "pod",
              severity: "warning",
              title: "OOMKilled",
              detail: `${namespace}/${name} (${status.name}) was killed for running out of memory`,
              since: at || undefined,
              target,
            },
          ];
        }
      }
    }

    if (pod.status?.phase === "Pending") {
      const created = pod.metadata.creationTimestamp ? Date.parse(pod.metadata.creationTimestamp) : now;

      if (now - created > pendingTooLongMs) {
        const unschedulable = pod.status.conditions?.find(
          (condition) => condition.type === "PodScheduled" && condition.status === "False",
        );

        return [
          {
            key: `${clusterId}/pod/${namespace}/${name}/Pending`,
            clusterId,
            source: "pod",
            severity: "warning",
            title: unschedulable ? "PodUnschedulable" : "PodPendingTooLong",
            detail: `${namespace}/${name}${unschedulable?.message ? `: ${unschedulable.message}` : ""}`,
            since: created,
            target,
          },
        ];
      }
    }

    return [];
  });

const noiseAlerts = new Set(["Watchdog", "InfoInhibitor"]);

const toSeverity = (value: string | undefined): Severity =>
  value === "critical" || value === "error" || value === "page"
    ? "critical"
    : value === "warning" || value === "warn"
      ? "warning"
      : "info";

export const prometheusAlerts = (clusterId: string, series: readonly PrometheusSeries[]): FleetAlert[] =>
  series
    .filter((one) => !noiseAlerts.has(one.metric.alertname ?? ""))
    .map((one) => {
      const { alertname = "Alert", severity, namespace, pod, node, instance, job, service } = one.metric;
      const where = [namespace && `ns ${namespace}`, pod && `pod ${pod}`, node && `node ${node}`, service && `svc ${service}`]
        .filter(Boolean)
        .join(", ");
      const labels = Object.entries(one.metric)
        .filter(([label]) => !["__name__", "alertstate", "alertname", "severity", "prometheus"].includes(label))
        .map(([label, value]) => `${label}=${value}`)
        .join(" ");
      const target: AlertTarget =
        pod && namespace
          ? { type: "pod", namespace, name: pod }
          : node
            ? { type: "node", name: node }
            : namespace
              ? { type: "namespace", namespace }
              : { type: "cluster" };

      return {
        key: `${clusterId}/prom/${alertname}/${labels}`,
        clusterId,
        source: "prometheus" as const,
        severity: toSeverity(severity),
        title: alertname,
        detail: where || instance || job || labels || "cluster-wide",
        target,
      };
    });

export const lastValue = (series: readonly PrometheusSeries[]): number | undefined => {
  if (series.length === 0) {
    return undefined;
  }

  let total = 0;
  let found = false;

  for (const one of series) {
    const last = one.values[one.values.length - 1];
    const value = last ? Number(last[1]) : NaN;

    if (Number.isFinite(value)) {
      total += value;
      found = true;
    }
  }

  return found ? total : undefined;
};

// Warning events, one row per object and reason, newest first: Lens's "Needs attention".
export const eventAlerts = (clusterId: string, events: readonly EventV1[]): FleetAlert[] => {
  const grouped = new Map<string, FleetAlert & { count: number }>();

  for (const event of events) {
    if (event.type !== "Warning") {
      continue;
    }

    const { kind = "Object", name = "", namespace } = event.involvedObject;
    const reason = event.reason ?? "Warning";
    const key = `${clusterId}/event/${kind}/${namespace ?? ""}/${name}/${reason}`;
    const timestamp = event.series?.lastObservedTime ?? event.lastTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp;
    const since = timestamp ? Date.parse(timestamp) : undefined;
    const count = event.series?.count ?? event.count ?? 1;
    const previous = grouped.get(key);
    const target: AlertTarget =
      kind === "Pod" && namespace
        ? { type: "pod", namespace, name }
        : kind === "Node"
          ? { type: "node", name }
          : namespace
            ? { type: "namespace", namespace }
            : { type: "cluster" };

    if (previous && (previous.since ?? 0) >= (since ?? 0)) {
      previous.count += count;
      continue;
    }

    grouped.set(key, {
      key,
      clusterId,
      source: "event",
      severity: "warning",
      title: reason,
      detail: `${kind} ${namespace ? `${namespace}/` : ""}${name}: ${event.message ?? ""}`,
      since,
      target,
      count: count + (previous?.count ?? 0),
    });
  }

  return [...grouped.values()].map(({ count, ...alert }) => ({
    ...alert,
    detail: count > 1 ? `${alert.detail} (×${count})` : alert.detail,
  }));
};
