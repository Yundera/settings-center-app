import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Stack,
    Switch,
    Typography,
} from '@mui/material';
import {useNotify} from 'react-admin';
import {apiRequest} from '@/core/authApi';
import {card, colors, font, spacing, text, title} from '@/app/pages/softTheme';
import {useBrand} from '@/core/configuration/brandContext';

/**
 * What the operator runs for you, and how to turn it off.
 *
 * A PCS is not purely self-hosted: the domain, the mail relay, an SSH key
 * support uses, the login provider and the update channel are all things
 * Yundera runs on the owner's behalf. This page is the one place that says so,
 * and the one place to opt out of the parts that can be opted out of.
 *
 * SEVEN ROWS, THREE SWITCHES. The other four are described but not offered —
 * they are blocked on architecture that does not exist yet (see template-root's
 * doc/onboarding-options.md). They are here rather than omitted because the
 * question this page answers is "what does Yundera do for me and what does it
 * cost", which a shorter list answers dishonestly. They render without a switch
 * rather than with a disabled one: a greyed-out switch reads as broken, while a
 * row that plainly says "not yet optional" reads as true.
 *
 * The switches are backed by scripts/tools/feature-*.sh on the host via
 * /api/admin/features. The lockout guards are enforced there too — what this
 * component adds is the reason, shown before the click rather than after it.
 */

type LiveFeatureId = 'yundera-login' | 'support-key' | 'platform-updates';

interface FeatureState {
    id: LiveFeatureId;
    enabled: boolean | null;
    error?: string;
}

interface FeatureDescriptor {
    id: string;
    /** Does a switch exist for this, or is the row explanatory only? */
    live: boolean;
    title: string;
    /** What the operator does for you. */
    what: React.ReactNode;
    /** What turning it off costs you — or why it cannot be turned off yet. */
    cost: React.ReactNode;
    /** Confirmation copy, for the two switches that can lock someone out. */
    confirm?: {question: string; warning: React.ReactNode};
}

function describeFeatures(operator: string): FeatureDescriptor[] {
    return [
        {
            id: 'yundera-login',
            live: true,
            title: `${operator} Login`,
            what: (
                <>
                    Sign in to this server with your {operator} account. {operator}&apos;s identity
                    provider decides who reaches your PCS, and the same account works across every
                    app installed here.
                </>
            ),
            cost: (
                <>
                    Turned off, only accounts held on this box can sign in, and recovering a
                    forgotten password is yours to do — {operator} cannot let you back in.
                </>
            ),
            confirm: {
                question: `Turn off ${operator} Login?`,
                warning: (
                    <>
                        Everyone currently signing in with their {operator} account will lose access
                        immediately. Make sure you know a local account&apos;s password first.
                    </>
                ),
            },
        },
        {
            id: 'support-key',
            live: true,
            title: `${operator} support key`,
            what: (
                <>
                    {operator} support can open an SSH session on this server to fix what breaks
                    inside it. The key is re-asserted on every nightly self-check, so it is not
                    silently lost to a manual key edit or an image refresh.
                </>
            ),
            cost: (
                <>
                    Turned off, the key is removed now and does not come back — and the in-PCS
                    support options stop working, because there is no longer anything for support to
                    act on.
                </>
            ),
            confirm: {
                question: 'Remove the support key?',
                warning: (
                    <>
                        The key is removed from this server immediately. If you later need help with
                        something you cannot reach — a broken login, a stack that will not start —
                        nobody will be able to get in and look.
                    </>
                ),
            },
        },
        {
            id: 'platform-updates',
            live: true,
            title: 'Automatic platform updates',
            what: (
                <>
                    {operator} ships updates to the platform itself: the stack that runs your apps,
                    this dashboard, and the container images they use — every image version is
                    pinned inside the platform release, so this one switch covers both.
                </>
            ),
            cost: (
                <>
                    Turned off, this server stays on the code it has today and{' '}
                    <strong>security fixes stop arriving</strong>. Nothing else changes — your apps
                    keep running. A server left frozen for months replays a long chain of migrations
                    when you turn updates back on.
                </>
            ),
        },
        {
            id: 'nsl-domain',
            live: false,
            title: 'Free domain (nsl.sh)',
            what: (
                <>
                    Your server&apos;s public address and its certificate. Every app you install is
                    published under it, and it is what makes this box reachable from outside your
                    network at all.
                </>
            ),
            cost: (
                <>
                    Not yet optional. The domain is wired into the login stack — the sign-in pages
                    and the app gate both refuse to render without one — and there is no way yet to
                    supply your own instead.
                </>
            ),
        },
        {
            id: 'mail',
            live: false,
            title: 'Mail sending',
            what: (
                <>
                    Password resets — this server&apos;s own, and those of apps that mail their
                    users, such as Vaultwarden — are relayed through {operator}&apos;s mail gateway.
                </>
            ),
            cost: (
                <>
                    Not yet optional, and today it comes with the domain rather than separately.
                    There is no way yet to point it at your own SMTP server.
                </>
            ),
        },
        {
            id: 'sslip',
            live: false,
            title: 'sslip.io / nip.io access',
            what: (
                <>
                    A second way to reach your apps, on a hostname derived from this server&apos;s IP
                    address, with a Let&apos;s Encrypt certificate rather than the gateway&apos;s.
                    Useful when the main domain is unreachable.
                </>
            ),
            cost: (
                <>
                    Not yet optional. Most installed apps still carry this address in their own
                    configuration rather than taking it from the server, so there is nothing yet for
                    a single switch to turn off.
                </>
            ),
        },
        {
            id: 'app-updates',
            live: false,
            title: 'Automatic app updates',
            what: <>Keeping the apps you installed up to date without being asked.</>,
            cost: (
                <>
                    Not built yet. Apps update when you ask them to and never on their own, so there
                    is nothing to opt out of.
                </>
            ),
        },
    ];
}

