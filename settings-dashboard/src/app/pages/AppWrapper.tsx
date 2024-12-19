import React, {ReactNode} from 'react';
import {
  Admin,
  DataProvider,
  localStorageStore,
  Logout,
  Resource,
  StoreContextProvider, TitlePortal,
  UserMenu,
  useStore
} from 'react-admin';
import {CustomRoutes} from "ra-core";
import {
  appConfigContext,
  EmailAuthProviderInterface,
  i18nProvider,
  PanelInterface,
  Logo,
  Theme, Menu, AppBarToolbar
} from "dashboard-core";
import {Layout as RaLayout,AppBar as RaAppBar} from 'react-admin';
import {Box, useMediaQuery} from "@mui/material";
import {Login} from "@/app/pages/Login";

// Define props interface for App component
interface AppProps {
  children?: ReactNode;
  dashboard: React.ComponentType<any>;
  authProvider: EmailAuthProviderInterface;
  dataProvider: DataProvider;
  themeList: Theme[];
  panels: PanelInterface[];
}

// Define props interface for AppWrapper component
interface AppWrapperProps extends AppProps {
}

const store = localStorageStore(undefined, appConfigContext.defaultTitle);

export const AppBar = () => {
  const isLargeEnough = useMediaQuery<Theme>((theme:any) =>
    theme.breakpoints.up('sm')
  );
  return (
    <RaAppBar
      color="secondary"
      toolbar={<AppBarToolbar />}
      userMenu={
        <UserMenu>
          <Logout />
        </UserMenu>}
    >
      <TitlePortal />
      {isLargeEnough && <Logo style={{maxHeight:"30px",paddingRight:"10px"}}/>}
      {isLargeEnough && <strong>{appConfigContext.defaultTitle}</strong>}
      {isLargeEnough && <Box component="span" sx={{ flex: 1 }} />}
    </RaAppBar>
  );
};

export const Layout = (panels: PanelInterface[]) => ({ children }: { children: React.ReactNode }) => (
  <RaLayout appBar={AppBar} menu={Menu(panels)}>
    {children}
  </RaLayout>
);

const App = ({
               children,
               dashboard,
               authProvider,
               dataProvider,
               themeList,
               panels
             }: AppProps) => {
  const [themeName] = useStore<string>('themeName', 'default');
  const lightTheme = themeList.find(theme => theme.name === themeName)?.light;
  const darkTheme = themeList.find(theme => theme.name === themeName)?.dark;

  const panelsRoutes: any[] = [];
  for (const panel of panels) {
    if (panel.route) {
      for (const route of panel.route.routes) {
        panelsRoutes.push(route);
      }
    }
  }

  return (
    <Admin
      title=""
      dataProvider={dataProvider}
      authProvider={authProvider}
      dashboard={dashboard}
      loginPage={Login}
      layout={Layout(panels)}
      i18nProvider={i18nProvider(panels)}
      disableTelemetry
      lightTheme={lightTheme}
      darkTheme={darkTheme}
      defaultTheme="light"
    >
      <CustomRoutes>
        {panelsRoutes.map(value => {
          return value
        })}
      </CustomRoutes>
      {panels.map(value => {
        if (value.resource) {
          return <Resource key={value.name} {...value.resource} />
        }
        return null;
      })}
      {children}
    </Admin>
  );
};

export const AppWrapper = ({
                             children,
                             dashboard,
                             authProvider,
                             dataProvider,
                             themeList,
                             panels,
                           }: AppWrapperProps) => (
  <StoreContextProvider value={store}>
    <App
      authProvider={authProvider}
      dataProvider={dataProvider}
      dashboard={dashboard}
      panels={panels}
      themeList={themeList}
    >
      {children}
    </App>
  </StoreContextProvider>
);