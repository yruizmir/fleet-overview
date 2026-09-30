import { Div, Span } from "@k8slens/element-components";
import { InfoIcon } from "@k8slens/icon";
import type { ClusterResources, Resource } from "./fleet-model";
import { formatBytes, formatCount } from "./quantity";

// The colours of Lens's own cluster overview rings, so the summary reads the same.
const ringColors = {
  usage: "#c93dce",
  requests: "#4caf50",
  limits: "#3d90ce",
  allocatable: "#5f6368",
  capacity: "#3a3e42",
};

const size = 64;
const stroke = 4;
const center = size / 2;
const band = "#2a2e32";

interface Arc {
  readonly radius: number;
  readonly fraction: number;
  readonly color: string;
}

const Ring = ({ arcs }: { arcs: readonly Arc[] }) => {
  const outer = Math.max(...arcs.map((arc) => arc.radius)) + stroke;
  const inner = Math.min(...arcs.map((arc) => arc.radius)) - stroke;

  return (
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-hidden="true">
    <circle cx={center} cy={center} r={(outer + inner) / 2} fill="none" stroke={band} strokeWidth={outer - inner} />
    {arcs.map(({ radius, fraction, color }) => {
      const circumference = 2 * Math.PI * radius;
      const length = Math.max(0, Math.min(1, fraction)) * circumference;

      return (
        <g key={radius}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke="#1e2124" strokeWidth={stroke} />
          {length > 0 && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference}`}
              transform={`rotate(-90 ${center} ${center})`}
            />
          )}
        </g>
      );
    })}
  </svg>
  );
};

const LegendRow = ({ color, label, value }: { color: string; label: string; value: string }) => (
  <Div $flex={{ gap: "xxs", verticalAlign: "center" }} $style={{ whiteSpace: "nowrap", lineHeight: "14px" }}>
    <Span $style={{ width: 6, height: 6, flexShrink: 0, background: color, borderRadius: 1 }} />
    <Span $color="textMuted" $style={{ fontSize: 10 }}>
      {label}
    </Span>
    <Span $color="textDefault" $style={{ fontSize: 10, marginLeft: "auto" }}>
      {value}
    </Span>
  </Div>
);

const RingSummary = ({
  title,
  resource,
  format,
  withLimits,
}: {
  title: string;
  resource: Resource;
  format: (value: number) => string;
  withLimits: boolean;
}) => {
  const capacity = resource.capacity || resource.allocatable;
  const fraction = (value: number | undefined) => (value && capacity ? value / capacity : 0);
  const arcs: Arc[] = withLimits
    ? [
        { radius: 28, fraction: fraction(resource.used), color: ringColors.usage },
        { radius: 23, fraction: fraction(resource.requested), color: ringColors.requests },
        { radius: 18, fraction: fraction(resource.limits), color: ringColors.limits },
      ]
    : [{ radius: 27, fraction: fraction(resource.used ?? resource.requested), color: ringColors.requests }];
  const limitsTooHigh = withLimits && (resource.limits ?? 0) > capacity;

  return (
    <Div
      $flex={{ direction: "vertical", gap: "xxs", horizontalAlign: "center" }}
      $flexChild
      $padding={{ horizontal: "xs" }}
      $tooltip={[
        `${title}`,
        withLimits ? `Usage: ${resource.used !== undefined ? format(resource.used) : "n/a"}` : `Usage: ${format(resource.used ?? resource.requested)}`,
        withLimits ? `Requests: ${format(resource.requested)}` : "",
        withLimits ? `Limits: ${format(resource.limits ?? 0)}` : "",
        `Allocatable Capacity: ${format(resource.allocatable)}`,
        `Capacity: ${format(resource.capacity)}`,
        limitsTooHigh ? "Specified limits are higher than node capacity!" : "",
      ].filter(Boolean).join("\n")}
      $border={{ right: { width: "xxs", color: "grey60" }, exceptLast: true }}
    >
      <Span $color="textHighlight" $style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
      </Span>
      <Ring arcs={arcs} />
      <Div $flex={{ direction: "vertical", gap: "xxs" }} $width="full">
        {withLimits ? (
          <>
            <LegendRow color={ringColors.usage} label="Use" value={resource.used !== undefined ? format(resource.used) : "n/a"} />
            <LegendRow color={ringColors.requests} label="Req" value={format(resource.requested)} />
            <LegendRow color={ringColors.limits} label="Lim" value={format(resource.limits ?? 0)} />
          </>
        ) : (
          <LegendRow color={ringColors.requests} label="Use" value={format(resource.used ?? resource.requested)} />
        )}
        <LegendRow color={ringColors.allocatable} label="Alloc" value={format(resource.allocatable)} />
        <LegendRow color={ringColors.capacity} label="Cap" value={format(resource.capacity)} />
      </Div>
      {limitsTooHigh && (
        <Span $flex={{ gap: "xxs", verticalAlign: "center" }} $color="warning" $style={{ fontSize: 10 }}>
          <InfoIcon $size="xxs" />
          limits &gt; cap
        </Span>
      )}
    </Div>
  );
};

const formatCpu = (cores: number) => cores.toFixed(2);
const formatMemory = (bytes: number) => formatBytes(bytes).replace(" ", "");

// CPU, memory and pods of one cluster, as Lens's cluster overview draws them.
export const ResourceRings = ({ resources }: { resources: ClusterResources }) => (
  <Div $flex={{ horizontalAlign: "space-between", verticalAlign: "stretch" }}>
    <RingSummary title="CPU" resource={resources.cpu} format={formatCpu} withLimits />
    <RingSummary title="Memory" resource={resources.memory} format={formatMemory} withLimits />
    <RingSummary title="Pods" resource={resources.pods} format={formatCount} withLimits={false} />
  </Div>
);
