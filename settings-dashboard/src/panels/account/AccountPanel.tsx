import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {Button} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import React from "react";
import {button, colors, font, spacing} from '@/app/pages/softTheme';
import {useBrand} from '@/core/configuration/brandContext';
import type {BrandPayload} from '@/brand/BrandTypes';

// An identity provider this PCS can authenticate against, plus a link to the
// dashboard where the user manages that identity (credentials, profile, etc.).
//
// Under the Dex broker model the SSO provider itself has no end-user account UI
// — self-service lives wherever the credential actually does. So this panel
// links out to each provider's own dashboard rather than to "the IdP".
interface IdentityProvider {
    name: string;
    label: string;
    description: string;
    dashboardUrl: string;
}

// Derive a sibling service host from the current admin hostname by swapping the
// `admin-` prefix. The admin / casaos / auth containers are routed at parallel
// `admin-${DOMAIN}` / `casaos-${DOMAIN}` labels (and nip.io / sslip.io
// variants), so prefix-swap is correct for every deployment shape without
// depending on the (possibly-empty) APP_CONFIG payload.
const siblingHostUrl = (prefix: string): string | null => {
    if (typeof window === "undefined") return null;
    const host = window.location.host;
    if (!host.startsWith("admin-")) return null;
    return `https://${prefix}-${host.slice("admin-".length)}/`;
};

const identityProviders = (brand: BrandPayload): IdentityProvider[] => {
    const providers: IdentityProvider[] = [];

    // CasaOS — the credential store for the PCS user identity. Account
    // management (password, profile) happens in the CasaOS dashboard.
    const casaUrl = siblingHostUrl("casaos");
    if (casaUrl) {
        providers.push({
            name: "casaos",
            label: "CasaOS",
            description:
                "Your PCS account lives in CasaOS. Change your password and manage your profile from the CasaOS dashboard.",
            dashboardUrl: casaUrl,
        });
    }

    // The operator's own cloud identity, when it has a self-service surface.
    // Driven by the optional `operator.accountUrl` in brand.json, which the
    // default deliberately omits — wiring this to the operator's dashboard
    // would materialise a card that has never rendered.
    //
    // Replaces a read of APP_CONFIG.YUNDERA_DASHBOARD_URL that could never
    // fire: the key was never published through FRONTEND_PUBLIC_ENV.
    if (brand.operatorAccount) {
        providers.push({
            name: "operator",
            label: brand.operatorAccount.name,
            description: `Manage your ${brand.operatorAccount.name} cloud identity and sign-in settings.`,
            dashboardUrl: brand.operatorAccount.url,
        });
    }

    return providers;
};

export const AccountPanel = () => {
    const brand = useBrand();
    const providers = identityProviders(brand);

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography
                variant="h2"
                sx={{
                    textAlign: 'center',
                    fontSize: font.titleLarge,
                    fontWeight: 700,
                    color: colors.textWhite,
                    marginBottom: '30px',
                }}
            >
                Account
            </Typography>

            <Typography
                variant="body2"
                sx={{
                    textAlign: 'center',
                    maxWidth: '600px',
                    lineHeight: 1.6,
                    fontSize: font.caption,
                    fontWeight: 400,
                    color: colors.textWhite,
                    marginBottom: '25px',
                }}
            >
                Manage your account on the identity provider that issued it. Each
                provider keeps its own credentials and sign-in settings in its
                dashboard.
            </Typography>

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                width: '100%',
                maxWidth: '600px',
            }}>
                {providers.length === 0 ? (
                    <Typography
                        variant="body2"
                        sx={{textAlign: 'center', color: colors.textWhite, fontSize: font.caption}}
                    >
                        No identity provider dashboard is available for this deployment.
                    </Typography>
                ) : (
                    providers.map((p) => (
                        <Box
                            key={p.name}
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px',
                                padding: '20px',
                                borderRadius: '12px',
                                border: `1px solid ${colors.textWhite}22`,
                                background: `${colors.textWhite}0a`,
                            }}
                        >
                            <Typography sx={{fontSize: font.label, fontWeight: 700, color: colors.textWhite}}>
                                {p.label}
                            </Typography>
                            <Typography sx={{fontSize: font.caption, color: colors.textWhite, lineHeight: 1.5}}>
                                {p.description}
                            </Typography>
                            <Button
                                variant="contained"
                                href={p.dashboardUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                startIcon={<LinkIcon />}
                                sx={{
                                    ...button.primary,
                                    alignSelf: 'flex-start',
                                    '&:hover': {
                                        ...button.primary['&:hover'],
                                        transform: 'translateY(-1px)',
                                    },
                                }}
                            >
                                Open {p.label} dashboard
                            </Button>
                        </Box>
                    ))
                )}
            </Box>
        </Box>
    );
};
