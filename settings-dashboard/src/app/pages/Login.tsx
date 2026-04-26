import {useState} from 'react';
import {useLocation} from 'react-router-dom';

import {Avatar, Box, Button, Card, CardActions, CircularProgress, Typography,} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import {Form, required, TextInput, useLogin, useNotify, useTranslate,} from 'react-admin';
import { colors, radius, button } from '@/app/pages/softTheme';

export const Login = () => {
    const [loading, setLoading] = useState(false);
    const translate = useTranslate();

    const notify = useNotify();
    const login = useLogin();
    const location = useLocation();

    const handleSubmit = (auth: FormValues) => {
        setLoading(true);
        login(
            auth,
            location.state ? (location.state as any).nextPathname : '/'
        ).catch((error: Error) => {
            setLoading(false);
            notify(
                typeof error === 'string'
                    ? error
                    : typeof error === 'undefined' || !error.message
                      ? 'ra.auth.sign_in_error'
                      : error.message,
                {
                    type: 'error',
                    messageArgs: {
                        _:
                            typeof error === 'string'
                                ? error
                                : error && error.message
                                  ? error.message
                                  : undefined,
                    },
                }
            );
        });
    };

    return (
        <Form onSubmit={handleSubmit} noValidate>
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: '100vh',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.bgApp,
                }}
            >
              <Card sx={{
                  minWidth: 400,
                  maxWidth: 440,
                  width: '100%',
                  backgroundColor: colors.bgCard,
                  borderRadius: radius.card,
                  border: `1px solid ${colors.borderMuted}`,
                  boxShadow: '0 8px 32px rgba(10, 39, 63, 0.4)',
              }}>
                <Box
                  sx={{
                    margin: '30px 0 10px 0',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <Avatar sx={{ bgcolor: colors.primary, width: 48, height: 48 }}>
                    <LockIcon/>
                  </Avatar>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    px: '30px',
                    mb: '10px',
                  }}
                >
                  <Typography variant="body2" align="center" sx={{ color: colors.textMuted }}>
                    For security reasons, please sign in again with<br />your server login to access the settings.
                  </Typography>
                </Box>
                <Box sx={{ padding: '0 30px 20px 30px' }}>
                  <Box sx={{ marginTop: '16px' }}>
                    <TextInput
                      autoFocus
                      source="username"
                      label={translate('ra.auth.username')}
                      disabled={loading}
                      validate={required()}
                      fullWidth
                    />
                  </Box>
                  <Box sx={{ marginTop: '8px' }}>
                    <TextInput
                      source="password"
                      label={translate('ra.auth.password')}
                      type="password"
                      disabled={loading}
                      validate={required()}
                      fullWidth
                    />
                  </Box>
                </Box>
                <CardActions sx={{ padding: '0 30px 30px 30px' }}>
                  <Button
                    variant="contained"
                    type="submit"
                    disabled={loading}
                    fullWidth
                    sx={button.primary}
                  >
                    {loading && (
                      <CircularProgress size={25} thickness={2} sx={{ color: colors.textWhite, mr: 1 }}/>
                    )}
                    {translate('ra.auth.sign_in')}
                  </Button>
                </CardActions>
              </Card>
            </Box>
        </Form>
    );
};

interface FormValues {
    username?: string;
    password?: string;
}
