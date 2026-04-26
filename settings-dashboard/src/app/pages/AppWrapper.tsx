import React, {ReactNode} from 'react';
import {
  Admin,
  DataProvider,
  localStorageStore,
  Logout,
  Resource,
  StoreContextProvider,
  TitlePortal,
  DashboardMenuItem,
  MenuItemLink,
  type MenuProps,
  useTranslate,
  UserMenu,
  useStore
} from 'react-admin';
import {AuthProvider, CustomRoutes} from "ra-core";
import {
  appConfigContext,
  i18nProvider,
  PanelInterface,
  Logo,
  Theme,
  AppBarToolbar
} from "dashboard-core";
import {Layout as RaLayout, AppBar as RaAppBar} from 'react-admin';
import {Box, useMediaQuery, Typography} from "@mui/material";
import {Login} from "@/app/pages/Login";
import { colors, font, radius, spacing } from '@/app/pages/softTheme';

interface AppProps {
  children?: ReactNode;
  dashboard: React.ComponentType<any>;
  authProvider: AuthProvider;
  dataProvider: DataProvider;
  themeList: Theme[];
  panels: PanelInterface[];
}

interface AppWrapperProps extends AppProps {
}

const store = localStorageStore(undefined, appConfigContext.defaultTitle);

// ── App Bar ──────────────────────────────────────────────────
// Top navigation bar with logo, title, and user menu
export const AppBar = () => {
  const isLargeEnough = useMediaQuery<Theme>((theme:any) =>
    theme.breakpoints.up('sm')
  );
  return (
    <RaAppBar
      color="secondary"
      toolbar={<AppBarToolbar />}
      userMenu={false}
      sx={{
        height: '90px',
        minHeight: '90px !important',
        '& .MuiToolbar-root': {
          height: '90px',
          minHeight: '90px !important',
          padding: '0 60px',
          alignItems: 'center',
        },
        '& .MuiAvatar-root': {
          width: '40px',
          height: '40px',
        },
        '& .RaUserMenu-userButton': {
          padding: 0,
          minWidth: 'auto',
        },
        '& .RaLocalesMenuButton-button, & .MuiButton-root:last-of-type': {
          padding: 0,
          minWidth: 'auto',
          fontSize: '18px',
          fontWeight: 400,
          color: colors.textSubtle,
        },
      }}
    >
      <UserMenu>
        <Logout />
      </UserMenu>
      <TitlePortal />
      {isLargeEnough && <Logo style={{height:"50px",paddingRight:"12px"}}/>}
      {isLargeEnough && (
        <Typography sx={{ fontSize: '28px', fontWeight: 700, color: colors.textWhite }}>
          {appConfigContext.defaultTitle}
        </Typography>
      )}
      {isLargeEnough && <Box component="span" sx={{ flex: 1 }} />}
    </RaAppBar>
  );
};

// ── Sidebar Menu Item Styles ─────────────────────────────────
// Applied directly via sx prop on each MenuItemLink / DashboardMenuItem.
// This is more reliable than theme styleOverrides which break on page refresh.
// Active state uses a gradient border (pink-to-blue) per PDF design specs.
const menuItemLinkSx = {
  borderRadius: radius.button,
  padding: '12px 20px',
  margin: '5px 0',
  fontSize: font.menuItem,
  fontWeight: 400,
  color: colors.textMuted,
  minHeight: '50px',
  border: '1px solid transparent',
  transition: 'all 0.2s ease',
  '& .MuiListItemIcon-root': { display: 'none' },  // Icons hidden per PDF design
  '&:hover': {
    backgroundColor: colors.bgOverlay,
    color: colors.textWhite,
  },
  '&.RaMenuItemLink-active': {
    color: colors.textWhite,
    boxShadow: `1px 3px 8px ${colors.bgApp}70`,
    border: '1px solid transparent',
    borderRadius: radius.button,
    // Gradient border trick: solid background in padding-box, gradient in border-box
    background: `linear-gradient(${colors.bgSidebar}, ${colors.bgSidebar}) padding-box, linear-gradient(90deg, ${colors.primaryLight}, #ee2a7b) border-box`,
  },
};

// Renders a single panel menu item with translated label
const MenuItem = (panel: PanelInterface, dense: boolean, translate: any) => {
  return <MenuItemLink
      key={panel.name}
      to={{ pathname: '/' + panel.name }}
      primaryText={translate(`resources.` + panel.name + `.name`, { smart_count: 2 })}
      leftIcon={<panel.icon/>}
      dense={dense}
      sx={menuItemLinkSx}
  />
}

