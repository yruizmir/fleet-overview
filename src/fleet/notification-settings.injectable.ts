import { getInjectable2 } from "@k8slens/injectable";
import { getPersistableValueInjectableBunch } from "@k8slens/persistable-contracts";
import { action, computed, type IObservableValue, observable, runInAction } from "mobx";
import { defaultNotificationSettings, type NotificationSettings, notificationState, pauseForMs } from "./notification-policy";

export const notificationSettingsBunch = getPersistableValueInjectableBunch<NotificationSettings>()({
  id: "notification-settings",
  defaultValue: { instantiate: () => async () => defaultNotificationSettings },
});

// Whether critical alerts raise notifications: on, paused for a day, or off until turned back on. Kept across
// restarts. Silencing notifications leaves the alerts themselves in the view and the status bar.
export const notificationSettingsInjectable = getInjectable2({
  id: "fleet-overview-notification-settings",

  instantiate: (di) => {
    const getPersisted = di.inject(notificationSettingsBunch.persistable);
    const persisted = observable.box<IObservableValue<NotificationSettings> | undefined>(undefined, { deep: false });
    // Ticks once a minute, so the end of a pause shows without anything else changing.
    const now = observable.box(Date.now());

    void getPersisted().then((loaded) => runInAction(() => persisted.set(loaded)));
    setInterval(() => runInAction(() => now.set(Date.now())), 60_000);

    const settings = () => persisted.get()?.get() ?? defaultNotificationSettings;
    const set = (next: NotificationSettings) => persisted.get()?.set(next);

    return () => ({
      state: computed(() => notificationState(settings(), now.get())),
      pauseForADay: action(() => set({ ...settings(), pausedUntil: Date.now() + pauseForMs })),
      turnOff: action(() => set({ off: true })),
      // Back on, whether it was paused or off.
      turnOn: action(() => set({ off: false })),
    });
  },
});
