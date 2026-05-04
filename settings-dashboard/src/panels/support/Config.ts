import { routes } from "./Routes";
import { resourceName } from "./Constant";
import { customEnglishMessages } from "./i18n/en";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import { PanelInterface } from "dashboard-core";

export const supportPanel: PanelInterface = {
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
    icon: SupportAgentIcon
};
