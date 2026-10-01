import { Badge } from "@k8slens/badge";
import { ClickableDiv, Div, Span } from "@k8slens/element-components";
import { DashboardIcon, FolderIcon, RefreshIcon, SettingsIcon } from "@k8slens/icon";
import { PlainButton, PrimaryButton, TextInput } from "@k8slens/input-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { type KeyboardEvent, type ReactNode, useEffect } from "react";
import styles from "./fleet-dashboard.module.scss";
import { clusterSourcesInjectable } from "./cluster-sources.injectable";
import { alertMutesInjectable } from "./alert-mutes.injectable";
import { fleetFilterInjectable } from "./fleet-filter.injectable";
import { type FleetAlert, formatAge, type Resource, type Severity } from "./fleet-model";
import { type ClusterView, fleetMonitorInjectable } from "./fleet-monitor.injectable";
import { askAiAboutAlertInjectable } from "./ask-ai-about-alert.injectable";
import { goToAlertInjectable, goToClusterInjectable } from "./go-to-alert.injectable";
import { notificationSettingsInjectable } from "./notification-settings.injectable";
import { openSettingsInjectable } from "./open-settings.injectable";
import { refreshIntervalInjectable } from "./refresh-interval.injectable";
import { silencedAlertsInjectable } from "./silenced-alerts.injectable";
import { ResourceRings } from "./resource-rings";
import { SparkleIcon } from "./sparkle-icon";
import { formatBytes, formatCores, formatCount, percentOf } from "./quantity";

type Formatter = (value: number) => string;
type Tone = "success" | "warning" | "critical";

const toneFor = (percent: number | undefined): Tone =>
  percent === undefined || percent < 75 ? "success" : percent < 90 ? "warning" : "critical";

const severityTone: Record<Severity, "critical" | "warning" | "primary"> = {
  critical: "critical",
  warning: "warning",
  info: "primary",
};

const sourceLabel: Record<FleetAlert["source"], string> = {
  prometheus: "Prometheus",
  node: "Nodes",
  pod: "Pods",
  event: "Events",
  workload: "Workloads",
};

const timeAgo = (since: number | undefined) => {
  if (!since) {
    return "";
  }

  const minutes = Math.max(0, Math.round((Date.now() - since) / 60_000));

  return minutes < 60 ? `${minutes}m` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
};

const UsageBar = ({ resource }: { resource: Resource }) => {
  const requested = percentOf(resource.requested, resource.allocatable) ?? 0;
  const used = percentOf(resource.used, resource.allocatable);
  const tone = toneFor(Math.max(used ?? 0, requested));

  return (
    <Div $className={styles.bar} $backgroundColor="grey60">
      <Div $className={[styles.barLayer, styles.requested]} $backgroundColor={tone} $style={{ width: `${requested}%` }} />
      {used !== undefined && <Div $className={styles.barLayer} $backgroundColor={tone} $style={{ width: `${used}%` }} />}
    </Div>
  );
};

const Tile = ({ label, value, detail, tooltip, children }: { label: string; value: ReactNode; detail?: ReactNode; tooltip?: string; children?: ReactNode }) => (
  <Div
    $flex={{ direction: "vertical", gap: "xxs" }}
    $padding={{ vertical: "s", horizontal: "m" }}
    $backgroundColor="backgroundSecondary"
    $border={{ color: "borderPrimary", width: "xxs", radius: "m" }}
    $tooltip={tooltip ?? (typeof detail === "string" ? detail : undefined)}
  >
    <Span $className={styles.tileDetail} $color="textMuted" $font={{ size: "xs" }}>
      {label}
    </Span>
    <Span $className={styles.tileValue} $font={{ size: "m", bold: true }} $color="textHighlight">
      {value}
    </Span>
    {children}
    {detail && (
      <Span $className={styles.tileDetail} $color="textMuted" $font={{ size: "xs" }}>
        {detail}
      </Span>
    )}
  </Div>
);

const ResourceTile = ({ label, resource, format, unit }: { label: string; resource: Resource; format: Formatter; unit: string }) => (
  <Tile
    label={label}
    value={format(resource.used ?? resource.requested)}
    detail={
      resource.used !== undefined
        ? `${percentOf(resource.used, resource.allocatable)?.toFixed(0)}% used`
        : `${percentOf(resource.requested, resource.allocatable)?.toFixed(0) ?? 0}% req`
    }
    tooltip={`${label}: ${format(resource.used ?? resource.requested)} of ${format(resource.allocatable)}${unit ? ` ${unit}` : ""}
Used: ${resource.used !== undefined ? `${percentOf(resource.used, resource.allocatable)?.toFixed(0)}%` : "no metrics"}
Requested: ${percentOf(resource.requested, resource.allocatable)?.toFixed(0) ?? 0}%`}
  >
    <Span $className={styles.tileDetail} $color="textMuted" $font={{ size: "xs" }}>
      of {format(resource.allocatable)}
      {unit ? ` ${unit}` : ""}
    </Span>
    <UsageBar resource={resource} />
  </Tile>
);

