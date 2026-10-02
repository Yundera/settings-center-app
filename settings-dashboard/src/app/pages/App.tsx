import {
  CustomRoutes,
  defaultDarkTheme,
  defaultLightTheme,
  houseDarkTheme,
  houseLightTheme,
  nanoDarkTheme,
  nanoLightTheme,
  radiantDarkTheme,
  radiantLightTheme
} from 'react-admin';
import {softDarkTheme, softLightTheme} from "@/app/pages/softTheme";
import {Dashboard} from "@/app/pages/Dashboard";
import {AppWrapper} from "@/app/pages/AppWrapper";
import {AuthProvider} from "ra-core";
import {definePanel} from "@/core/definePanel";
import type {PanelInterface} from "@/core/PanelInterface";

import CloudIcon from "@mui/icons-material/Cloud";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import TuneIcon from "@mui/icons-material/Tune";

import {OperatorPanel} from "@/panels/operator/OperatorPanel";
import {FeaturesPanel} from "@/panels/features/FeaturesPanel";
import {HealthPanel} from "@/panels/health/HealthPanel";
import {SupportPanel} from "@/panels/support/SupportPanel";
import {SystemInformationPanel} from "@/panels/system-information/SystemInformationPanel";
import {useBrand} from "@/core/configuration/brandContext";

/**
 * The Account and Access panels moved to auth-console (the auth stack's web UI),
 * and the Domain panel to mesh-console (the mesh stack's).
 * Links to them still arrive here — pcs-orchestrator's support deeplink
 * (`#/access?account=admin&pubkeyUrl=…`, see buildSupportDeeplink) and old
 * bookmarks — so forward them, query included, to the matching page there
 * (`#/account` → the console's Account page at `/`). The sibling host swaps the
 * `admin-` prefix, which is correct for the gateway, nip.io and sslip.io hosts.
 */
const MOVED_PANELS: Record<string, {console: string, path: string}> = {
  access: {console: "auth-console", path: "/access"},
  account: {console: "auth-console", path: "/"},
  domain: {console: "mesh-console", path: "/domain"},
};
const forwardMovedPanels = () => {
  if (typeof window === "undefined") return;
  const m = window.location.hash.match(/^#\/(access|account|domain)(\?.*)?$/);
  const host = window.location.host;
  if (!m || !host.startsWith("admin-")) return;
  const moved = MOVED_PANELS[m[1]];
  window.location.replace(`https://${moved.console}-${host.slice("admin-".length)}${moved.path}${m[2] ?? ""}`);
};
forwardMovedPanels();

const MyApp = ({authProvider, dataProvider, permissions}: {
  authProvider: AuthProvider,
  dataProvider: any,
  permissions: Record<string, boolean>
}) => {

  const brand = useBrand();

  // Brand-gated panels are omitted from this array rather than filtered later:
  // `panels` is the single source the routes, the <Resource> map, the i18n
  // labels and the sidebar all derive from, so dropping an entry here removes
  // it from every one of them at once.
  //
  //   operator — null when there is no operator AND the domain zone is not one
  //              we know a dashboard for. Nothing to link to, so no panel.
  //   support  — an operator-only surface. Without one, every call in
  //              SupportKey.ts throws; hiding beats rendering a dead toggle.
  //
  // `permissions: 'admin'` on every panel: only members of Authelia's `admins`
  // group administer the box. Accounts and SSH access are managed in auth-console,
  // the domain in mesh-console (see forwardMovedPanels). This is cosmetic — adminMiddleware on the matching
  // /api/admin routes is what actually enforces it.
  const availablePanels: PanelInterface[] = [
    definePanel({name: 'system-information', component: SystemInformationPanel, icon: InfoOutlinedIcon, label: 'System Information', permissions: 'admin'}),
    // Gated on hasOperator rather than `operator`: the latter is also non-null via
    // the domain-zone fallback, and a box that merely sits on a known zone has no
    // operator-run services to opt out of.
    ...(brand.hasOperator
      ? [definePanel({name: 'yundera-features', component: FeaturesPanel, icon: TuneIcon, label: `${brand.support.operatorName ?? brand.brand.name} Features`, permissions: 'admin'})]
      : []),
    definePanel({name: 'health',             component: HealthPanel,            icon: DeveloperBoardIcon, label: 'Health',             permissions: 'admin'}),
    ...(brand.operator
      ? [definePanel({name: 'operator', component: OperatorPanel, icon: CloudIcon, label: brand.operator.panelLabel, permissions: 'admin'})]
      : []),
    ...(brand.support.enabled
      ? [definePanel({name: 'support', component: SupportPanel, icon: SupportAgentIcon, label: 'Support', permissions: 'admin'})]
      : []),
  ];

  const panels = availablePanels.filter(panel =>
    !panel.permissions || !!permissions[panel.permissions]
  );

  return (
    <AppWrapper
      authProvider={authProvider}
      dataProvider={dataProvider}
      themeList={[
        {name: 'default', light: defaultLightTheme, dark: nanoLightTheme},
        {name: 'soft', light: softLightTheme, dark: softDarkTheme},
        {name: 'classic', light: defaultLightTheme, dark: defaultDarkTheme},
        {name: 'nano', light: nanoLightTheme, dark: nanoDarkTheme},
        {name: 'radiant', light: radiantLightTheme, dark: radiantDarkTheme},
        {name: 'house', light: houseLightTheme, dark: houseDarkTheme},
      ]}
      dashboard={Dashboard}
      panels={panels}
    >
      {/* Custom routes no layout external*/}
      <CustomRoutes noLayout>
        <></>
      </CustomRoutes>

      {/* Custom routes in app*/}
      <CustomRoutes>
        <></>
      </CustomRoutes>
    </AppWrapper>
  );
};

export default MyApp;
