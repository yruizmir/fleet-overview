# Changelog

What changed in each version of this extension, newest first.

## 0.2.0

- Clusters stay connected while the view is open: one Lens finds later, such as an AKS cluster, connects as soon as it appears, and one that is down or failed is tried again at every refresh.
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
