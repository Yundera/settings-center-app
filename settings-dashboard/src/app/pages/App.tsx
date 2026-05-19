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
import {definePanel, PanelInterface} from "dashboard-core";

import VpnKeyIcon from "@mui/icons-material/VpnKey";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import AppsIcon from "@mui/icons-material/Apps";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import LanguageIcon from "@mui/icons-material/Language";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SpeedIcon from "@mui/icons-material/Speed";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";

import {AccessPanel} from "@/panels/access/AccessPanel";
import {AccountPanel} from "@/panels/account/AccountPanel";
import {AppsPanel} from "@/panels/apps/AppsPanel";
import {BillingPanel} from "@/panels/billing/BillingPanel";
import {DomainPanel} from "@/panels/domain/DomainPanel";
import {HealthPanel} from "@/panels/health/HealthPanel";
import {MigrationPanel} from "@/panels/migration/MigrationPanel";
import {ResourcesPanel} from "@/panels/resources/ResourcesPanel";
import {SupportPanel} from "@/panels/support/SupportPanel";
import {SystemInformationPanel} from "@/panels/system-information/SystemInformationPanel";
import {TerminalPanel} from "@/panels/terminal/TerminalPanel";

const MyApp = ({authProvider, dataProvider, permissions}: {
  authProvider: AuthProvider,
  dataProvider: any,
  permissions: Record<string, boolean>
}) => {

  const availablePanels: PanelInterface[] = [
    definePanel({name: 'system-information', component: SystemInformationPanel, icon: InfoOutlinedIcon, label: 'System Information'}),
    definePanel({name: 'account',            component: AccountPanel,           icon: AccountCircleIcon,  label: 'Account'}),
    definePanel({name: 'domain',             component: DomainPanel,            icon: LanguageIcon,       label: 'Domain'}),
    definePanel({name: 'access',             component: AccessPanel,            icon: VpnKeyIcon,         label: 'Access'}),
    definePanel({name: 'terminal',           component: TerminalPanel,          icon: TerminalIcon,       label: 'Terminal'}),
    definePanel({name: 'health',             component: HealthPanel,            icon: DeveloperBoardIcon, label: 'Health'}),
    definePanel({name: 'apps',               component: AppsPanel,              icon: AppsIcon,           label: 'Apps'}),
    definePanel({name: 'resources',          component: ResourcesPanel,         icon: SpeedIcon,          label: 'Resources'}),
    definePanel({name: 'migration',          component: MigrationPanel,         icon: SwapHorizIcon,      label: 'Migration'}),
    definePanel({name: 'billing',            component: BillingPanel,           icon: ReceiptLongIcon,    label: 'Billing'}),
    definePanel({name: 'support',            component: SupportPanel,           icon: SupportAgentIcon,   label: 'Support'}),
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
