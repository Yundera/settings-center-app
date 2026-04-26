import { defaultTheme } from 'react-admin';

/**
 * Yundera Settings Dashboard — Single Source of Truth for all design
 * Based on PCS_settings_V2.pdf design specifications
 *
 * This file manages all design tokens, reusable styles, and MUI themes.
 * - colors, radius, font, spacing: Design tokens (colors, sizes, spacing)
 * - card, title, button, chip, icon, text: Reusable sx styles used by components
 * - softDarkTheme, softLightTheme: MUI theme configuration
 *
 * Note: react-admin components (RaSidebar, RaMenuItemLink) have unstable
 * theme styleOverrides on page refresh, so they are controlled directly
 * via sx props in AppWrapper.tsx.
 */

// ============================================================
// Design Tokens
// ============================================================

export const colors = {
    // Brand — primary accent color used for buttons, links, active states
    primary: '#27aae1',
    primaryHover: '#1e9dd0',       // Darkened primary for hover effects
    primaryLight: '#27b4e1',       // Lighter variant used in gradient borders

    // Backgrounds — layered from darkest (app) to lightest (card)
    bgApp: '#0a273f',              // Outermost app background (behind sidebar + content)
    bgSidebar: '#3d5b7c',         // Sidebar navigation background
    bgPage: '#496d8e',            // Main content area background
    bgCard: '#5883a3',            // Card component background
    bgInput: 'rgba(61, 91, 124, 0.5)', // Semi-transparent input field background
    bgOverlay: 'rgba(255, 255, 255, 0.05)', // Subtle hover overlay

    // Text — white for primary, muted/subtle for secondary/tertiary
    textWhite: '#ffffff',          // Primary text on dark backgrounds
    textMuted: '#a6cced',          // Secondary text, labels, placeholders
    textSubtle: '#769ab5',         // Tertiary text, category labels
    textDark: '#0a273f',           // Text on light/colored backgrounds

    // Borders
    borderMuted: 'rgba(166, 204, 237, 0.3)',  // Default input/card borders
    borderActive: 'rgba(166, 204, 237, 0.5)', // Focused/active borders

    // Status — semantic colors for health indicators and chips
    statusSuccess: '#66dd74',      // Green — healthy / up-to-date
    statusSuccessChip: '#66dd74',  // Green chip text/border color
    statusWarning: '#ffa726',      // Orange — updates available
    statusWarningAlt: '#fce354',   // Yellow — in-progress state
    statusError: '#ff809e',        // Pink — error state
    statusErrorAlt: '#f44336',     // Red — critical error
    statusInfo: '#29b6f6',         // Blue — informational / never-run
};

export const radius = {
    card: '20px',       // Card container border radius
    button: '30px',     // Pill-shaped buttons and sidebar menu items
    chipLarge: '50px',  // Large status chip (fully rounded)
    chipSmall: '12px',  // Small tag chip
    input: '8px',       // Input fields and small containers
};

export const font = {
    titleLarge: '24px', // Page-level titles (e.g. "System Health" heading)
    title: '21px',      // Card header titles (e.g. "Update Channel", "Software Status")
    label: '16px',      // Field labels, body text, button text
    detail: '14px',     // Detail/secondary information text
    caption: '12px',    // Small captions, input labels, chip text
    menuItem: '21px',   // Sidebar navigation menu item text
};

export const spacing = {
    cardPadding: '30px',              // Inner padding of card content area
    headerPadding: '24px 25px 25px 35px', // Card header padding (top right bottom left)
    itemGap: '25px',                  // Gap between list items inside cards
    cardGap: '50px',                  // Gap between card sections on a page
    pageY: '70px',                    // Vertical padding for page-level sections
    pageX: '40px',                    // Horizontal padding for page-level sections
    iconLeft: '5px',                  // Left margin for status icons
    iconRight: '30px',                // Right margin for status icons (space before text)
};

// ============================================================
// Reusable sx Styles (imported and applied via sx prop in components)
// ============================================================

