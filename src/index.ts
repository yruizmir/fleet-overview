import { getFeature, registerInjectablesFromModules } from "@k8slens/feature-core";
import modulesWithInjectables from "./**/*.injectable.(ts|tsx)";
import stylesheets from "./**/!(_*).(scss|css)";

export const fleetOverviewFeature = getFeature({
  id: "fleet-overview",
  register: (di) => {
    // Every `*.injectable.(ts|tsx)` and stylesheet under src/ registers itself.
    registerInjectablesFromModules(di, [...modulesWithInjectables, ...stylesheets]);
  },
});