// Style for non-link menu items (e.g. "Other", "More options...")
const menuItemBoxStyle = {
  borderRadius: radius.button,
  padding: '12px 20px',
  margin: '5px 0',
  fontSize: font.menuItem,
  fontWeight: 400,
  color: colors.textMuted,
  minHeight: '50px',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: colors.bgOverlay,
    color: colors.textWhite,
  },
};

// ── Sidebar Menu ─────────────────────────────────────────────
// Builds the sidebar navigation: Dashboard link, panel links, category label, and placeholder items.
// Padding is applied here (not on RaSidebar-fixed) to avoid double-padding issues on refresh.
export const Menu = (panels: PanelInterface[]) => ({ dense = false }: MenuProps) => {
  const translate = useTranslate();

  return (
      <Box sx={{ padding: '20px', boxSizing: 'border-box' }}>
          {/* Dashboard menu link */}
          <Box sx={{ mb: 1 }}>
              <DashboardMenuItem sx={menuItemLinkSx} />
          </Box>

          {/* Panel menu links */}
          <Box>
              {panels.map(value => MenuItem(value, dense, translate))}
              <Box sx={menuItemBoxStyle}>
                  Other
              </Box>
          </Box>

          {/* Category section label */}
          <Typography sx={{
              color: colors.textSubtle,
              fontSize: font.caption,
              fontWeight: 300,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              padding: '20px 20px 10px 20px',
          }}>
              CATEGORY
          </Typography>

          {/* Placeholder for future menu items */}
          <Box sx={menuItemBoxStyle}>
              More options...
          </Box>
      </Box>
  );
};

// ── Layout ───────────────────────────────────────────────────
// Main layout wrapper that controls the overall page structure.
// Sidebar dimensions are enforced here with !important to prevent
// content overflow on page refresh (react-admin's default width:100%
// on .RaSidebar-fixed causes buttons to stretch beyond 315px).
export const Layout = (panels: PanelInterface[]) => ({ children }: { children: React.ReactNode }) => (
  <RaLayout
    appBar={AppBar}
    menu={Menu(panels)}
    sx={{
      backgroundColor: colors.bgApp,

      // App frame — area below the app bar
      '& .RaLayout-appFrame': {
        marginTop: '90px !important',
        backgroundColor: colors.bgApp,
        padding: '0 30px 30px 30px',
        height: 'calc(100vh - 90px)',
        overflow: 'hidden',
      },

      // Sidebar + content container — rounded border per PDF design
      '& .RaLayout-contentWithSidebar': {
        backgroundColor: colors.bgPage,
        borderRadius: radius.button,
        border: `1px solid ${colors.textMuted}`,
        overflow: 'hidden',
        height: '100%',
      },

      // Sidebar docked state — fixed width
      '& .RaSidebar-docked': {
        width: '315px !important',
        minWidth: '315px !important',
        height: '100%',
      },

      // Sidebar paper — maxWidth + overflow:hidden prevents menu items from stretching beyond sidebar
      '& .RaSidebar-paper': {
        width: '315px !important',
        minWidth: '315px !important',
        maxWidth: '315px !important',
        backgroundColor: `${colors.bgSidebar} !important`,
        position: 'relative !important',
        height: '100%',
        boxShadow: 'none',
        overflowX: 'hidden',
        overflowY: 'auto',
      },

      // Sidebar fixed inner — padding set to 0 (padding is on Menu Box instead to avoid double-padding)
      '& .RaSidebar-fixed': {
        padding: '0 !important',
        position: 'relative',
        width: '315px !important',
        maxWidth: '315px !important',
        boxSizing: 'border-box !important',
        marginTop: '0 !important',
        height: 'auto !important',
        overflow: 'hidden',
      },

      // Main content area — scrollable with custom scrollbar
      '& .RaLayout-content': {
        backgroundColor: colors.bgPage,
        overflowY: 'auto',
        overflowX: 'hidden',
        flex: 1,
        '&::-webkit-scrollbar': { width: '8px' },
        '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(73, 109, 142, 0.3)', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb': { backgroundColor: colors.bgPage, borderRadius: '4px' },
      },
    }}
  >
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
  const [themeName] = useStore<string>('themeName', 'soft');
  const currentTheme = themeList.find(theme => theme.name === themeName);

  const lightTheme = currentTheme?.light || themeList[0]?.light;
  const darkTheme = currentTheme?.dark || themeList[0]?.dark;

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
      defaultTheme="dark"
    >
      <CustomRoutes>
        {panelsRoutes.map(value => value)}
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