const SectionTitle = ({ title, detail }: { title: string; detail?: string }) => (
  <Div $flex={{ gap: "s", verticalAlign: "bottom" }}>
    <Span $font={{ size: "l", bold: true }} $color="textHighlight">
      {title}
    </Span>
    {detail && (
      <Span $font={{ size: "s" }} $color="textMuted">
        {detail}
      </Span>
    )}
  </Div>
);

const Totals = observer(() => {
  const totals = useInject(fleetMonitorInjectable)().totals.get();

  return (
    <Div $className={styles.tiles}>
      <Tile
        label="Clusters"
        value={`${totals.connected} / ${totals.clusters}`}
        detail="connected"
        tooltip={`${totals.connected} of ${totals.clusters} clusters connected, ${totals.withMetrics} with Prometheus metrics`}
      />
      <Tile
        label="Nodes"
        value={`${totals.nodesReady} / ${totals.nodesTotal}`}
        detail={totals.nodesReady === totals.nodesTotal ? "all ready" : `${totals.nodesTotal - totals.nodesReady} not ready`}
      />
      <ResourceTile label="CPU" resource={totals.cpu} format={formatCores} unit="cores" />
      <ResourceTile label="Memory" resource={totals.memory} format={(bytes) => formatBytes(bytes)} unit="" />
      <ResourceTile label="Storage" resource={totals.storage} format={(bytes) => formatBytes(bytes)} unit="" />
      {totals.gpu.allocatable > 0 && <ResourceTile label="GPU" resource={totals.gpu} format={formatCount} unit="GPUs" />}
      <ResourceTile label="Pods" resource={totals.pods} format={formatCount} unit="" />
    </Div>
  );
});

const ClusterStatus = ({ cluster }: { cluster: ClusterView }) => {
  const monitor = useInject(fleetMonitorInjectable)();

  if (!cluster.connected) {
    const retryIn = cluster.nextAttemptAt !== undefined ? cluster.nextAttemptAt - Date.now() : undefined;

    return (
      <Div $flex={{ direction: "vertical", gap: "xxs", horizontalAlign: "right" }}>
        <PlainButton $disabled={cluster.connecting} onClick={() => void monitor.connect(cluster.record.id)}>
          {cluster.connecting ? "Connecting…" : "Connect"}
        </PlainButton>
        {cluster.autoConnectPaused && !cluster.connecting && (
          <Span $color="textMuted" $font={{ size: "s" }} $tooltip="You disconnected it, so it is not reconnected automatically">
            Disconnected
          </Span>
        )}
        {cluster.connectError && !cluster.autoConnectPaused && (
          <Span
            $color="critical"
            $font={{ size: "s" }}
            $tooltip={`${cluster.connectError}. Tried again less often each time it fails, up to every 10 minutes.`}
          >
            Failed to connect{retryIn !== undefined && retryIn > 0 ? ` · retry in ${formatAge(retryIn)}` : ""}
          </Span>
        )}
      </Div>
    );
  }

  if (cluster.error) {
    return <Badge small label="Error" $backgroundColor="critical" $color="white" $tooltip={cluster.error} />;
  }

  if (cluster.loading) {
    return <Span $color="textMuted">Loading…</Span>;
  }

  return <Badge small label="Connected" $backgroundColor="success" $color="white" />;
};

const MetricsStatus = ({ cluster }: { cluster: ClusterView }) => {
  const prometheus = cluster.prometheus;

  if (!prometheus) {
    return <Span $color="textMuted">—</Span>;
  }

  if (prometheus.status === "loading") {
    return <Span $color="textMuted">…</Span>;
  }

  if (prometheus.status === "unavailable") {
    return (
      <Span $color="textMuted" $tooltip={prometheus.error}>
        not found
      </Span>
    );
  }

  return (
    <Span $color="success" $tooltip={`Last sampled ${new Date(prometheus.at).toLocaleTimeString()}`}>
      Prometheus
    </Span>
  );
};

