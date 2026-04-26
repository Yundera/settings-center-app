import { routes } from './Routes';
import { resourceName } from './Constant';
import { customEnglishMessages } from './i18n/en';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { PanelInterface } from 'dashboard-core';

export const migrationPanel: PanelInterface = {
    name: resourceName,
    route: {
        routes,
    },
    i18n: {
        en: customEnglishMessages,
    },
    resource: {
        name: resourceName,
    },
    icon: SwapHorizIcon,
};
