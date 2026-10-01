import { getInjectable2 } from "@k8slens/injectable";
import { getPersistableSetInjectableBunch } from "@k8slens/persistable-contracts";
import { action, observable, type ObservableSet, runInAction } from "mobx";

// Alerts, by key, the user asked never to be notified about again.
export const silencedAlertsBunch = getPersistableSetInjectableBunch<string>()({
  id: "silenced-alerts",
});

// "Never notify me about this alert": unlike a mute, the alert stays listed and counted; it only stops raising
// notifications, until the user turns them back on from its row in the view.
export const silencedAlertsInjectable = getInjectable2({
  id: "fleet-overview-silenced-alerts",

  instantiate: (di) => {
    const getSilenced = di.inject(silencedAlertsBunch.persistable);
    const silenced = observable.box<ObservableSet<string> | undefined>(undefined, { deep: false });

    void getSilenced().then((loaded) => runInAction(() => silenced.set(loaded)));

    return () => ({
      isSilenced: (key: string) => silenced.get()?.has(key) ?? false,
      silence: action((key: string) => silenced.get()?.add(key)),
      unsilence: action((key: string) => silenced.get()?.delete(key)),
    });
  },
});
