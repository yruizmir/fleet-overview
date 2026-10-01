# Multi-Cluster View

Every cluster you have in Lens on one tab: what it has, what it uses, and what is wrong with it. A count of critical and warning alerts sits in the status bar wherever you are, and a new critical problem raises a notification you can act on right there: open it, troubleshoot it with Ask AI, or mute it.

- **One view of all clusters**: totals across all of them, one alerts panel, a card per cluster.
- **Alerts that are real**: crash loops, failing images, short Deployments, failed Jobs, unready nodes, firing Prometheus alerts, Warning events.
- **Kept connected**: clusters connect as they appear, and ones that are down are retried, less often each time they fail.
- **Ask AI on any alert**: the assistant starts on the right cluster, told which logs to read first.
- **Quiet when you want**: mute an alert for a day, never be notified about one, or pause all notifications.

## Open it

| From | Where |
| --- | --- |
| The dashboard button | Top bar, right |
| **Multi-Cluster View** | Navigator, top item |
| **Multi-Cluster View: Open** | Command palette |
| The alert count | Status bar, right |

## The view

### Controls and totals

Top right, **Auto-refresh ‹ 30s ›** and **Refresh** sit above **Notifications: On · Pause 24h · Off** and **Settings**. Below the title, seven tiles add up every connected cluster: clusters connected, nodes ready, CPU, memory, node storage, GPUs and pods, each as used against allocatable.

![The title, Auto-refresh and Refresh, and the tiles adding up all clusters](assets/screenshots/all-clusters.png)

### Alerts

The alerts of every connected cluster in one list, most severe first. Filter by severity (All, Critical, Warning, Info), or by one cluster by clicking its alert count on its card. Click an alert to go to its pod, node, workload or namespace.

![The alerts panel with two CrashLoopBackOff alerts, each with Mute 24h and Ask AI](assets/screenshots/alerts.png)

### Capacity per cluster

A card per cluster: its status, Kubernetes version, nodes, storage, metrics source, CPU, memory and pod rings as in Lens's own cluster overview, and its alert counts. A version two minor versions or more behind your newest cluster shows in warning colour. Where a cluster comes from is a path you set with **+ Set source path**, since Lens does not tell extensions a cluster's kubeconfig.

**Find a cluster** filters the cards by name. **Sort by Health** puts clusters with critical alerts first and disconnected ones last; **Name** sorts them alphabetically. Click a cluster's name or its rings to open its Lens overview.

![Cards for three clusters with their status, version, rings and alert counts](assets/screenshots/cluster-cards.png)

### Status bar

The critical and warning alerts of your connected clusters, or **All clusters OK**, wherever you are in Lens. Click it to open the view. It watches the clusters already connected; connecting the others is the view's to do.

![The status bar: 2 critical, 30 warning](assets/screenshots/status-bar.png)

## What it alerts on

Three things are critical: a node that is not Ready, a container in a crash loop, and a Prometheus alert labelled critical. Only connected clusters are checked.

| Alert | Severity | Fires when |
| --- | --- | --- |
| NodeNotReady | Critical | A node's Ready condition is not True |
| CrashLoopBackOff | Critical | A container keeps crashing: waiting in CrashLoopBackOff, or 3 or more restarts with one in the last 10 minutes. Init containers that completed never count |
| Prometheus alert | Its `severity` label | It is firing in `ALERTS`; Watchdog and InfoInhibitor are left out |
| Image and container errors | Warning | ImagePullBackOff, ErrImagePull, InvalidImageName, CreateContainerConfigError, CreateContainerError |
| FrequentRestarts | Warning | 5 or more restarts, the last within the hour |
| OOMKilled | Warning | A container was killed for memory in the last hour |
| PodUnschedulable, PodPendingTooLong | Warning | Pending for over 10 minutes, with the scheduler's reason |
| DeploymentUnavailable | Warning | Fewer replicas available than wanted, for over 10 minutes |
| StatefulSetNotReady, DaemonSetUnavailable | Warning | Pods not ready or unavailable, 10 minutes after creation |
| JobFailed | Warning | The Job failed in the last 24 hours |
| VolumeClaimPending | Warning | A volume claim still has no volume after 10 minutes |
| Node pressure | Warning | Memory, disk or PID pressure, or network unavailable |
| Warning events | Warning | Kubernetes Warning events, one per object and reason, with their count |
| NodeCordoned | Info | The node takes no new pods |

A crash-looping pod still shows **Running** in Lens: that is the pod's phase, which stays Running while its container restarts. The alert says so, and reads a clean exit as Kubernetes stopping the container, often a failing liveness probe.

## Acting on an alert

| Action | Where | What happens | Undo |
| --- | --- | --- | --- |
| Open | Alert row, notification | Goes to what the alert is about | Back |
| Ask AI | Alert row, notification | Opens the resource and starts Ask AI on that cluster, told which logs to read first, including the run that crashed | |
| Mute 24h | Alert row, notification | Hides the alert for 24 hours: out of the counts, the status bar and the notifications | **Unmute**, under **Muted** |
| Never notify me about this alert | Notification | No more notifications for that alert; it stays listed and counted | **🔕 Notify again** on its row |
| Mute all 24h | Notification | Pauses every notification for 24 hours | **Notifications: On** |

## Settings

All settings are in **Lens Preferences → Extensions → Multi-Cluster View**; **Settings** in the view takes you there. They are kept across restarts.

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-refresh | 30 seconds | How often Prometheus usage and alerts are fetched, and clusters that are down are retried: 30 seconds, 1, 2, 5 or 10 minutes |
| Notifications | On | On, paused for 24 hours, or off for every alert |
| Muted alerts | None | How many are muted; **Unmute all** shows them again |
| Alerts that never notify | None | How many; **Notify about all again** turns their notifications back on |

## Connections and refresh

| Situation | What the view does |
| --- | --- |
| A cluster appears, such as one Lens finds in your Azure account | Connects it at once |
| A cluster fails to connect | Tries again after 30 seconds, then 1, 2, 4 minutes, up to every 10; the card says when |
| You disconnect a cluster | Leaves it disconnected until you press **Connect** on its card |
| A connection never answers | Gives up after 60 seconds and tries again later |

Pods, nodes, workloads and events are watched live. Connecting and watching only read the cluster: they create no Kubernetes events.

## Requirements and limits

| Feature | Needs | Without it |
| --- | --- | --- |
| Real CPU, memory and storage usage, Prometheus alerts | A Prometheus Lens can reach | Requests and allocatable only; the card says *Metrics not found* |
| Opening a cluster's Lens overview from its card | **Install Lens CLI** on in Lens Preferences | Opens the cluster's Nodes, as it also does when two clusters share a name |
| Kubelet logs in Ask AI | The cluster's node log query enabled | Ask AI reads the pod logs and events instead |

A cluster that drops on its own while the view is open is taken as one you disconnected, and waits for **Connect**.

## Notifications

A notification appears for each new critical alert on a connected cluster, wherever you are in Lens, and stays until you close it or act on it. It does not appear for what a cluster already had when it connected, for a muted alert, for one you asked never to be notified about, or for a problem that comes back within 10 minutes. At most three arrive at once. Alerts that fire while notifications are paused do not all arrive when the pause ends.

![A critical alert as a notification, with Open, Ask AI, Mute 24h, Mute all 24h and Never notify me about this alert](assets/screenshots/notification.png)