const AlertCount = observer(({ cluster }: { cluster: ClusterView }) => {
  const filter = useInject(fleetFilterInjectable)();
  const critical = cluster.alerts.filter((alert) => alert.severity === "critical").length;
  const warning = cluster.alerts.filter((alert) => alert.severity === "warning").length;
  const selected = filter.clusterId.get() === cluster.record.id;

  if (!cluster.connected) {
    return <Span $color="textMuted">—</Span>;
  }

  return (
    <ClickableDiv
      $flex={{ gap: "xs" }}
      $onClick={() => filter.showCluster(cluster.record.id)}
      $tooltip={selected ? "Show alerts of every cluster" : "Show only this cluster's alerts"}
    >
      {critical > 0 && <Badge small label={String(critical)} $backgroundColor="critical" $color="white" />}
      {warning > 0 && <Badge small label={String(warning)} $backgroundColor="warning" $color="white" />}
      {critical === 0 && warning === 0 && <Span $color="success">OK</Span>}
      {selected && <Span $color="link">(filtered)</Span>}
    </ClickableDiv>
  );
});

const AskAiButton = ({ alert, clusterName }: { alert: FleetAlert; clusterName: string }) => {
  const askAiAboutAlert = useInject(askAiAboutAlertInjectable)();
  const goToAlert = useInject(goToAlertInjectable)();

  // Ask AI opens its terminal in the cluster's own dock, so go to the alert's resource first;
  // from the fleet tab the terminal would open out of sight.
  const troubleshoot = async () => {
    await goToAlert(alert);
    await askAiAboutAlert(alert, clusterName);
  };

  return (
    // Keeps the click from also opening the resource the row links to.
    <Span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <PlainButton
        onClick={() => void troubleshoot()}
        $tooltip="Troubleshoot this alert with Ask AI"
        $padding={{ horizontal: "s", vertical: "xxs" }}
        $border={{ color: "primary", width: "xxs", radius: "m" }}
        $backgroundColor={{ normal: "transparent", hover: "backgroundSecondary" }}
        $color="primary"
      >
        <Span $flex={{ gap: "xs", verticalAlign: "center" }} $font={{ size: "s" }}>
          <SparkleIcon />
          Ask AI
        </Span>
      </PlainButton>
    </Span>
  );
};

// Mutes an alert for a day, or unmutes it, without opening what the row links to.
const MuteButton = observer(({ alert }: { alert: FleetAlert }) => {
  const mutes = useInject(alertMutesInjectable)();
  const until = mutes.mutedUntil(alert.key);

  return (
    <Span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <PlainButton
        onClick={() => (until ? mutes.unmute(alert.key) : mutes.mute(alert.key))}
        $tooltip={
          until
            ? `Muted for ${formatAge(until - Date.now())} more. Click to show it again`
            : "Hide this alert for 24 hours: out of the counts, the status bar and the notifications"
        }
        $padding={{ horizontal: "s", vertical: "xxs" }}
        $font={{ size: "s" }}
      >
        {until ? "Unmute" : "Mute 24h"}
      </PlainButton>
    </Span>
  );
});

// Shown on an alert the user chose never to be notified about, to turn its notifications back on.
const NotifyAgainButton = observer(({ alert }: { alert: FleetAlert }) => {
  const silencedAlerts = useInject(silencedAlertsInjectable)();

  if (!silencedAlerts.isSilenced(alert.key)) {
    return null;
  }

  return (
    <Span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <PlainButton
        onClick={() => silencedAlerts.unsilence(alert.key)}
        $tooltip="You chose never to be notified about this alert. Click to be notified again"
        $padding={{ horizontal: "s", vertical: "xxs" }}
        $font={{ size: "s" }}
      >
        🔕 Notify again
      </PlainButton>
    </Span>
  );
});

const AlertRow = observer(({ alert }: { alert: FleetAlert }) => {
  const goToAlert = useInject(goToAlertInjectable)();
  const cluster = useInject(fleetMonitorInjectable)()
    .clusters.get()
    .find((one) => one.record.id === alert.clusterId);

  return (
    <ClickableDiv
      $flex={{ gap: "s" }}
      $padding={{ vertical: "s", horizontal: "m" }}
      $backgroundColor={{ normal: "backgroundPrimary", hover: "grey70" }}
      $border={{ color: "grey70", width: "xxs", radius: "m" }}
      $onClick={() => void goToAlert(alert)}
      $tooltip="Go to what this alert is about"
    >
      <Div $className={styles.stripe} $backgroundColor={severityTone[alert.severity]} />
      <Div $flex={{ direction: "vertical", gap: "xxs" }} $flexChild>
        <Div $flex={{ gap: "s", verticalAlign: "center", horizontalAlign: "space-between" }}>
          <Span $font={{ bold: true }} $color="textHighlight">
            {alert.title}
          </Span>
          <Span $color="textMuted" $font={{ size: "s" }}>
            {timeAgo(alert.since)}
          </Span>
        </Div>
        <Span $color="textDefault" $font={{ size: "s" }}>
          {alert.detail}
        </Span>
        <Div $flex={{ gap: "xs", verticalAlign: "center" }}>
          <Badge small label={cluster?.record.name.get() ?? alert.clusterId} $backgroundColor="grey60" $color="textHighlight" />
          <Badge small label={sourceLabel[alert.source]} $backgroundColor="grey70" $color="textDefault" />
          <Span $flexChild />
          <NotifyAgainButton alert={alert} />
          <MuteButton alert={alert} />
          <AskAiButton alert={alert} clusterName={cluster?.record.name.get() ?? alert.clusterId} />
        </Div>
      </Div>
    </ClickableDiv>
  );
});

