import * as React from 'react';
import {useTheme} from '@mui/material/styles';
import CircularProgress from '@mui/material/CircularProgress';
import type {SxProps} from '@mui/material';
import {useLoading} from 'ra-core';

interface LoadingIndicatorProps {
    className?: string;
    sx?: SxProps;
}

/**
 * Spinner shown in the app bar while react-admin has a request in flight.
 *
 * Deliberately not react-admin's own `LoadingIndicator`: that one also renders
 * a permanent RefreshIconButton next to the spinner, which this dashboard does
 * not want.
 */
export const LoadingIndicator = (props: LoadingIndicatorProps) => {
    const { className, sx, ...rest } = props;
    const loading = useLoading();

    const theme = useTheme();
    return (<>
        {loading && (
          <CircularProgress
            className={`app-loader ${LoadingIndicatorClasses.loader}`}
            color="inherit"
            size={theme.spacing(2)}
            thickness={6}
            {...rest}
          />
        )}</>);
};

const PREFIX = 'RaLoadingIndicator';

export const LoadingIndicatorClasses = {
    loader: `${PREFIX}-loader`,
};