// Card — shared layout for all card containers (UpdateChannel, DockerUpdate, SelfCheck, EnvConfiguration)
export const card = {
    root: {
        backgroundColor: colors.bgCard,
        borderRadius: radius.card,
        width: '100%',
        maxWidth: '800px',
        margin: '0 auto',
    },
    // Blue header bar at the top of each card
    header: {
        backgroundColor: colors.primary,
        padding: spacing.headerPadding,
        borderRadius: `${radius.card} ${radius.card} 0 0`,
    },
    content: {
        padding: spacing.cardPadding,
        '&:last-child': { paddingBottom: `${spacing.cardPadding} !important` },
    },
};

// Title — card header text styles
export const title = {
    small: {                           // Used in card headers (21px)
        color: colors.textWhite,
        fontSize: font.title,
        fontWeight: 700,
    },
    large: {                           // Used in page-level headings (24px)
        color: colors.textWhite,
        fontSize: font.titleLarge,
        fontWeight: 700,
    },
};

// Button — primary action button style (e.g. "Save Channel", "Run Self-Check")
export const button = {
    primary: {
        fontSize: font.label,
        fontWeight: 700,
        padding: '12px 30px',
        backgroundColor: colors.primary,
        color: colors.textWhite,
        borderRadius: radius.button,
        textTransform: 'none' as const,
        '&:hover': {
            backgroundColor: colors.primaryHover,
        },
    },
};

// Chip — status indicator and tag styles
export const chip = {
    // Large rounded chip for overall status (e.g. "UP TO DATE", "SUCCESS")
    status: {
        fontSize: font.detail,
        fontWeight: 700,
        letterSpacing: '1px',
        borderRadius: radius.chipLarge,
        textTransform: 'uppercase' as const,
        backgroundColor: 'transparent',
    },
    // Small tag chip for per-item status (e.g. "UP TO DATE", "ERROR")
    tag: {
        fontSize: font.caption,
        fontWeight: 700,
        letterSpacing: '0.75px',
        borderRadius: radius.chipSmall,
        textTransform: 'uppercase' as const,
        backgroundColor: 'transparent',
    },
};

// Icon — status icon container and sizing
export const icon = {
    // Wrapper box that positions the icon with consistent margins
    container: {
        ml: spacing.iconLeft,
        mr: spacing.iconRight,
        flexShrink: 0,
        width: '20px',
        height: '20px',
        display: 'flex' as const,
        alignItems: 'center',
    },
    // Standard icon dimensions
    size: {
        width: '20px',
        height: '20px',
    },
};

// Text — reusable typography styles for content within cards
export const text = {
    label: { fontSize: font.label, fontWeight: 700, color: colors.textWhite },     // Bold white label (e.g. "Status:", image names)
    detail: { fontSize: font.detail, fontWeight: 400, color: colors.textMuted },    // Muted detail text (e.g. digests, timestamps)
    bodyWhite: { fontSize: font.label, fontWeight: 400, color: colors.textWhite },  // Regular white body text
    bodyMuted: { fontSize: font.label, fontWeight: 400, color: colors.textMuted },  // Regular muted body text
};

// ============================================================
// MUI Theme Configuration
// ============================================================

