import type {
  DaemonSetV1,
  DeploymentV1,
  JobV1,
  KubeResource,
  NodeV1,
  PersistentVolumeClaimV1,
  PodV1,
  StatefulSetV1,
} from "@k8slens/kubernetes-contracts";
import type { PrometheusSeries } from "@k8slens/prometheus-contracts";
import type { coreV1 } from "@k8slens/kubernetes-contracts";
import type { eventKind } from "./event-kind";
import { parseQuantity } from "./quantity";

export type EventV1 = KubeResource<typeof eventKind, typeof coreV1>;

export type Severity = "critical" | "warning" | "info";

export const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet" | "Job" | "PersistentVolumeClaim";

export type AlertTarget =
  | { readonly type: "node"; readonly name: string }
  | { readonly type: "pod"; readonly namespace: string; readonly name: string }
  | { readonly type: "namespace"; readonly namespace: string }
  | { readonly type: "workload"; readonly kind: WorkloadKind; readonly namespace: string; readonly name: string }
  | { readonly type: "cluster" };

export interface FleetAlert {
  readonly key: string;
  readonly clusterId: string;
  readonly source: "prometheus" | "node" | "pod" | "event" | "workload";
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

const waitingText: Record<string, string> = {
  CrashLoopBackOff: "keeps crashing and Kubernetes waits longer before each restart",
  ImagePullBackOff: "cannot pull its image",
  ErrImagePull: "cannot pull its image",
  CreateContainerConfigError: "cannot start: its configuration refers to something missing (a ConfigMap, Secret or key)",
  CreateContainerError: "cannot be created",
  InvalidImageName: "names an image that is not valid",
};

const pendingTooLongMs = 10 * 60 * 1000;
// A container that crashed this recently, after this many restarts, is still crash-looping even in the seconds it
// shows as running between two crashes; without this the alert would come and go with every restart.
const crashLoopWindowMs = 10 * 60 * 1000;
const crashLoopRestarts = 3;
// Restarts that are not a loop yet but are worth a look: this many, the last one within the hour.
const frequentRestarts = 5;
const hourMs = 60 * 60 * 1000;

// "8d", "3h", "12m", "40s": how long ago, as a short duration.
export const formatAge = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

type ContainerStatus = NonNullable<NonNullable<PodV1["status"]>["containerStatuses"]>[number];

const lastExit = (status: ContainerStatus) => {
  const terminated = status.lastState?.terminated;

  if (!terminated) {
    return "";
  }

  // A liveness probe kills with a clean exit, which reads as "Completed": say what really happened.
  const why = terminated.reason === "Completed" && terminated.exitCode === 0 ? "stopped by Kubernetes, often a failing liveness probe" : terminated.reason ?? "exited";

  return `; last exit: ${why}${terminated.exitCode ? `, code ${terminated.exitCode}` : ""}`;
};

export const podAlerts = (clusterId: string, pods: readonly PodV1[], now: number): FleetAlert[] =>
  pods.flatMap((pod): FleetAlert[] => {
    const { name, namespace } = pod.metadata;
    const target: AlertTarget = { type: "pod", namespace: namespace ?? "default", name };
    const initNames = new Set((pod.status?.initContainerStatuses ?? []).map((status) => status.name));
    const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
    const created = pod.metadata.creationTimestamp ? Date.parse(pod.metadata.creationTimestamp) : undefined;
    const age = created ? `, pod started ${formatAge(now - created)} ago` : "";
    // The phase is what Lens shows for the pod, and it stays Running while a container crash-loops.
    const phase = pod.status?.phase === "Running" ? "; the pod still shows Running" : "";
    const alert = (reason: string, severity: Severity, detail: string, since?: number): FleetAlert[] => [
      { key: `${clusterId}/pod/${namespace}/${name}/${reason}`, clusterId, source: "pod", severity, title: reason, detail, since, target },
    ];

    for (const status of statuses) {
      const reason = status.state?.waiting?.reason;
      const finishedAt = status.lastState?.terminated?.finishedAt;
      const lastCrash = finishedAt ? Date.parse(finishedAt) : undefined;
      const restarts = `${status.restartCount} restart${status.restartCount === 1 ? "" : "s"}`;

      if (reason && badWaitingReasons[reason]) {
        return alert(
          reason,
          badWaitingReasons[reason],
          `${namespace}/${name}: container ${status.name} ${waitingText[reason]} (${restarts}${age}${reason === "CrashLoopBackOff" ? lastExit(status) : ""})${reason === "CrashLoopBackOff" ? phase : ""}`,
          lastCrash ?? created,
        );
      }

      // The moment between dying and Kubernetes scheduling the next restart: still the same crash loop. Not for an
      // init container, whose job is to run to completion and be terminated.
      const justDied = initNames.has(status.name) ? undefined : status.state?.terminated;

      if (justDied && status.restartCount >= crashLoopRestarts && pod.status?.phase === "Running") {
        return alert(
          "CrashLoopBackOff",
          "critical",
          `${namespace}/${name}: container ${status.name} keeps crashing; it just exited and will be restarted (${restarts}${age}${lastExit({ ...status, lastState: { terminated: justDied } })})${phase}`,
          justDied.finishedAt ? Date.parse(justDied.finishedAt) : lastCrash,
        );
      }

      if (status.state?.running && lastCrash !== undefined) {
        // Between two crashes: still the same CrashLoopBackOff alert, under the same key, so it does not flicker.
        if (status.restartCount >= crashLoopRestarts && now - lastCrash < crashLoopWindowMs) {
          return alert(
            "CrashLoopBackOff",
            "critical",
            `${namespace}/${name}: container ${status.name} keeps crashing; it restarted ${formatAge(now - lastCrash)} ago and may crash again (${restarts}${age}${lastExit(status)})${phase}`,
            lastCrash,
          );
        }

        if (status.lastState?.terminated?.reason === "OOMKilled" && now - lastCrash < hourMs) {
          return alert(
            "OOMKilled",
            "warning",
            `${namespace}/${name}: container ${status.name} was killed ${formatAge(now - lastCrash)} ago for running out of memory (${restarts})`,
            lastCrash,
          );
        }

        if (status.restartCount >= frequentRestarts && now - lastCrash < hourMs) {
          return alert(
            "FrequentRestarts",
            "warning",
            `${namespace}/${name}: container ${status.name} restarts often, last ${formatAge(now - lastCrash)} ago (${restarts}${age}${lastExit(status)})`,
            lastCrash,
          );
        }
      }
    }

    if (pod.status?.phase === "Pending" && created !== undefined && now - created > pendingTooLongMs) {
      const unschedulable = pod.status.conditions?.find(
        (condition) => condition.type === "PodScheduled" && condition.status === "False",
      );

      return alert(
        "Pending",
        "warning",
        `${namespace}/${name} pending for ${formatAge(now - created)}${unschedulable?.message ? `: ${unschedulable.message}` : ""}`,
        created,
      ).map((one) => ({ ...one, title: unschedulable ? "PodUnschedulable" : "PodPendingTooLong" }));
    }

    return [];
  });

export interface Workloads {
  readonly deployments: readonly DeploymentV1[];
  readonly statefulSets: readonly StatefulSetV1[];
  readonly daemonSets: readonly DaemonSetV1[];
  readonly jobs: readonly JobV1[];
  readonly claims: readonly PersistentVolumeClaimV1[];
}

// A rollout or a new claim takes a while; only what stays short this long is a problem.
const settleMs = 10 * 60 * 1000;
const failedJobWindowMs = 24 * 60 * 60 * 1000;

// Workloads short of what they asked for, Jobs that failed in the last day and claims that never got a volume.
export const workloadAlerts = (clusterId: string, workloads: Workloads, now: number): FleetAlert[] => {
  const alerts: FleetAlert[] = [];
  const add = (kind: WorkloadKind, namespace: string | undefined, name: string, title: string, detail: string, since?: number) =>
    alerts.push({
      key: `${clusterId}/${kind}/${namespace}/${name}/${title}`,
      clusterId,
      source: "workload",
      severity: "warning",
      title,
      detail,
      since,
      target: { type: "workload", kind, namespace: namespace ?? "default", name },
    });
  const settled = (time: string | undefined) => !time || now - Date.parse(time) > settleMs;

  for (const deployment of workloads.deployments) {
    const { name, namespace } = deployment.metadata;
    const wanted = deployment.spec?.replicas ?? 1;
    const available = deployment.status?.availableReplicas ?? 0;
    const condition = deployment.status?.conditions?.find((one) => one.type === "Available" && one.status === "False");

    if (wanted > 0 && available < wanted && condition && settled(condition.lastTransitionTime)) {
      add(
        "Deployment",
        namespace,
        name,
        "DeploymentUnavailable",
        `${namespace}/${name}: ${available} of ${wanted} replicas available for ${formatAge(now - Date.parse(condition.lastTransitionTime ?? ""))}`,
        condition.lastTransitionTime ? Date.parse(condition.lastTransitionTime) : undefined,
      );
    }
  }

  for (const statefulSet of workloads.statefulSets) {
    const { name, namespace, creationTimestamp } = statefulSet.metadata;
    const wanted = statefulSet.spec?.replicas ?? 1;
    const ready = statefulSet.status?.readyReplicas ?? 0;

    if (wanted > 0 && ready < wanted && settled(creationTimestamp)) {
      add("StatefulSet", namespace, name, "StatefulSetNotReady", `${namespace}/${name}: ${ready} of ${wanted} replicas ready`);
    }
  }

  for (const daemonSet of workloads.daemonSets) {
    const { name, namespace, creationTimestamp } = daemonSet.metadata;
    const unavailable = daemonSet.status?.numberUnavailable ?? 0;
    const wanted = daemonSet.status?.desiredNumberScheduled ?? 0;

    if (unavailable > 0 && settled(creationTimestamp)) {
      add("DaemonSet", namespace, name, "DaemonSetUnavailable", `${namespace}/${name}: ${unavailable} of ${wanted} pods unavailable`);
    }
  }

  for (const job of workloads.jobs) {
    const { name, namespace } = job.metadata;
    const failed = job.status?.conditions?.find((one) => one.type === "Failed" && one.status === "True");
    const at = failed?.lastTransitionTime ? Date.parse(failed.lastTransitionTime) : undefined;

    if (failed && at !== undefined && now - at < failedJobWindowMs) {
      add("Job", namespace, name, "JobFailed", `${namespace}/${name} failed ${formatAge(now - at)} ago${failed.message ? `: ${failed.message}` : ""}`, at);
    }
  }

  for (const claim of workloads.claims) {
    const { name, namespace, creationTimestamp } = claim.metadata;

    if (claim.status?.phase === "Pending" && settled(creationTimestamp)) {
      const created = creationTimestamp ? Date.parse(creationTimestamp) : undefined;

      add(
        "PersistentVolumeClaim",
        namespace,
        name,
        "VolumeClaimPending",
        `${namespace}/${name} has had no volume for ${created ? formatAge(now - created) : "a while"}`,
        created,
      );
    }
  }

  return alerts;
};

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
