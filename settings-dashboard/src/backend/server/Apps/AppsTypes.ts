// Types for the Apps panel: reconcile /DATA/AppData/casaos/apps/<name>/
// (CasaOS-managed install dirs) with /DATA/AppData/<name>/ (data folders),
// /DATA/AppData/<name>_YYYYMMDD_HHMMSS.zip (backups), running containers,
// and stray files / empty folders that shouldn't be there.

export type AppState =
    | 'live'              // installed + running
    | 'down'              // installed + not running
    | 'backup-only'       // backup zip(s) exist, no install and no data folder
    | 'backup-and-data'   // backup zip(s) + orphan data folder, no install
    | 'orphan-data'       // data folder only, no install and no backups
    | 'broken'            // installed dir exists but compose file missing/invalid
    | 'empty-folder';     // /DATA/AppData/<name>/ is empty and no install/backup

export interface AppBackup {
    filename: string;          // "n8n_20260420_175007.zip"
    timestamp: string;         // "20260420T175007" — sortable string, host time
    size: number;              // bytes
}

export interface AppRow {
    name: string;
    state: AppState;
    installed: boolean;
    running: boolean;
    composePath?: string;      // /DATA/AppData/casaos/apps/<name>/docker-compose.yml
    dataPath?: string;         // /DATA/AppData/<name>
    dataSize?: number;         // bytes (omitted when no data folder)
    backups: AppBackup[];
    error?: string;            // detail for 'broken' / 'empty-folder'
}

export interface IssueRow {
    name: string;              // filename
    kind: 'stray-file';
    path: string;              // /DATA/AppData/<name>
    size: number;
}

export interface AppsListResult {
    apps: AppRow[];
    issues: IssueRow[];
    disk: { total: number; free: number };
    snapshotAt: string;        // ISO timestamp the snapshot was taken
}

export type AppAction =
    | 'up'
    | 'down'
    | 'down-and-backup'
    | 'backup'
    | 'restore'
    | 'restore-and-up'
    | 'uninstall'
    | 'delete-backup'
    | 'delete-data'
    | 'delete-stray';

export interface AppActionRequest {
    app: string;               // app name OR (for delete-stray) the stray file/dir name
    action: AppAction;
    backup?: string;           // backup filename for restore / delete-backup
    alsoDeleteData?: boolean;  // for 'uninstall' — also remove /DATA/AppData/<app>
}

export interface AppActionState {
    app: string;
    action: AppAction;
    state: 'running' | 'done' | 'failed';
    startedAt: string;
    finishedAt?: string;
    output: string;
    error?: string;
}
