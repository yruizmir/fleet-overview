import { getInjectable2 } from "@k8slens/injectable";
import { getPersistableValueInjectableBunch } from "@k8slens/persistable-contracts";
import { action, computed, type IObservableValue, observable, runInAction } from "mobx";

// Polling faster than this only repeats what Prometheus already answered: its rates are over 5 minutes and it
// scrapes every 30s or so.
export const minRefreshSeconds = 30;

export const refreshIntervalBunch = getPersistableValueInjectableBunch<number>()({
  id: "refresh-interval-seconds",
  defaultValue: { instantiate: () => async () => minRefreshSeconds },
});

const valid = (seconds: number) => (Number.isFinite(seconds) ? Math.max(minRefreshSeconds, Math.round(seconds)) : minRefreshSeconds);

// How often the dashboard polls Prometheus and tries again to connect clusters that are down, as the user set it.
export const refreshIntervalInjectable = getInjectable2({
  id: "fleet-overview-refresh-interval",

  instantiate: (di) => {
    const getPersisted = di.inject(refreshIntervalBunch.persistable);
    const persisted = observable.box<IObservableValue<number> | undefined>(undefined, { deep: false });

    void getPersisted().then((loaded) => runInAction(() => persisted.set(loaded)));

    return () => ({
      seconds: computed(() => valid(persisted.get()?.get() ?? minRefreshSeconds)),
      set: action((seconds: number) => persisted.get()?.set(valid(seconds))),
    });
  },
});
