import type {RaThemeOptions} from 'react-admin';

export interface Theme {
    name: string;
    light: RaThemeOptions;
    dark?: RaThemeOptions;
}