export const softDarkTheme: any = {
    palette: {
        primary: {
            main: colors.primary,
            light: colors.primaryLight,
            dark: colors.primaryHover,
        },
        secondary: {
            main: colors.bgApp,
            light: colors.bgPage,
            dark: colors.bgSidebar,
            contrastText: colors.textWhite,
        },
        background: {
            default: colors.bgApp,
            paper: colors.bgCard,
        },
        text: {
            primary: colors.textWhite,
            secondary: colors.textMuted,
            disabled: colors.textSubtle,
        },
        success: {
            main: colors.statusSuccess,
            contrastText: colors.textDark,
        },
        warning: {
            main: colors.statusWarningAlt,
            contrastText: colors.textDark,
        },
        error: {
            main: '#f809e0',
            contrastText: colors.textWhite,
        },
        mode: 'dark' as const,
    },
    shape: {
        borderRadius: 12,
    },
    sidebar: {
        width: 315,
    },
    typography: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
        h1: { fontSize: '28px', fontWeight: 700, color: colors.textWhite },
        h2: { fontSize: font.titleLarge, fontWeight: 700, color: colors.textWhite },
        h3: { fontSize: font.title, fontWeight: 700, color: colors.textWhite },
        h4: { fontSize: '18px', fontWeight: 700, color: colors.textWhite },
        h5: { fontSize: font.label, fontWeight: 700, color: colors.primary },
        h6: { fontSize: font.label, fontWeight: 700, color: colors.textWhite },
        body1: { fontSize: font.label, fontWeight: 400, color: colors.textWhite },
        body2: { fontSize: font.detail, fontWeight: 400, color: colors.textMuted },
        caption: {
            fontSize: font.caption,
            fontWeight: 300,
            color: colors.textSubtle,
            letterSpacing: '1px',
            textTransform: 'uppercase' as const,
        },
    },
    components: {
        ...defaultTheme.components,

        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    backgroundColor: colors.bgSidebar,
                    margin: 0,
                    padding: 0,
                },
            },
        },

        RaLayout: {
            styleOverrides: {
                root: { backgroundColor: colors.bgSidebar },
                content: {
                    backgroundColor: colors.bgSidebar,
                    padding: '24px',
                    marginTop: '60px',
                },
            },
        },

        RaAppBar: {
            styleOverrides: {
                root: {
                    height: '60px',
                    '& .MuiToolbar-root': { minHeight: '60px' },
                    '& .RaAppBar-menuButton': { display: 'none' },
                },
            },
        },
        MuiAppBar: {
            styleOverrides: {
                colorSecondary: {
                    color: colors.textMuted,
                    backgroundColor: colors.bgApp,
                },
            },
            defaultProps: { elevation: 0 },
        },

        RaSidebar: {
            styleOverrides: {
                root: { backgroundColor: colors.bgPage, borderRight: 'none' },
                fixed: {
                    backgroundColor: colors.bgPage,
                    padding: '20px',
                    position: 'relative',
                    width: '100%',
                    marginTop: '0 !important',
                    height: 'auto !important',
                },
                docked: { backgroundColor: colors.bgPage },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: colors.bgPage,
                    boxShadow: '5px 0px 10px rgba(10, 39, 63, 0.70)',
                    border: 'none',
                },
            },
        },

        // RaMenuItemLink: Theme styleOverrides are unstable on refresh, so actual styling is done via sx prop in AppWrapper.tsx
        RaMenuItemLink: {
            styleOverrides: {
                root: {
                    borderRadius: radius.button,
                    padding: '12px 20px',
                    margin: '5px 0',
                    fontSize: font.menuItem,
                    fontWeight: 400,
                    color: colors.textMuted,
                    minHeight: '50px',
                    transition: 'all 0.2s ease',
                    border: '1px solid transparent',
                    '&:hover': {
                        backgroundColor: colors.bgOverlay,
                        color: colors.textWhite,
                    },
                    '&.RaMenuItemLink-active': {
                        color: colors.textWhite,
                        boxShadow: `1px 3px 8px ${colors.bgApp}70`,
                        border: '1px solid transparent',
                        borderRadius: radius.button,
                        background: `linear-gradient(${colors.bgSidebar}, ${colors.bgSidebar}) padding-box, linear-gradient(90deg, ${colors.primaryLight}, #ee2a7b) border-box`,
                    },
                    '& .MuiListItemIcon-root': { display: 'none' },
                },
            },
        },

        MuiPaper: {
            styleOverrides: {
                root: { backgroundColor: colors.bgCard, border: 'none' },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: { backgroundColor: colors.bgCard, overflow: 'hidden' },
            },
        },
        MuiCardContent: {
            styleOverrides: {
                root: {
                    padding: '30px 40px',
                    '&:last-child': { paddingBottom: '30px' },
                },
            },
        },

        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    padding: '12px 30px',
                    minHeight: '40px',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '2px 4px 12px rgba(10, 39, 63, 0.5)',
                    },
                },
                containedPrimary: {
                    backgroundColor: colors.primary,
                    color: colors.textWhite,
                    '&:hover': { backgroundColor: colors.primaryHover },
                },
            },
        },

        MuiTextField: {
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        backgroundColor: colors.bgInput,
                        borderRadius: radius.input,
                        minHeight: '50px',
                        color: colors.textWhite,
                        '& fieldset': { borderColor: colors.borderMuted },
                        '&:hover fieldset': { borderColor: colors.primary },
                        '&.Mui-focused fieldset': {
                            borderColor: colors.primary,
                            boxShadow: '0 0 0 3px rgba(39, 170, 225, 0.1)',
                        },
                    },
                    '& .MuiInputLabel-root': {
                        fontSize: font.caption,
                        fontWeight: 300,
                        color: colors.textMuted,
                    },
                },
            },
        },

        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: '4px',
                    fontWeight: 700,
                    fontSize: font.caption,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.75px',
                    padding: '6px 12px',
                    minHeight: '24px',
                },
                colorSuccess: { backgroundColor: colors.statusSuccess, color: colors.textDark },
                colorWarning: { backgroundColor: colors.statusWarningAlt, color: colors.textDark },
                colorError: { backgroundColor: '#f809e0', color: colors.textWhite },
                colorInfo: { backgroundColor: colors.primary, color: colors.textWhite },
            },
        },

        MuiDivider: {
            styleOverrides: {
                root: { borderColor: colors.borderMuted },
            },
        },

        MuiList: {
            styleOverrides: {
                root: { padding: '8px 25px' },
            },
        },
    },
};