const severityLabel: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Info" };

type ButtonTone = "critical" | "warning" | "primary" | "grey40";

// Outlined in its colour with its count; filled in that colour while selected; grey when there is nothing to show.
const CountButton = ({
  label,
  count,
  selected,
  onToggle,
  tone = "grey40",
}: {
  label: string;
  count: number;
  selected: boolean;
  onToggle: () => void;
  tone?: ButtonTone;
}) => {
  const empty = count === 0 && !selected;
  const tooltip = empty ? `No ${label.toLowerCase()} alerts` : selected ? "Click to show all again" : `Show only ${label.toLowerCase()}`;

  return (
    <PlainButton
      onClick={onToggle}
      $disabled={empty}
      $tooltip={tooltip}
      $padding={{ horizontal: "m", vertical: "xs" }}
      $faded={empty}
      $border={{ color: tone, width: "xxs", radius: "m" }}
      $backgroundColor={selected ? tone : { normal: "transparent", hover: "backgroundSecondary" }}
      $color={selected ? "white" : tone === "grey40" ? "textHighlight" : tone}
    >
      <Span $flex={{ gap: "xs", verticalAlign: "center" }}>
        {label}
        <Span $font={{ bold: true }} $className={styles.count}>
          {count}
        </Span>
      </Span>
    </PlainButton>
  );
};

const AlertsPanel = observer(() => {
  const filter = useInject(fleetFilterInjectable)();
  const monitor = useInject(fleetMonitorInjectable)();
  const alerts = filter.visibleAlerts.get();
  const clusterId = filter.clusterId.get();
  const clusterName = monitor.clusters.get().find((cluster) => cluster.record.id === clusterId)?.record.name.get();
  const mutedCount = monitor.mutedAlerts.get().length;

  return (
    <Div
      $flex={{ direction: "vertical" }}
      $backgroundColor="backgroundPrimary"
      $border={{ color: "borderPrimary", width: "xxs", radius: "m" }}
    >
      <Div $flex={{ gap: "xs", verticalAlign: "center" }} $padding="m" $className={styles.filterRow}>
        <CountButton
          label="All"
          count={filter.totalCount.get()}
          selected={filter.severities.size === 0}
          onToggle={() => filter.showAll()}
        />
        <Span $padding={{ horizontal: "xs" }} />
        {(["critical", "warning", "info"] as const).map((severity) => (
          <CountButton
            key={severity}
            label={severityLabel[severity]}
            tone={severity === "info" ? "primary" : severity}
            count={filter.severityCounts.get()[severity]}
            selected={filter.severities.has(severity)}
            onToggle={() => filter.toggleSeverity(severity)}
          />
        ))}
        <Span $flexChild />
        {clusterName && (
          <ClickableDiv $color="link" $onClick={() => filter.showCluster(undefined)} $tooltip="Show every cluster">
            {clusterName} ✕
          </ClickableDiv>
        )}
        {(mutedCount > 0 || filter.showMuted.get()) && (
          <PlainButton
            onClick={filter.toggleMuted}
            $tooltip={filter.showMuted.get() ? "Back to the alerts that are not muted" : "Show the alerts you muted"}
            $padding={{ horizontal: "m", vertical: "xs" }}
            $border={{ color: "grey40", width: "xxs", radius: "m" }}
            $backgroundColor={filter.showMuted.get() ? "grey40" : { normal: "transparent", hover: "backgroundSecondary" }}
            $color="textHighlight"
          >
            Muted {mutedCount}
          </PlainButton>
        )}
      </Div>
      <Div
        $className={styles.alerts}
        $backgroundColor="backgroundSecondary"
        $padding="s"
        $flex={{ direction: "vertical", gap: "xs" }}
        $border={{ top: { width: "xxs", color: "grey60" }, radiusBottomLeft: "m", radiusBottomRight: "m" }}
      >
        {alerts.map((alert) => (
          <AlertRow key={alert.key} alert={alert} />
        ))}
        {alerts.length === 0 && (
          <Div $padding="l">
            <Span $color="textMuted">
              {filter.showMuted.get() ? "Nothing muted." : "Nothing firing. Only connected clusters are checked."}
            </Span>
          </Div>
        )}
      </Div>
    </Div>
  );
});