const SectionLabel: React.FC<{children: React.ReactNode; hint: string}> = ({children, hint}) => (
    <Box sx={{width: '100%'}}>
        <Typography sx={{...title.small, mb: 0.5}}>{children}</Typography>
        <Typography sx={text.detail}>{hint}</Typography>
    </Box>
);

export const FeaturesPanel: React.FC = () => {
    const notify = useNotify();
    const {brand, support} = useBrand();
    // App.tsx registers this panel only when a configured operator exists, so
    // the fallback only matters if the route is hit directly.
    const operator = support.operatorName ?? brand.name;
    const descriptors = useMemo(() => describeFeatures(operator), [operator]);

    const [states, setStates] = useState<Record<string, FeatureState> | null>(null);
    const [claimed, setClaimed] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toggling, setToggling] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<FeatureDescriptor | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiRequest<{features: FeatureState[]}>('/api/admin/features');
            setStates(Object.fromEntries(res.features.map(f => [f.id, f])));
            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Failed to load feature status');
        } finally {
            setLoading(false);
        }
        // Only used to explain a disabled switch — a failure here must not
        // break the page, so it is deliberately not part of the try above.
        try {
            const status = await apiRequest<{claimed: boolean}>('/api/admin/onboarding-status');
            setClaimed(status.claimed);
        } catch {
            setClaimed(null);
        }
    }, []);

    useEffect(() => {
        void fetchAll();
    }, [fetchAll]);

    /**
     * Mirrors guardDisable() in /api/admin/features. Duplicated on purpose: the
     * route is what enforces it, this is what explains it before the click.
     */
    const blockedReason = useCallback(
        (id: string): string | null => {
            if (claimed !== false) return null;
            if (id === 'yundera-login') {
                return `This server has no local account yet, so ${operator} Login is the only way to sign in. Create one from the Account page first.`;
            }
            if (id === 'support-key' && states?.['yundera-login']?.enabled === false) {
                return `This server has no local account and ${operator} Login is already off, so the support key is the only remaining way in.`;
            }
            return null;
        },
        [claimed, states, operator],
    );

    const applyToggle = useCallback(
        async (descriptor: FeatureDescriptor, next: boolean) => {
            setToggling(descriptor.id);
            try {
                const state = await apiRequest<FeatureState>('/api/admin/features', 'POST', {
                    id: descriptor.id,
                    enabled: next,
                });
                setStates(prev => ({...(prev || {}), [state.id]: state}));
                setError(null);
                notify(`${descriptor.title} ${next ? 'enabled' : 'disabled'}`, {type: 'success'});
            } catch (err: any) {
                setError(err?.message || `Failed to update ${descriptor.title}`);
            } finally {
                setToggling(null);
            }
        },
        [notify],
    );

    const handleToggle = (descriptor: FeatureDescriptor, next: boolean) => {
        // Only turning something OFF is ever destructive.
        if (!next && descriptor.confirm) {
            setConfirming(descriptor);
            return;
        }
        void applyToggle(descriptor, next);
    };

    const live = descriptors.filter(d => d.live);
    const described = descriptors.filter(d => !d.live);

    const renderCard = (descriptor: FeatureDescriptor) => {
        const state = states?.[descriptor.id];
        const blocked = descriptor.live ? blockedReason(descriptor.id) : null;
        const busy = toggling === descriptor.id;

        return (
            <Card key={descriptor.id} sx={card.root}>
                <Box
                    sx={{
                        ...card.header,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 2,
                    }}
                >
                    <Typography sx={title.small}>{descriptor.title}</Typography>
                    {descriptor.live ? (
                        <Stack direction="row" alignItems="center" spacing={1}>
                            {(loading || busy) && <CircularProgress size={16} />}
                            <Switch
                                checked={state?.enabled === true}
                                onChange={(_, v) => handleToggle(descriptor, v)}
                                disabled={loading || busy || !state || state.enabled === null || !!blocked}
                            />
                        </Stack>
                    ) : (
                        <Chip
                            label="not yet optional"
                            size="small"
                            variant="outlined"
                            sx={{fontSize: font.caption, color: colors.textMuted, borderColor: colors.borderMuted}}
                        />
                    )}
                </Box>
                <CardContent sx={card.content}>
                    <Typography sx={{...text.detail, mb: 1.5}}>{descriptor.what}</Typography>
                    <Typography sx={text.detail}>{descriptor.cost}</Typography>
                    {state?.error && (
                        <Alert severity="warning" sx={{mt: 2}}>
                            Could not read this setting on the host: {state.error}
                        </Alert>
                    )}
                    {blocked && (
                        <Alert severity="info" sx={{mt: 2}}>
                            {blocked}
                        </Alert>
                    )}
                </CardContent>
            </Card>
        );
    };

    return (
        <Box
            sx={{
                paddingTop: spacing.pageY,
                paddingBottom: spacing.pageY,
                paddingX: spacing.pageX,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
            }}
        >
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
                {operator} Features
            </Typography>

            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: spacing.cardGap,
                    maxWidth: '800px',
                    width: '100%',
                }}
            >
                <Typography sx={{...text.bodyMuted, textAlign: 'center'}}>
                    This is a self-hosted server, but not everything on it runs here. These are the
                    parts {operator} runs for you — what each one gives you, and what turning it off
                    costs. Your apps and your data are unaffected either way.
                </Typography>

                {error && <Alert severity="error">{error}</Alert>}

                <SectionLabel hint="Reversible at any time, from this page.">
                    You can turn these off
                </SectionLabel>
                {live.map(renderCard)}

                <SectionLabel hint="Described here so the list is complete. Nothing to switch yet.">
                    Not optional yet
                </SectionLabel>
                {described.map(renderCard)}
            </Box>

            <Dialog open={!!confirming} onClose={() => setConfirming(null)} maxWidth="sm" fullWidth>
                <DialogTitle>{confirming?.confirm?.question}</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{mb: 2}}>
                        {confirming?.confirm?.warning}
                    </Alert>
                    <DialogContentText>
                        You can turn this back on from this page at any time.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirming(null)} disabled={!!toggling}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => {
                            const target = confirming;
                            setConfirming(null);
                            if (target) void applyToggle(target, false);
                        }}
                        disabled={!!toggling}
                        color="error"
                        variant="contained"
                    >
                        Turn off
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
