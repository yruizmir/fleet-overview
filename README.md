# Multi-Cluster View

One view of all your clusters in Lens: the physical resources and the firing alerts of every cluster you have, on one tab.

## Features

- **Fleet totals**: clusters connected, nodes ready, and CPU, memory, node storage, GPUs and pod slots summed across the fleet, each as used / allocatable with the share requested.
- **One alerts panel for all clusters**, sorted by severity:
  - Prometheus alerts that are firing (`ALERTS{alertstate="firing"}`), when the cluster has a Prometheus Lens can reach.
  - Node problems: NotReady, memory, disk or PID pressure, network unavailable, cordoned.
  - Kubernetes Warning events, grouped per object and reason (what Lens's cluster overview lists under Needs attention).
  - Pod problems: CrashLoopBackOff, image pull errors, config errors, recent OOM kills, pods pending over 10 minutes.
  - Filter by severity (All, Critical, Warning, Info) or by one cluster (click its alert count). Click an alert to go to its pod, node or namespace.
  - **Ask AI** on each alert takes you to the affected resource and starts a troubleshooting conversation on that cluster, briefed with the alert, where to start looking and the logs to read first, including those of the run that crashed.
- **Capacity per cluster**: one card per cluster with where it comes from (a path you set with **+ Set source path**; Lens does not tell extensions a cluster's kubeconfig or folder), its status, nodes, storage, metrics source, CPU / memory / pod rings as in Lens's cluster overview, and its alert count.

Allocatable and requests come from the nodes and pods of each cluster, watched live. Real CPU, memory and root-filesystem usage come from Prometheus (node-exporter, with cAdvisor as a fallback) at every refresh: every 30 seconds by default, or pick 1, 2, 5 or 10 minutes under **Auto-refresh** next to Refresh.

## Usage

Open it from the dashboard button in the top bar, the **Multi-Cluster View** item in the navigator, or **Multi-Cluster View: Open** in the command palette. While it is open it keeps every cluster it lists connected: new clusters are connected as they appear, and one that is down or was disconnected is tried again at every refresh. A cluster that cannot be reached shows **Failed to connect**, with a Connect button to retry at once. Click a cluster's name or its rings to open its Lens overview; this goes through the Lens CLI (`lens clusters connect <name> --open`), so it needs **Install Lens CLI** turned on in Lens Preferences, and opens the cluster's nodes otherwise.

## Development

1. `npm install`
2. `npm run build` after every change under `src/`

What changed in each version is in [CHANGELOG.md](./CHANGELOG.md).
