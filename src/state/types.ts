// State schema only: no singleton, transport, persistence or runtime initialization.
import type { Prefs } from './prefs';
import type { PiHealth, PiDialogRequest } from '../agent/pi/backend';
import type { EngineId } from './engines';
import type { CompactionConfig } from './context';
import type { ChatRootState } from './chatReducer';
import type { SidebarList, RecentList } from './sidebar';
import type { AgentInfo, Project, ProviderInfo, Session, SessionStatus, VcsInfo } from '../api/types';

export type ConnectionPhase =
  | "unknown"
  | "connecting"
  | "connected"
  | "disconnected"
  | "incompatible";

export interface ConnectionState {
  phase: ConnectionPhase;
  version: string | null;
  error: string | null;
  streamState:
    | "idle"
    | "connecting"
    | "open"
    | "reconnecting"
    | "closed"
    | "error";
  lastEventAt: number;
  endpoint: string;
}

export interface UiState {
  remoteFolderOpen: boolean;
  hostDialogOpen: boolean;
  workspacePreparing: boolean;
  runtimeLoading: boolean;
  sessionListLoading: boolean;
  sessionListError: string | null;
  historyLoading: boolean;
  historyError: string | null;
  sending: boolean;
  sendError: string | null;
  vcs: VcsInfo | null;
  settingsOpen: boolean;
  browserOpen: boolean;
  contextOpen: boolean;
  revealMessage: { server: string; directory: string | null; sessionID: string; messageID: string } | null;
  paletteOpen: boolean;
  confirmDelete: Session | null;
  handoffSource: Session | null;
  toast: string | null;
  /** Blocking Pi extension dialog awaiting the user. Never auto-answered. */
  piDialog: PiDialogRequest | null;
  /**
   * The user picked a different engine for an existing chat. Engines cannot
   * share a transcript, so this offers the handoff instead of refusing.
   */
  engineSwitch: { session: Session; from: EngineId; to: EngineId } | null;
}

export interface AppState {
  prefs: Prefs;
  connection: ConnectionState;
  projects: Project[];
  directory: string | null;
  sessions: Session[];
  archivedSessions: Session[];
  projectSessionLists: Record<string, SidebarList>;
  recentSessionList: RecentList;
  activeSessionId: string | null;
  statuses: Record<string, SessionStatus>;
  activityStatuses: Record<string, SessionStatus>;
  chat: ChatRootState;
  providers: ProviderInfo[];
  connectedProviderIds: string[];
  providerDefaults: Record<string, string> | null;
  configDefaultAgent: string | null;
  configModel: string | null;
  compaction: CompactionConfig;
  agents: AgentInfo[];
  /** Last Pi probe: install, model catalog, commands. Null until asked for. */
  piHealth: PiHealth | null;
  olderExhausted: Record<string, boolean>;
  historyCursors: Record<string, string | null>;
  ui: UiState;
  rev: number;
}
