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

import VpnKeyIcon from "@mui/icons-material/VpnKey";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import CloudIcon from "@mui/icons-material/Cloud";
import LanguageIcon from "@mui/icons-material/Language";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SpeedIcon from "@mui/icons-material/Speed";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import HttpsIcon from "@mui/icons-material/Https";

import {AccessPanel} from "@/panels/access/AccessPanel";
import {AccountPanel} from "@/panels/account/AccountPanel";
import {OperatorPanel} from "@/panels/operator/OperatorPanel";
import {CertificatesPanel} from "@/panels/certificates/CertificatesPanel";
import {DomainPanel} from "@/panels/domain/DomainPanel";
import {HealthPanel} from "@/panels/health/HealthPanel";
import {MigrationPanel} from "@/panels/migration/MigrationPanel";
import {ResourcesPanel} from "@/panels/resources/ResourcesPanel";
import {SupportPanel} from "@/panels/support/SupportPanel";
import {SystemInformationPanel} from "@/panels/system-information/SystemInformationPanel";
import {TerminalPanel} from "@/panels/terminal/TerminalPanel";
import {useBrand} from "@/core/configuration/brandContext";

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
  // administer the box. A plain user is left with Account alone, which is where
  // they manage their own credential. This is cosmetic — adminMiddleware on the
  // matching /api/admin routes is what actually enforces it.
  const availablePanels: PanelInterface[] = [
    definePanel({name: 'system-information', component: SystemInformationPanel, icon: InfoOutlinedIcon, label: 'System Information', permissions: 'admin'}),
    definePanel({name: 'account',            component: AccountPanel,           icon: AccountCircleIcon,  label: 'Account'}),
    definePanel({name: 'domain',             component: DomainPanel,            icon: LanguageIcon,       label: 'Domain',             permissions: 'admin'}),
    definePanel({name: 'certificates',       component: CertificatesPanel,      icon: HttpsIcon,          label: 'Certificates',       permissions: 'admin'}),
    definePanel({name: 'access',             component: AccessPanel,            icon: VpnKeyIcon,         label: 'Access',             permissions: 'admin'}),
    definePanel({name: 'terminal',           component: TerminalPanel,          icon: TerminalIcon,       label: 'Terminal',           permissions: 'admin'}),
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
