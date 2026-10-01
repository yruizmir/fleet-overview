# Changelog

What changed in each version of this extension, newest first.

## 0.2.0

- Settings page in Lens Preferences → Extensions → Multi-Cluster View: Auto-refresh, notifications, unmute all, notify about all again. Settings in the view opens it.
- Status bar: the critical and warning alerts of your connected clusters, wherever you are in Lens; click it to open the view.
- Notifications for critical alerts that appear while Lens is open, with Open, Ask AI, Mute 24h, Mute all 24h and Never notify me about this alert (undone with Notify again on its row); Notifications: On · Pause 24h · Off at the top of the view.
- Mute an alert for 24 hours, and see the muted ones under Muted.
- New alerts: Deployments and StatefulSets short of replicas, DaemonSets with unavailable pods, failed Jobs, volume claims without a volume, containers restarting often.
- CrashLoopBackOff alerts stay listed between two crashes, say when the pod still shows Running, and tell a liveness probe kill from a crash.
- Each card shows the cluster's Kubernetes version, in warning colour when it is two minor versions behind your newest cluster.
- Find a cluster by name, and sort the cards by health or by name.
- Clusters stay connected while the view is open: one Lens finds later, such as an AKS cluster, connects as soon as it appears, and one that is down is tried again less often each time it fails. One you disconnect stays disconnected until you press Connect.
- Choose how often metrics refresh and clusters that are down are retried under Auto-refresh, next to Refresh: 30 seconds, 1, 2, 5 or 10 minutes.
- Click a cluster's name or its CPU, memory and pods rings to open its Lens overview (needs the Lens CLI installed; opens its nodes otherwise).
- Ask AI reads the affected pod's logs first, including the run that crashed, and quotes the lines that show the cause.

## 0.1.0

First release.

- Multi-Cluster View tab: CPU, memory, node storage, GPU and pod capacity, requests and usage of every cluster, with fleet totals.
- One alerts panel for all clusters: firing Prometheus alerts, node conditions, failing pods and Warning events, filterable by severity or cluster and linked to the resource.
- Ask AI on every alert: opens the affected resource and starts a troubleshooting conversation on the alert's cluster, briefed with the alert.
- Capacity per cluster: a card per cluster with its source path, status, metrics source and CPU, memory and pod rings.
- Clusters connect automatically when the tab opens.
- Opens from the top bar, the navigator and the command palette.