export const softLightTheme: any = {
    palette: {
        primary: {
            main: '#27aae1',
            light: '#27b4e1',
            dark: '#1e9dd0',
        },
        secondary: {
            main: '#ffffff',
            light: '#f5f7fa',
            dark: '#e0e0e3',
            contrastText: '#496d8e',
        },
        background: {
            default: '#f5f7fa',
            paper: '#ffffff',
        },
        text: {
            primary: '#0a273f',
            secondary: '#496d8e',
            disabled: '#a0a0a0',
        },
        success: {
            main: '#66dd74',
            contrastText: '#0a273f',
        },
        warning: {
            main: '#fce354',
            contrastText: '#0a273f',
        },
        error: {
            main: '#f809e0',
            contrastText: '#ffffff',
        },
        mode: 'light' as const,
    },
    shape: {
        borderRadius: 12,
    },
    sidebar: {
        width: 315,
    },
    typography: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
        h1: { fontSize: '28px', fontWeight: 700 },
        h2: { fontSize: '24px', fontWeight: 700 },
        h3: { fontSize: '21px', fontWeight: 700 },
        h4: { fontSize: '18px', fontWeight: 700 },
        h5: { fontSize: '16px', fontWeight: 700, color: '#27aae1' },
        h6: { fontSize: '16px', fontWeight: 700 },
        body1: { fontSize: '16px', fontWeight: 400 },
        body2: { fontSize: '14px', fontWeight: 400 },
        caption: {
            fontSize: '12px',
            fontWeight: 300,
            letterSpacing: '1px',
            textTransform: 'uppercase' as const,
        },
    },
    components: {
        ...defaultTheme.components,

        MuiCssBaseline: {
            styleOverrides: {
                body: { backgroundColor: '#f5f7fa', margin: 0, padding: 0 },
            },
        },

        RaLayout: {
            styleOverrides: {
                root: { backgroundColor: '#f5f7fa' },
                content: {
                    backgroundColor: '#f5f7fa',
                    padding: '24px',
                    marginTop: '60px',
                },
            },
        },

        RaAppBar: {
            styleOverrides: {
                root: {
                    height: '60px',
                    '& .MuiToolbar-root': { minHeight: '60px' },
                    '& .RaAppBar-menuButton': { display: 'none' },
                },
            },
        },
        MuiAppBar: {
            styleOverrides: {
                colorSecondary: {
                    color: '#496d8e',
                    backgroundColor: '#ffffff',
                    boxShadow: '0 2px 8px rgba(10, 39, 63, 0.1)',
                },
            },
            defaultProps: { elevation: 0 },
        },

        RaSidebar: {
            styleOverrides: {
                root: { backgroundColor: '#ffffff', borderRight: 'none' },
                fixed: {
                    backgroundColor: '#ffffff',
                    marginTop: '60px',
                    height: 'calc(100vh - 60px)',
                },
                docked: { backgroundColor: '#ffffff' },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: '#ffffff',
                    boxShadow: '2px 0px 8px rgba(10, 39, 63, 0.1)',
                    border: 'none',
                },
            },
        },

        RaMenuItemLink: {
            styleOverrides: {
                root: {
                    borderLeft: '3px solid transparent',
                    borderRadius: '12px',
                    padding: '12px 20px',
                    margin: '5px 0',
                    fontSize: '21px',
                    fontWeight: 400,
                    color: '#496d8e',
                    minHeight: '50px',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        backgroundColor: 'rgba(39, 170, 225, 0.05)',
                        color: '#27aae1',
                    },
                    '&.RaMenuItemLink-active': {
                        borderLeft: '3px solid transparent',
                        backgroundColor: '#e3f2fd',
                        color: '#27aae1',
                        boxShadow: '1px 2px 6px rgba(20, 61, 102, 0.19)',
                    },
                    '& .MuiListItemIcon-root': {
                        color: 'inherit',
                        minWidth: '40px',
                    },
                },
            },
        },

        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundColor: '#ffffff',
                    borderRadius: '20px',
                    boxShadow: '1px 3px 8px rgba(10, 39, 63, 0.15)',
                    border: '1px solid #e0e0e3',
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundColor: '#ffffff',
                    borderRadius: '20px',
                    boxShadow: '1px 3px 8px rgba(10, 39, 63, 0.15)',
                    border: '1px solid #e0e0e3',
                    overflow: 'hidden',
                },
            },
        },
        MuiCardContent: {
            styleOverrides: {
                root: {
                    padding: '30px 40px',
                    '&:last-child': { paddingBottom: '30px' },
                },
            },
        },

        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    padding: '12px 30px',
                    minHeight: '40px',
                    boxShadow: '1px 3px 8px rgba(10, 39, 63, 0.15)',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '2px 4px 12px rgba(10, 39, 63, 0.2)',
                    },
                },
                containedPrimary: {
                    backgroundColor: '#27aae1',
                    color: '#ffffff',
                    '&:hover': { backgroundColor: '#1e9dd0' },
                },
            },
        },

        MuiTextField: {
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        backgroundColor: '#f5f5f7',
                        borderRadius: '8px',
                        minHeight: '50px',
                        '& fieldset': { borderColor: '#e0e0e3' },
                        '&:hover fieldset': { borderColor: '#27aae1' },
                        '&.Mui-focused fieldset': {
                            borderColor: '#27aae1',
                            boxShadow: '0 0 0 3px rgba(39, 170, 225, 0.1)',
                        },
                    },
                    '& .MuiInputLabel-root': {
                        fontSize: '12px',
                        fontWeight: 300,
                        color: '#496d8e',
                    },
                },
            },
        },

        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: '4px',
                    fontWeight: 700,
                    fontSize: '12px',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.75px',
                    padding: '6px 12px',
                    minHeight: '24px',
                },
                colorSuccess: { backgroundColor: '#66dd74', color: '#0a273f' },
                colorWarning: { backgroundColor: '#fce354', color: '#0a273f' },
                colorError: { backgroundColor: '#f809e0', color: '#ffffff' },
                colorInfo: { backgroundColor: '#27aae1', color: '#ffffff' },
            },
        },

        MuiDivider: {
            styleOverrides: {
                root: { borderColor: 'rgba(0, 0, 0, 0.08)' },
            },
        },

        MuiList: {
            styleOverrides: {
                root: { padding: '30px 25px' },
            },
        },
    },
};

export const softTheme = {
    name: 'soft',
    light: softLightTheme,
    dark: softDarkTheme,
};
