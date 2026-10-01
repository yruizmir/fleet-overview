import { getInjectable2 } from "@k8slens/injectable";
import { navigateToPreferencesInjectionToken } from "@k8slens/preferences-contracts";
import packageJson from "../../package.json";

// Takes the user to the extension's page in Lens Preferences, where all its settings are.
export const openSettingsInjectable = getInjectable2({
  id: "fleet-overview-open-settings",
  consumptions: [navigateToPreferencesInjectionToken],

  instantiate: (di) => {
    const navigateToPreferences = di.inject(navigateToPreferencesInjectionToken)();

    return () => () => navigateToPreferences({ pageId: packageJson.name });
  },
});