const CardResource = ({ label, resource, format, unit }: { label: string; resource: Resource; format: Formatter; unit?: string }) => {
  const usedPercent = percentOf(resource.used, resource.allocatable);
  const requestedPercent = percentOf(resource.requested, resource.allocatable) ?? 0;

  return (
    <Div $flex={{ direction: "vertical", gap: "xxs" }}>
      <Div $flex={{ horizontalAlign: "space-between", verticalAlign: "center" }}>
        <Span $color="textMuted" $font={{ size: "s" }}>
          {label}
        </Span>
        <Span $font={{ size: "s" }}>
          {format(resource.used ?? resource.requested)}
          <Span $color="textMuted">
            {" "}
            / {format(resource.allocatable)}
            {unit}
          </Span>
        </Span>
      </Div>
      <UsageBar resource={resource} />
      <Span $color="textMuted" $font={{ size: "xs" }}>
        {usedPercent !== undefined ? `${usedPercent.toFixed(0)}% used · ` : ""}
        {requestedPercent.toFixed(0)}% requested
      </Span>
    </Div>
  );
};

const CardAlert = observer(({ alert }: { alert: FleetAlert }) => {
  const goToAlert = useInject(goToAlertInjectable)();

  return (
    <ClickableDiv
      $flex={{ gap: "s" }}
      $padding={{ vertical: "xs", horizontal: "s" }}
      $border={{ radius: "s" }}
      $backgroundColor={{ normal: "backgroundSecondary", hover: "grey60" }}
      $onClick={() => void goToAlert(alert)}
      $tooltip={`${alert.detail}\n${sourceLabel[alert.source]}${alert.since ? ` · ${timeAgo(alert.since)} ago` : ""}`}
    >
      <Div $className={styles.stripe} $backgroundColor={severityTone[alert.severity]} />
      <Div $flex={{ direction: "vertical", gap: "xxs" }} $flexChild>
        <Div $flex={{ horizontalAlign: "space-between", gap: "s" }}>
          <Span $font={{ size: "s", bold: true }} $color="textHighlight">
            {alert.title}
          </Span>
          <Span $font={{ size: "xs" }} $color="textMuted" $style={{ whiteSpace: "nowrap" }}>
            {sourceLabel[alert.source]}
            {alert.since ? ` · ${timeAgo(alert.since)}` : ""}
          </Span>
        </Div>
        <Span $font={{ size: "xs" }} $color="textDefault">
          {alert.detail}
        </Span>
      </Div>
    </ClickableDiv>
  );
});

const SourcePath = observer(({ clusterId }: { clusterId: string }) => {
  const sources = useInject(clusterSourcesInjectable)();
  const source = sources.sourceOf(clusterId).get();
  const editing = sources.editing.get();

  if (editing?.clusterId === clusterId) {
    return (
      <TextInput
        autoFocus
        placeholder="e.g. ~/.kube/config › prod-eu, or Folder › Subfolder"
        value={editing.draft}
        onChange={(event) => sources.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") sources.save();
          if (event.key === "Escape") sources.cancel();
        }}
        onBlur={sources.save}
      />
    );
  }

  const segments = source ? source.split(/\s*[›>/]\s*(?=\S)/).filter(Boolean) : [];

  return (
    <ClickableDiv
      $className={styles.sourcePath}
      $flex={{ gap: "xxs", wrap: true, verticalAlign: "center" }}
      $padding={{ vertical: "zero", horizontal: "xs" }}
      $border={{ radius: "s" }}
      $backgroundColor="backgroundSecondary"
      $font={{ size: "xs" }}
      $color={{ normal: "textMuted", hover: "link" }}
      $onClick={() => sources.startEditing(clusterId)}
      $tooltip={source ? `${source}\nClick to change where this cluster comes from` : "Click to note where this cluster comes from (kubeconfig, context, folder)"}
    >
      <FolderIcon $size="xs" />
      {source ? (
        segments.map((segment, index) => (
          <Span key={index} $color={index === segments.length - 1 ? "textDefault" : "inherit"}>
            {index > 0 && <Span $padding={{ right: "xxs" }}>›</Span>}
            {segment}
          </Span>
        ))
      ) : (
        <Span>+ Set source path</Span>
      )}
    </ClickableDiv>
  );
});

