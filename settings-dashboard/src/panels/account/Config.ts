import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import {PanelInterface} from "dashboard-core";

export const accountPanel: PanelInterface = {
    name: resourceName,
    route: {
        routes
    },
    i18n: {
        en: customEnglishMessages,
    },
    resource: {
        name: resourceName
    },
    icon: AccountCircleIcon
};
