import { getInjectable2 } from "@k8slens/injectable";
import { getPersistableMapInjectableBunch } from "@k8slens/persistable-contracts";
import { action, computed, observable, type ObservableMap, runInAction } from "mobx";

// Alerts the user muted, by key, each with when the mute ends (ms since the epoch).
export const alertMutesBunch = getPersistableMapInjectableBunch<string, number>()({
  id: "alert-mutes",
});

export const muteForMs = 24 * 60 * 60 * 1000;

// Known noise (pods waiting for a GPU the cluster lacks, a Prometheus without Alertmanager) can be muted for a day,
// so the alerts that matter are not buried under it. A muted alert leaves the counts, the status bar and the
// notifications, and comes back by itself once the mute ends.
export const alertMutesInjectable = getInjectable2({
  id: "fleet-overview-alert-mutes",

  instantiate: (di) => {
    const getMutes = di.inject(alertMutesBunch.persistable);
    const mutes = observable.box<ObservableMap<string, number> | undefined>(undefined, { deep: false });
    // Ticks once a minute, so a mute that ends is noticed without anything else changing.
    const now = observable.box(Date.now());

    void getMutes().then((loaded) =>
      runInAction(() => {
        for (const [key, until] of [...loaded]) {
          if (until <= Date.now()) {
            loaded.delete(key);
          }
        }

        mutes.set(loaded);
      }),
    );

    setInterval(() => runInAction(() => now.set(Date.now())), 60_000);

    return () => ({
      isMuted: (key: string) => (mutes.get()?.get(key) ?? 0) > now.get(),
      mutedUntil: (key: string) => {
        const until = mutes.get()?.get(key);

        return until !== undefined && until > now.get() ? until : undefined;
      },
      count: computed(() => [...(mutes.get()?.values() ?? [])].filter((until) => until > now.get()).length),
      mute: action((key: string) => mutes.get()?.set(key, Date.now() + muteForMs)),
      unmute: action((key: string) => mutes.get()?.delete(key)),
      unmuteAll: action(() => mutes.get()?.clear()),
    });
  },
});
