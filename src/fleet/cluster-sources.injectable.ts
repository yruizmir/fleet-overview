import { getInjectable2 } from "@k8slens/injectable";
import { getPersistableMapInjectableBunch } from "@k8slens/persistable-contracts";
import { action, computed, observable, type ObservableMap, runInAction } from "mobx";

// Lens does not tell extensions where a cluster came from, so the user names it: kubeconfig, context, folder.
export const clusterSourcesBunch = getPersistableMapInjectableBunch<string, string>()({
  id: "cluster-sources",
});

export const clusterSourcesInjectable = getInjectable2({
  id: "fleet-overview-cluster-sources",

  instantiate: (di) => {
    const getSources = di.inject(clusterSourcesBunch.persistable);
    const sources = observable.box<ObservableMap<string, string> | undefined>(undefined, { deep: false });
    const editing = observable.box<{ clusterId: string; draft: string } | undefined>(undefined);

    void getSources().then((loaded) => runInAction(() => sources.set(loaded)));

    return () => ({
      sourceOf: (clusterId: string) => computed(() => sources.get()?.get(clusterId)),
      editing: computed(() => editing.get()),
      startEditing: action((clusterId: string) =>
        editing.set({ clusterId, draft: sources.get()?.get(clusterId) ?? "" }),
      ),
      setDraft: action((draft: string) => {
        const current = editing.get();

        if (current) {
          editing.set({ ...current, draft });
        }
      }),
      cancel: action(() => editing.set(undefined)),
      save: action(() => {
        const current = editing.get();
        const map = sources.get();

        if (current && map) {
          const value = current.draft.trim();

          if (value) {
            map.set(current.clusterId, value);
          } else {
            map.delete(current.clusterId);
          }
        }

        editing.set(undefined);
      }),
    });
  },
});
