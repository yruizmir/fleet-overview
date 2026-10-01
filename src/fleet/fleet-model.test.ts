import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NodeV1, PodV1 } from "@k8slens/kubernetes-contracts";
import type { PrometheusSeries } from "@k8slens/prometheus-contracts";
import {
  eventAlerts,
  type EventV1,
  formatAge,
  nodeAlerts,
  podAlerts,
  prometheusAlerts,
  type Workloads,
  workloadAlerts,
} from "./fleet-model";

const now = Date.parse("2026-10-01T08:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const minutes = (count: number) => count * 60_000;
const days = (count: number) => count * 24 * 60 * 60_000;

const pod = (status: object, phase = "Running", created = ago(days(8))) =>
  ({
    metadata: { name: "vm-0", namespace: "monitoring", creationTimestamp: created },
    status: { phase, ...status },
  }) as unknown as PodV1;

const container = (state: object, lastState: object = {}, restartCount = 0) => ({
  name: "vmsingle",
  restartCount,
  state,
  lastState,
});

describe("formatAge", () => {
  test("seconds, minutes, hours and days", () => {
    assert.equal(formatAge(40_000), "40s");
    assert.equal(formatAge(minutes(12)), "12m");
    assert.equal(formatAge(minutes(180)), "3h");
    assert.equal(formatAge(days(8)), "8d");
  });
});

describe("podAlerts", () => {
  test("a container in CrashLoopBackOff is critical, and says the pod still shows Running", () => {
    const [alert] = podAlerts(
      "c1",
      [
        pod({
          containerStatuses: [
            container(
              { waiting: { reason: "CrashLoopBackOff" } },
              { terminated: { reason: "Error", exitCode: 255, finishedAt: ago(minutes(4)) } },
              28,
            ),
          ],
        }),
      ],
      now,
    );

    assert.equal(alert?.severity, "critical");
    assert.equal(alert?.title, "CrashLoopBackOff");
    assert.match(alert?.detail ?? "", /28 restarts/);
    assert.match(alert?.detail ?? "", /code 255/);
    assert.match(alert?.detail ?? "", /still shows Running/);
    assert.equal(alert?.since, now - minutes(4));
  });

  test("between two crashes the same alert stays, under the same key, so it does not flicker", () => {
    const waiting = podAlerts(
      "c1",
      [pod({ containerStatuses: [container({ waiting: { reason: "CrashLoopBackOff" } }, {}, 55)] })],
      now,
    );
    const running = podAlerts(
      "c1",
      [
        pod({
          containerStatuses: [
            container({ running: { startedAt: ago(30_000) } }, { terminated: { reason: "Completed", exitCode: 0, finishedAt: ago(30_000) } }, 55),
          ],
        }),
      ],
      now,
    );

    assert.equal(running[0]?.severity, "critical");
    assert.equal(running[0]?.key, waiting[0]?.key);
  });

  test("a clean exit after a crash loop is read as Kubernetes stopping it, often a liveness probe", () => {
    const [alert] = podAlerts(
      "c1",
      [
        pod({
          containerStatuses: [
            container({ waiting: { reason: "CrashLoopBackOff" } }, { terminated: { reason: "Completed", exitCode: 0, finishedAt: ago(minutes(4)) } }, 55),
          ],
        }),
      ],
      now,
    );

    assert.match(alert?.detail ?? "", /liveness probe/);
  });

  test("a container that crashed long ago and runs since is not an alert", () => {
    const alerts = podAlerts(
      "c1",
      [pod({ containerStatuses: [container({ running: {} }, { terminated: { reason: "Error", finishedAt: ago(days(2)) } }, 7)] })],
      now,
    );

    assert.deepEqual(alerts, []);
  });

  test("restarting often, but not looping, is a warning", () => {
    const [alert] = podAlerts(
      "c1",
      [pod({ containerStatuses: [container({ running: {} }, { terminated: { reason: "Error", finishedAt: ago(minutes(30)) } }, 6)] })],
      now,
    );

    assert.equal(alert?.title, "FrequentRestarts");
    assert.equal(alert?.severity, "warning");
  });

  test("a recent OOM kill is a warning", () => {
    const [alert] = podAlerts(
      "c1",
      [pod({ containerStatuses: [container({ running: {} }, { terminated: { reason: "OOMKilled", finishedAt: ago(minutes(20)) } }, 1)] })],
      now,
    );

    assert.equal(alert?.title, "OOMKilled");
  });

  test("an image that cannot be pulled is a warning, without the Running note", () => {
    const [alert] = podAlerts(
      "c1",
      [pod({ containerStatuses: [container({ waiting: { reason: "ImagePullBackOff" } })] }, "Pending")],
      now,
    );

    assert.equal(alert?.severity, "warning");
    assert.doesNotMatch(alert?.detail ?? "", /Running/);
  });

  test("pending over ten minutes says why when the scheduler said so", () => {
    const [alert] = podAlerts(
      "c1",
      [
        pod(
          { conditions: [{ type: "PodScheduled", status: "False", message: "0/3 nodes have a GPU" }] },
          "Pending",
          ago(minutes(15)),
        ),
      ],
      now,
    );

    assert.equal(alert?.title, "PodUnschedulable");
    assert.match(alert?.detail ?? "", /0\/3 nodes have a GPU/);
  });

  test("a pod pending for less than ten minutes is not an alert yet", () => {
    assert.deepEqual(podAlerts("c1", [pod({}, "Pending", ago(minutes(3)))], now), []);
  });
});

describe("nodeAlerts", () => {
  const node = (conditions: object[], unschedulable = false) =>
    ({ metadata: { name: "n1" }, spec: { unschedulable }, status: { conditions } }) as unknown as NodeV1;

  test("a node that is not Ready is critical; pressure is a warning; cordoned is info", () => {
    const alerts = nodeAlerts("c1", [
      node(
        [
          { type: "Ready", status: "False", message: "kubelet stopped posting" },
          { type: "DiskPressure", status: "True" },
        ],
        true,
      ),
    ]);

    assert.deepEqual(
      alerts.map((alert) => [alert.title, alert.severity]),
      [
        ["NodeNotReady", "critical"],
        ["NodeDiskPressure", "warning"],
        ["NodeCordoned", "info"],
      ],
    );
  });

  test("a Ready node has no alerts", () => {
    assert.deepEqual(nodeAlerts("c1", [node([{ type: "Ready", status: "True" }])]), []);
  });
});

describe("workloadAlerts", () => {
  const none: Workloads = { deployments: [], statefulSets: [], daemonSets: [], jobs: [], claims: [] };

  test("a Deployment unavailable for over ten minutes is a warning; a rollout in progress is not", () => {
    const deployment = (since: number) => ({
      metadata: { name: "web", namespace: "shop" },
      spec: { replicas: 3 },
      status: { availableReplicas: 1, conditions: [{ type: "Available", status: "False", lastTransitionTime: ago(since) }] },
    });

    const late = workloadAlerts("c1", { ...none, deployments: [deployment(minutes(30))] as never }, now);
    const rolling = workloadAlerts("c1", { ...none, deployments: [deployment(minutes(2))] as never }, now);

    assert.equal(late[0]?.title, "DeploymentUnavailable");
    assert.match(late[0]?.detail ?? "", /1 of 3 replicas/);
    assert.deepEqual(rolling, []);
  });

  test("a Job that failed today is a warning, one from last week is not", () => {
    const job = (since: number) => ({
      metadata: { name: "backup", namespace: "ops" },
      status: { conditions: [{ type: "Failed", status: "True", lastTransitionTime: ago(since), message: "BackoffLimitExceeded" }] },
    });

    assert.equal(workloadAlerts("c1", { ...none, jobs: [job(minutes(90))] as never }, now)[0]?.title, "JobFailed");
    assert.deepEqual(workloadAlerts("c1", { ...none, jobs: [job(days(7))] as never }, now), []);
  });

  test("a claim with no volume after ten minutes is a warning", () => {
    const claim = { metadata: { name: "data", namespace: "db", creationTimestamp: ago(minutes(20)) }, status: { phase: "Pending" } };

    assert.equal(workloadAlerts("c1", { ...none, claims: [claim] as never }, now)[0]?.title, "VolumeClaimPending");
  });
});

describe("prometheusAlerts", () => {
  const series = (metric: Record<string, string>) => ({ metric, values: [] }) as unknown as PrometheusSeries;

  test("severity follows the alert's label, and Watchdog is noise", () => {
    const alerts = prometheusAlerts("c1", [
      series({ alertname: "KubePodCrashLooping", severity: "critical", namespace: "a", pod: "p" }),
      series({ alertname: "TargetDown", severity: "warning", job: "queue-master" }),
      series({ alertname: "Watchdog", severity: "none" }),
    ]);

    assert.deepEqual(
      alerts.map((alert) => [alert.title, alert.severity]),
      [
        ["KubePodCrashLooping", "critical"],
        ["TargetDown", "warning"],
      ],
    );
    assert.deepEqual(alerts[0]?.target, { type: "pod", namespace: "a", name: "p" });
  });
});

describe("eventAlerts", () => {
  test("Warning events group by object and reason, with their total count", () => {
    const event = (count: number, at: number) =>
      ({
        metadata: { name: "e", namespace: "argocd", uid: String(at) },
        type: "Warning",
        reason: "Unhealthy",
        message: "Liveness probe failed",
        count,
        lastTimestamp: ago(at),
        involvedObject: { kind: "Pod", name: "repo-server", namespace: "argocd" },
      }) as EventV1;

    const alerts = eventAlerts("c1", [event(30, minutes(10)), event(50, minutes(4))]);

    assert.equal(alerts.length, 1);
    assert.match(alerts[0]?.detail ?? "", /×80/);
  });
});
