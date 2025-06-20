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
import {securityPanel} from "@/panels/security/Config";
import {AuthProvider} from "ra-core";
import {healthPanel} from "@/panels/health/Config";

const MyApp = ({authProvider, dataProvider, permissions}: {
  authProvider:AuthProvider,
  dataProvider: any,
  permissions: Record<string, boolean>
}) => {

  let availablePanels: any[] = [healthPanel]
  let panels: any[] = [];
  for (const availablePanel of availablePanels) {
    if (availablePanel.permissions && !!permissions[availablePanel.permissions]) {
      panels.push(availablePanel);
    } else if (!availablePanel.permissions) {
      panels.push(availablePanel);
    }
  }

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