import type { Slot } from './theme';

export type Visibility = 'private' | 'public';
/** active: 꾸미는 중 · disabled: 신고 누적으로 비활성 · archived: 시즌 종료, 읽기 전용 */
export type RoomStatus = 'active' | 'disabled' | 'archived';

export interface Placement {
  treeId: string;
  slotId: string;
  itemId: string;
  memo: string;
  authorId: string;
  createdAt: number;
}

export interface TreeSnapshot {
  id: string;
  name: string;
  scale: number;
  position: number;
  slots: Slot[];
  /** bandId → stringId */
  bands: Record<string, string>;
}

export interface RoomSnapshot {
  roomId: string;
  title: string;
  seasonId: string;
  themeId: string;
  visibility: Visibility;
  status: RoomStatus;
  joinCode: string;
  trees: TreeSnapshot[];
  placements: Placement[];
  /** guestId → 표시 이름 (장식 작성자 + 방장 + 나) */
  guests: Record<string, string>;
  ownerGuestId: string;
  createdAt: number;
  completedAt: number | null;
  rev: number;
}

export type ReportTarget = 'room' | `placement:${string}:${string}`;

export type C2S =
  | { t: 'hello'; guestToken?: string; ownerKey?: string }
  | { t: 'place'; treeId: string; slotId: string; itemId: string; memo: string }
  | { t: 'remove'; treeId: string; slotId: string }
  | { t: 'setBand'; treeId: string; bandId: string; stringId: string | null }
  | { t: 'setVisibility'; visibility: Visibility }
  | { t: 'setName'; name: string }
  | { t: 'deleteRoom'; confirm: string }
  | { t: 'report'; target: ReportTarget; reason?: string }
  | { t: 'ping' };

export type ErrorCode =
  | 'SLOT_TAKEN' | 'NOT_ALLOWED' | 'INVALID_ITEM' | 'INVALID_SLOT' | 'MEMO_REJECTED' | 'NAME_REJECTED'
  | 'READ_ONLY' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'BAD_REQUEST' | 'NOT_READY' | 'ALREADY_REPORTED';

export type S2C =
  | { t: 'welcome'; me: { guestId: string; isOwner: boolean; name: string }; guestToken?: string; snapshot: RoomSnapshot; rev: number }
  | { t: 'placed'; rev: number; placement: Placement; authorName: string; completedAt: number | null }
  | { t: 'removed'; rev: number; treeId: string; slotId: string }
  | { t: 'bandChanged'; rev: number; treeId: string; bandId: string; stringId: string | null }
  | { t: 'roomChanged'; rev: number; visibility: Visibility; status: RoomStatus }
  | { t: 'guestChanged'; rev: number; guestId: string; name: string }
  | { t: 'reported' }
  | { t: 'roomDeleted'; reason: 'owner' | 'expired' | 'admin' }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; message?: string };

// ---- HTTP ----

export interface CreateRoomRequest { title: string; visibility: Visibility }
export interface CreateRoomResponse { roomId: string; joinCode: string; ownerKey: string }
export interface JoinResponse { roomId: string; joinCode: string; title: string; status: RoomStatus }
export interface ArchiveRoom { roomId: string; title: string; isComplete: boolean }
export interface ArchiveResponse { season: { id: string; subtitle: string; roomNoun: string } | null; rooms: ArchiveRoom[] }
export interface SeasonInfo {
  current: { id: string; subtitle: string; roomNoun: string; defaultTitle: string; startsAt: number; endsAt: number } | null;
  lastEnded: { id: string; subtitle: string; roomNoun: string } | null;
  now: number;
}

export type ApiErrorCode =
  | 'NOT_FOUND' | 'DISABLED' | 'BAD_REQUEST' | 'TITLE_REJECTED' | 'RATE_LIMITED' | 'NOT_ALLOWED'
  | 'NO_SEASON' | 'QUOTA_EXCEEDED' | 'INTERNAL';
export interface ApiError { error: ApiErrorCode; message: string }
