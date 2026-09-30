import { getKubeResourceKind } from "@k8slens/kubernetes-contracts";

// Core v1 Events: what Lens's own cluster overview lists under "Needs attention".
export const eventKind = getKubeResourceKind<{
  v1: {
    kind: "Event";
    metadata: { name: string; namespace: string; uid: string; creationTimestamp?: string };
    type?: string;
    reason?: string;
    message?: string;
    count?: number;
    firstTimestamp?: string;
    lastTimestamp?: string;
    eventTime?: string;
    series?: { count?: number; lastObservedTime?: string };
    involvedObject: { kind?: string; name?: string; namespace?: string };
  };
}>("Event");
