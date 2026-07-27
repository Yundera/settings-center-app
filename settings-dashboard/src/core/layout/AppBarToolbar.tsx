import {LocalesMenuButton} from 'react-admin';
import {LoadingIndicator} from "../component/LoadingIndicator";

export const AppBarToolbar = () => (
    <>
        <LoadingIndicator />
        <LocalesMenuButton />
    </>
);