// Its Kubernetes version, in warning colour when it is two or more minor versions behind the newest cluster's.
const ClusterVersion = observer(({ cluster }: { cluster: ClusterView }) => {
  const behind = useInject(fleetFilterInjectable)().minorsBehind(cluster);

  return (
    <Span
      $color={behind >= 2 ? "warning" : "textDefault"}
      $tooltip={behind > 0 ? `${behind} minor version${behind === 1 ? "" : "s"} behind your newest cluster` : "Kubernetes version of its nodes"}
    >
      {cluster.version}
    </Span>
  );
});

const ClusterColumn = observer(({ cluster }: { cluster: ClusterView }) => {
  const goToCluster = useInject(goToClusterInjectable)();
  const resources = cluster.resources;
  const color = cluster.record.color.get();
  const critical = cluster.alerts.filter((alert) => alert.severity === "critical").length;

  return (
    <Div
      $className={styles.column}
      $flex={{ direction: "vertical", gap: "s" }}
      $padding="s"
      $backgroundColor="backgroundPrimary"
      $border={{ color: critical > 0 ? "critical" : "borderPrimary", width: "xxs", radius: "m" }}
    >
      <Div $flex={{ direction: "vertical", gap: "xs" }}>
        <SourcePath clusterId={cluster.record.id} />
        <Div $flex={{ horizontalAlign: "space-between", verticalAlign: "center", gap: "s" }}>
          <Div $flex={{ gap: "s", verticalAlign: "center" }} $className={styles.nameGroup}>
            <Span $className={styles.dot} $style={{ background: color || "var(--primary, #3d90ce)" }} />
            <ClickableDiv
              $className={styles.clusterName}
              $font={{ size: "m", bold: true }}
              $color={{ normal: "textHighlight", hover: "link" }}
              $onClick={() => void goToCluster(cluster.record.id)}
              $tooltip="Open this cluster's overview"
            >
              {cluster.record.name.get()}
            </ClickableDiv>
          </Div>
          <Div $className={styles.status}>
            <ClusterStatus cluster={cluster} />
          </Div>
        </Div>
      </Div>

      {cluster.connected && resources && (
        <>
          <Div $flex={{ gap: "s" }} $className={styles.statsLine} $style={{ fontSize: 11 }}>
            <Span $color={resources.nodesReady < resources.nodesTotal ? "warning" : "textDefault"}>
              <Span $color="textMuted">Nodes </Span>
              {resources.nodesReady}/{resources.nodesTotal}
            </Span>
            {cluster.version && <ClusterVersion cluster={cluster} />}
            <Span>
              <Span $color="textMuted">Storage </Span>
              {resources.storage.used !== undefined ? formatBytes(resources.storage.used) : "—"}
              <Span $color="textMuted"> / {formatBytes(resources.storage.allocatable)}</Span>
            </Span>
            {resources.gpu.allocatable > 0 && (
              <Span>
                <Span $color="textMuted">GPU </Span>
                {formatCount(resources.gpu.requested)}/{formatCount(resources.gpu.allocatable)}
              </Span>
            )}
          </Div>
          {/* A line of its own in every card, so the rings below start at the same height. */}
          <Div $className={styles.statsLine} $style={{ fontSize: 11 }}>
            <Span $color="textMuted">Metrics </Span>
            <MetricsStatus cluster={cluster} />
          </Div>
          <ClickableDiv $onClick={() => void goToCluster(cluster.record.id)} $tooltip="Open this cluster's overview">
            <ResourceRings resources={resources} />
          </ClickableDiv>
        </>
      )}

      {cluster.connected && !resources && !cluster.error && <Span $color="textMuted">Loading nodes and pods…</Span>}
      {cluster.error && (
        <Span $color="critical" $font={{ size: "s" }}>
          {cluster.error}
        </Span>
      )}

      {cluster.connected ? (
        <Div $flex={{ horizontalAlign: "space-between", verticalAlign: "center" }} $className={styles.attention}>
          <Span $color="textMuted" $style={{ fontSize: 11 }}>
            Alerts
          </Span>
          <AlertCount cluster={cluster} />
        </Div>
      ) : (
        <Span $color="textMuted">Not connected. Connect it to see its capacity and alerts.</Span>
      )}
    </Div>
  );
});

const sortLabels = { health: "Health", name: "Name" } as const;

