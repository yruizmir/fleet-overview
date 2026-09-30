import { getInjectable2 } from "@k8slens/injectable";
import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import { focusTabInjectionToken, openTabInjectionToken, tabIsOpenInjectionToken } from "@k8slens/tab-contracts";
import { fleetTabKind } from "./fleet-tab.injectable";

const tabId = "fleet";

export const openFleetOverviewInjectable = getInjectable2({
  id: "fleet-overview-open-fleet-overview",
  consumptions: [openTabInjectionToken, focusTabInjectionToken, tabIsOpenInjectionToken],

  instantiate: (di) => {
    const openTab = di.inject(openTabInjectionToken.for(mainViewTabHostKind).for(fleetTabKind).for(di.scopeIds))();
    const focusTab = di.inject(focusTabInjectionToken.for(mainViewTabHostKind).for(fleetTabKind).for(di.scopeIds))();
    const isOpen = di.inject(tabIsOpenInjectionToken.for(mainViewTabHostKind).for(fleetTabKind).for(di.scopeIds))();

    return () => async () => {
      if (await isOpen({ tabId })) {
        await focusTab({ tabId });
      } else {
        await openTab({ tabId });
      }
    };
  },
});
