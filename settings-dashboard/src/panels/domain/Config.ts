import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import LanguageIcon from "@mui/icons-material/Language";
import {PanelInterface} from "dashboard-core";

export const domainPanel: PanelInterface = {
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
    icon: LanguageIcon
};