// Finding a cluster among many: by name, and the ones needing attention first.
const ClusterToolbar = observer(() => {
  const filter = useInject(fleetFilterInjectable)();

  return (
    <Div $flex={{ gap: "s", verticalAlign: "center", wrap: true }}>
      <TextInput
        type="search"
        placeholder="Find a cluster"
        aria-label="Find a cluster by name"
        value={filter.clusterQuery.get()}
        onChange={(event) => filter.searchClusters(event.target.value)}
        $style={{ maxWidth: 260 }}
      />
      <Span $color="textMuted">Sort by</Span>
      {(Object.keys(sortLabels) as (keyof typeof sortLabels)[]).map((sort) => {
        const selected = filter.sortBy.get() === sort;

        return (
          <PlainButton
            key={sort}
            onClick={() => filter.sortClusters(sort)}
            $tooltip={sort === "health" ? "Clusters with critical alerts first, disconnected ones last" : "Alphabetically"}
            $padding={{ horizontal: "s", vertical: "xxs" }}
            $border={{ color: "primary", width: "xxs", radius: "m" }}
            $backgroundColor={selected ? "primary" : { normal: "transparent", hover: "backgroundSecondary" }}
            $color={selected ? "white" : "textHighlight"}
          >
            {sortLabels[sort]}
          </PlainButton>
        );
      })}
    </Div>
  );
});

const ClusterColumns = observer(() => {
  const all = useInject(fleetMonitorInjectable)().clusters.get();
  const clusters = useInject(fleetFilterInjectable)().visibleClusters.get();

  if (all.length === 0) {
    return <Span $color="textMuted">No clusters yet. Add a kubeconfig to Lens to see it here.</Span>;
  }

  if (clusters.length === 0) {
    return <Span $color="textMuted">No cluster matches that name.</Span>;
  }

  return (
    <Div $className={styles.columns}>
      {clusters.map((cluster) => (
        <ClusterColumn key={cluster.record.id} cluster={cluster} />
      ))}
    </Div>
  );
});

const refreshChoices = [30, 60, 120, 300, 600];

const formatInterval = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const describeInterval = (seconds: number) =>
  seconds < 60 ? `${seconds} seconds` : seconds === 60 ? "minute" : `${formatInterval(seconds).replace("m", " min")}`;

// How often metrics refresh and clusters that are down are tried again: the choice in effect, with an arrow on
// either side when there is a shorter or a longer one. An interval saved earlier that is not among the choices
// shows as one of its own.
export const RefreshIntervalField = observer(() => {
  const refreshInterval = useInject(refreshIntervalInjectable)();
  const seconds = refreshInterval.seconds.get();
  const choices = refreshChoices.includes(seconds) ? refreshChoices : [...refreshChoices, seconds].sort((a, b) => a - b);
  const index = choices.indexOf(seconds);
  const shorter = choices[index - 1];
  const longer = choices[index + 1];

  const step = (choice: number | undefined) => {
    if (choice !== undefined) {
      refreshInterval.set(choice);
    }
  };

  // The arrow keys step too, while the control has focus.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const byKey: Record<string, number | undefined> = {
      ArrowLeft: shorter,
      ArrowDown: shorter,
      ArrowRight: longer,
      ArrowUp: longer,
      Home: choices[0],
      End: choices[choices.length - 1],
    };

    if (event.key in byKey) {
      event.preventDefault();
      step(byKey[event.key]);
    }
  };

  // An arrow with nothing past it keeps its room, so the value does not shift as it reaches either end.
  const Arrow = ({ to, label, glyph }: { to: number | undefined; label: string; glyph: string }) => (
    <PlainButton
      onClick={() => step(to)}
      tabIndex={-1}
      aria-hidden={to === undefined}
      $tooltip={to === undefined ? undefined : `${label}: every ${describeInterval(to)}`}
      $padding={{ horizontal: "xs", vertical: "xxs" }}
      $font={{ size: "l", bold: true }}
      $style={{ visibility: to === undefined ? "hidden" : "visible" }}
    >
      {glyph}
    </PlainButton>
  );

  return (
    <Div
      $flex={{ gap: "xxs", verticalAlign: "center" }}
      role="spinbutton"
      aria-label="Auto-refresh"
      aria-valuenow={seconds}
      aria-valuetext={`every ${describeInterval(seconds)}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      $outline={{ focusVisible: { color: "primary", width: "xxs" } }}
      $border={{ radius: "m" }}
      $tooltip={`Metrics refresh, and clusters that are down are reconnected, every ${describeInterval(seconds)}`}
    >
      <Span $color="textMuted">Auto-refresh</Span>
      <Arrow to={shorter} label="Shorter" glyph="‹" />
      <Span $color="textHighlight" $style={{ minWidth: 48, textAlign: "center" }}>
        {formatInterval(seconds)}
      </Span>
      <Arrow to={longer} label="Longer" glyph="›" />
    </Div>
  );
});

// Whether critical alerts raise notifications: on, paused for a day, or off. Also the way back after "Mute all
// 24h" in a notification.
export const NotificationsToggle = observer(() => {
  const settings = useInject(notificationSettingsInjectable)();
  const state = settings.state.get();
  const choices = [
    { kind: "on", label: "On", onClick: settings.turnOn, tooltip: "Notify me of new critical alerts" },
    {
      kind: "paused",
      label: state.kind === "paused" ? `Paused until ${new Date(state.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Pause 24h",
      onClick: settings.pauseForADay,
      tooltip: state.kind === "paused" ? "Paused. Click On to resume now" : "No notifications for 24 hours",
    },
    { kind: "off", label: "Off", onClick: settings.turnOff, tooltip: "No notifications until you turn them back on" },
  ] as const;

  return (
    <Div $flex={{ gap: "xs", verticalAlign: "center" }} role="radiogroup" aria-label="Notifications">
      <Span $color="textMuted">Notifications</Span>
      {choices.map((choice) => {
        const selected = choice.kind === state.kind;

        return (
          <PlainButton
            key={choice.kind}
            role="radio"
            aria-checked={selected}
            onClick={choice.onClick}
            $tooltip={`${choice.tooltip}. The alerts still show here and in the status bar.`}
            $padding={{ horizontal: "s", vertical: "xxs" }}
            $border={{ color: "primary", width: "xxs", radius: "m" }}
            $backgroundColor={selected ? "primary" : { normal: "transparent", hover: "backgroundSecondary" }}
            $color={selected ? "white" : "textHighlight"}
          >
            {choice.label}
          </PlainButton>
        );
      })}
    </Div>
  );
});

