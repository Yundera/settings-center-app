import React from "react";
import {Route} from "react-router-dom";
import type {TranslationMessages} from "react-admin";
import type {PanelInterface} from "./PanelInterface";

export interface PanelSpec {
    name: string;
    component: React.ComponentType;
    icon: any;
    label: string;
    permissions?: string;
    i18n?: Record<string, TranslationMessages>;
}

export function definePanel(spec: PanelSpec): PanelInterface {
    const defaultI18n: Record<string, TranslationMessages> = {
        en: {name: `${spec.label} |||| ${spec.label}`} as unknown as TranslationMessages,
    };
    return {
        name: spec.name,
        icon: spec.icon,
        permissions: spec.permissions,
        resource: {name: spec.name},
        i18n: spec.i18n ?? defaultI18n,
        route: {
            routes: [
                React.createElement(Route, {
                    key: spec.name,
                    path: "/" + spec.name,
                    element: React.createElement(spec.component),
                }),
            ],
        },
    };
}
