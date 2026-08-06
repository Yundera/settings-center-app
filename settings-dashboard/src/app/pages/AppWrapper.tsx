import React, {ReactNode} from 'react';
import {
  Admin,
  DataProvider,
  localStorageStore,
  Logout,
  Resource,
  StoreContextProvider,
  TitlePortal,
  MenuItemLink,
  type MenuProps,
  useSidebarState,
  useTranslate,
  UserMenu,
  useStore
} from 'react-admin';
import {AuthProvider, CustomRoutes} from "ra-core";
import {appConfigContext} from "@/core/configuration/appConfigContext";
import {i18nProvider} from "@/core/component/I18nProvider";
import type {PanelInterface} from "@/core/PanelInterface";
import {Logo} from "@/core/layout/Logo";
import type {Theme} from "@/core/types";
import {AppBarToolbar} from "@/core/layout/AppBarToolbar";
import {Layout as RaLayout, AppBar as RaAppBar} from 'react-admin';
import {Box, Tooltip, useMediaQuery, Typography} from "@mui/material";
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DashboardIcon from '@mui/icons-material/Dashboard';
import { colors, font } from '@/app/pages/softTheme';
import { OnboardingGate } from '@/app/pages/OnboardingGate';

const SIDEBAR_WIDTH_OPEN = 280;
const SIDEBAR_WIDTH_CLOSED = 72;

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

const menuItemSx = (open: boolean) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  paddingLeft: open ? '24px' : 0,
  paddingRight: open ? '20px' : 0,
  justifyContent: open ? 'flex-start' : 'center',
  margin: 0,
  minHeight: '52px',
  width: '100%',
  fontSize: font.menuItem,
  fontWeight: 400,
  color: colors.textMuted,
  borderRadius: 0,
  border: 'none',
  boxShadow: 'none',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  transition: 'background-color 0.15s ease, color 0.15s ease, padding 0.2s ease',
  '& .MuiListItemIcon-root, & .RaMenuItemLink-icon': {
    display: 'flex',
    minWidth: 'auto',
    color: 'inherit',
    margin: 0,
  },
  '& .rail-label': {
    display: open ? 'inline' : 'none',
  },
  '&:hover': {
    backgroundColor: colors.bgOverlay,
    color: colors.textWhite,
  },
  '&.RaMenuItemLink-active': {
    color: colors.textWhite,
    backgroundColor: colors.bgOverlay,
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: '8px',
      bottom: '8px',
      width: '3px',
      borderRadius: '0 2px 2px 0',
      background: `linear-gradient(180deg, ${colors.primaryLight}, #ee2a7b)`,
    },
  },
});

type MenuEntry = { name: string; icon: React.ComponentType; path: string; label: string };

const renderMenuItem = (entry: MenuEntry, dense: boolean, open: boolean) => {
  const Icon = entry.icon;
  return (
    <MenuItemLink
      key={entry.name}
      to={entry.path}
      primaryText={<span className="rail-label">{entry.label}</span>}
      leftIcon={<Icon />}
      dense={dense}
      sx={menuItemSx(open)}
    />
  );
};

export const Menu = (panels: PanelInterface[]) => {
  function MenuComponent({ dense = false }: MenuProps) {
    const translate = useTranslate();
    const [open, setOpen] = useSidebarState();

  const entries: MenuEntry[] = [
    { name: 'dashboard', icon: DashboardIcon, path: '/', label: translate('ra.page.dashboard') },
    ...panels.map(p => ({
      name: p.name,
      icon: p.icon,
      path: '/' + p.name,
      label: translate(`resources.${p.name}.name`, { smart_count: 2 }),
    })),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', paddingTop: '12px' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {entries.map(entry => renderMenuItem(entry, dense, open))}
      </Box>
      <Tooltip title={open ? '' : 'Expand'} placement="right" disableInteractive>
        <Box
          component="button"
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
          sx={{
            ...menuItemSx(open),
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            color: colors.textSubtle,
            borderTop: `1px solid ${colors.borderMuted}`,
          }}
        >
          {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          {open && <Box component="span" className="rail-label">Collapse</Box>}
        </Box>
      </Tooltip>
    </Box>
  );
  }
  return MenuComponent;
};

export const Layout = (panels: PanelInterface[]) => {
  function LayoutComponent({ children }: { children: React.ReactNode }) {
    const [open] = useSidebarState();
    const width = open ? SIDEBAR_WIDTH_OPEN : SIDEBAR_WIDTH_CLOSED;
    return (
    <RaLayout
      appBar={AppBar}
      menu={Menu(panels)}
      sx={{
        backgroundColor: colors.bgApp,

        '& .RaLayout-appFrame': {
          marginTop: '90px !important',
          backgroundColor: colors.bgApp,
          padding: 0,
          height: 'calc(100vh - 90px)',
          overflow: 'hidden',
        },

        '& .RaLayout-contentWithSidebar': {
          backgroundColor: colors.bgPage,
          height: '100%',
        },

        '& .RaSidebar-docked, & .RaSidebar-paper, & .RaSidebar-fixed': {
          width: `${width}px`,
          minWidth: `${width}px`,
          maxWidth: `${width}px`,
          height: 'calc(100vh - 90px)',
          transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        },

        '& .RaSidebar-paper': {
          backgroundColor: colors.bgSidebar,
          boxShadow: 'none',
          borderRight: `1px solid ${colors.borderMuted}`,
        },

        '& .RaSidebar-fixed': {
          padding: 0,
          height: 'calc(100vh - 90px) !important',
          overflowX: 'hidden',
          overflowY: 'hidden',
        },

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
  }
  return LayoutComponent;
};

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
      loginPage={false}
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

// OnboardingGate wraps the shell rather than living on a route: "first start"
// has to be unavoidable, and a route can be navigated away from. It renders
// children untouched once the PCS is claimed and the welcome has been seen, and
// also whenever its status call fails — a broken endpoint must never lock a
// working dashboard behind a modal. See OnboardingGate.tsx.
export const AppWrapper = ({
  children,
  dashboard,
  authProvider,
  dataProvider,
  themeList,
  panels,
}: AppWrapperProps) => (
  <StoreContextProvider value={store}>
    <OnboardingGate>
      <App
        authProvider={authProvider}
        dataProvider={dataProvider}
        dashboard={dashboard}
        panels={panels}
        themeList={themeList}
      >
        {children}
      </App>
    </OnboardingGate>
  </StoreContextProvider>
);
