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

import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import CloudIcon from "@mui/icons-material/Cloud";
import LanguageIcon from "@mui/icons-material/Language";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SpeedIcon from "@mui/icons-material/Speed";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import HttpsIcon from "@mui/icons-material/Https";
import TuneIcon from "@mui/icons-material/Tune";

import {AccountPanel} from "@/panels/account/AccountPanel";
import {OperatorPanel} from "@/panels/operator/OperatorPanel";
import {CertificatesPanel} from "@/panels/certificates/CertificatesPanel";
import {DomainPanel} from "@/panels/domain/DomainPanel";
import {FeaturesPanel} from "@/panels/features/FeaturesPanel";
import {HealthPanel} from "@/panels/health/HealthPanel";
import {MigrationPanel} from "@/panels/migration/MigrationPanel";
import {ResourcesPanel} from "@/panels/resources/ResourcesPanel";
import {SupportPanel} from "@/panels/support/SupportPanel";
import {SystemInformationPanel} from "@/panels/system-information/SystemInformationPanel";
import {useBrand} from "@/core/configuration/brandContext";

/**
 * The Access panel moved to auth-console (the auth stack's web UI). Links to it
 * still arrive here — pcs-orchestrator's support deeplink
 * (`#/access?account=admin&pubkeyUrl=…`, see buildSupportDeeplink) and old
 * bookmarks — so forward them, query included, to the same page there. The
 * sibling host swaps the `admin-` prefix, like AccountPanel's links.
 */
const forwardMovedAccessLink = () => {
  if (typeof window === "undefined") return;
  const m = window.location.hash.match(/^#\/access(\?.*)?$/);
  const host = window.location.host;
  if (!m || !host.startsWith("admin-")) return;
  window.location.replace(`https://auth-console-${host.slice("admin-".length)}/access${m[1] ?? ""}`);
};
forwardMovedAccessLink();

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
  // `permissions: 'admin'` on everything except `account`: a PCS can hold more
  // than one local account now, and only members of Authelia's `admins` group
  // administer the box. A plain user is left with Account alone, which links out
  // to the sign-in portal and the Auth Console (local accounts and SSH access
  // live there now). This is cosmetic — adminMiddleware on the matching
  // /api/admin routes is what actually enforces it.
  const availablePanels: PanelInterface[] = [
    definePanel({name: 'system-information', component: SystemInformationPanel, icon: InfoOutlinedIcon, label: 'System Information', permissions: 'admin'}),
    definePanel({name: 'account',            component: AccountPanel,           icon: AccountCircleIcon,  label: 'Account'}),
    definePanel({name: 'domain',             component: DomainPanel,            icon: LanguageIcon,       label: 'Domain',             permissions: 'admin'}),
    definePanel({name: 'certificates',       component: CertificatesPanel,      icon: HttpsIcon,          label: 'Certificates',       permissions: 'admin'}),
    // Gated on hasOperator rather than `operator`: the latter is also non-null via
    // the domain-zone fallback, and a box that merely sits on a known zone has no
    // operator-run services to opt out of.
    ...(brand.hasOperator
      ? [definePanel({name: 'yundera-features', component: FeaturesPanel, icon: TuneIcon, label: `${brand.support.operatorName ?? brand.brand.name} Features`, permissions: 'admin'})]
      : []),
    definePanel({name: 'health',             component: HealthPanel,            icon: DeveloperBoardIcon, label: 'Health',             permissions: 'admin'}),
    definePanel({name: 'resources',          component: ResourcesPanel,         icon: SpeedIcon,          label: 'Resources',          permissions: 'admin'}),
    definePanel({name: 'migration',          component: MigrationPanel,         icon: SwapHorizIcon,      label: 'Migration',          permissions: 'admin'}),
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