export const FleetDashboard = observer(() => {
  const monitor = useInject(fleetMonitorInjectable)();
  const refreshSeconds = useInject(refreshIntervalInjectable)().seconds.get();
  const openSettings = useInject(openSettingsInjectable)();
  const lastRefresh = monitor.lastRefresh.get();

  // Watches and Prometheus polling run only while the dashboard is on screen.
  useEffect(() => monitor.start({ autoConnect: true }), [monitor]);

  return (
    <Div $flex={{ direction: "vertical", gap: "l" }} $padding="xl" $height="full" $overflow="auto">
      <Div $flex={{ horizontalAlign: "space-between", verticalAlign: "top", gap: "m", wrap: true }}>
        <Div $flex={{ direction: "vertical", gap: "xxs" }}>
          <Span $font={{ size: "xxl", bold: true }} $color="textHighlight">
            Multi-Cluster View
          </Span>
          <Span $color="textMuted">
            Physical resources and alerts across all your clusters.
            {lastRefresh ? ` Refreshed ${new Date(lastRefresh).toLocaleTimeString()}.` : ` Updates live; metrics every ${refreshSeconds}s.`}
          </Span>
        </Div>
        {/* The view's controls in one dark box: refreshing on top, notifications below. */}
        <Div
          $flex={{ direction: "vertical", gap: "s", horizontalAlign: "right" }}
          $padding={{ horizontal: "m", vertical: "s" }}
          $backgroundColor="grey100"
          $border={{ color: "borderPrimary", width: "xxs", radius: "m" }}
        >
          <Div $flex={{ gap: "l", verticalAlign: "center" }}>
            <RefreshIntervalField />
            <PrimaryButton Icon={RefreshIcon} onClick={monitor.refresh}>
              Refresh
            </PrimaryButton>
          </Div>
          <Div $flex={{ gap: "l", verticalAlign: "center" }}>
            <NotificationsToggle />
            <PlainButton
              Icon={SettingsIcon}
              onClick={() => void openSettings()}
              $tooltip="All settings of Multi-Cluster View, in Lens Preferences"
              $padding={{ horizontal: "s", vertical: "xxs" }}
            >
              Settings
            </PlainButton>
          </Div>
        </Div>
      </Div>
      {monitor.isReady.get() ? (
        <>
          <SectionTitle title="All clusters" />
          <Totals />
          <SectionTitle title="Alerts" detail="Every connected cluster; click a cluster's alert count below to show only its alerts." />
          <AlertsPanel />
          <SectionTitle title="Capacity per cluster" />
          <ClusterToolbar />
          <ClusterColumns />
        </>
      ) : (
        <Span $color="textMuted">Looking for clusters…</Span>
      )}
    </Div>
  );
});

export const FleetDashboardTitle = () => (
  <Span $flex={{ gap: "xs", verticalAlign: "center" }}>
    <DashboardIcon $size="s" />
    Multi-Cluster View
  </Span>
);
