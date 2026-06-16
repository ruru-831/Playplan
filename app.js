import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "game-friend-calendar-events";
const SYNC_META_KEY = "game-friend-calendar-sync-meta";
const SHARED_SYNC_META_KEY = "__shared";
const HOUR_HEIGHT = 56;
const DEFAULT_REMINDER_MINUTES = 5;
const PERSONAL_CALENDAR_ID = "personal";
const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const state = {
  localEvents: [],
  remoteEvents: [],
  events: [],
  sharedCalendars: [],
  activeCalendar: { type: "personal", id: PERSONAL_CALENDAR_ID, name: "個人カレンダー" },
  activeMemberRole: "owner",
  pendingInviteCode: new URLSearchParams(window.location.search).get("invite") || "",
  currentDate: new Date(),
  lastDateKey: toDateKey(new Date()),
  view: "month",
  notifiedKeys: new Set(),
  syncMeta: loadSyncMeta(),
  user: null,
  authReady: false,
  firebaseReady: false,
  remoteLoaded: false,
  syncError: "",
  deletionPromptInProgress: false,
  auth: null,
  db: null,
  unsubscribeEvents: null,
  unsubscribeMemberships: null
};

const els = {
  calendarSection: document.querySelector(".calendar-section"),
  sidePanel: document.querySelector(".side-panel"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  monthViewBtn: document.querySelector("#monthViewBtn"),
  weekViewBtn: document.querySelector("#weekViewBtn"),
  periodTitle: document.querySelector("#periodTitle"),
  calendarRoot: document.querySelector("#calendarRoot"),
  todayList: document.querySelector("#todayList"),
  searchDate: document.querySelector("#searchDate"),
  searchBtn: document.querySelector("#searchBtn"),
  searchResult: document.querySelector("#searchResult"),
  reminderMinutes: document.querySelector("#reminderMinutes"),
  notificationBtn: document.querySelector("#notificationBtn"),
  newEventBtn: document.querySelector("#newEventBtn"),
  eventDialog: document.querySelector("#eventDialog"),
  eventForm: document.querySelector("#eventForm"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
  dialogTitle: document.querySelector("#dialogTitle"),
  eventId: document.querySelector("#eventId"),
  eventDate: document.querySelector("#eventDate"),
  eventType: document.querySelector("#eventType"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  friendName: document.querySelector("#friendName"),
  memo: document.querySelector("#memo"),
  deleteEventBtn: document.querySelector("#deleteEventBtn"),
  syncDeleteDialog: document.querySelector("#syncDeleteDialog"),
  syncDeleteEventTitle: document.querySelector("#syncDeleteEventTitle"),
  syncDeleteEventDate: document.querySelector("#syncDeleteEventDate"),
  syncDeleteEventMemo: document.querySelector("#syncDeleteEventMemo"),
  syncDeleteCancelBtn: document.querySelector("#syncDeleteCancelBtn"),
  syncDeleteConfirmBtn: document.querySelector("#syncDeleteConfirmBtn"),
  authStatus: document.querySelector("#authStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  modeMessage: document.querySelector("#modeMessage"),
  googleLoginBtn: document.querySelector("#googleLoginBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  migrateBtn: document.querySelector("#migrateBtn"),
  menuBtn: document.querySelector("#menuBtn"),
  closeMenuBtn: document.querySelector("#closeMenuBtn"),
  menuOverlay: document.querySelector("#menuOverlay"),
  calendarMenu: document.querySelector("#calendarMenu"),
  personalCalendarBtn: document.querySelector("#personalCalendarBtn"),
  sharedCalendarList: document.querySelector("#sharedCalendarList"),
  createSharedCalendarBtn: document.querySelector("#createSharedCalendarBtn"),
  copyInviteLinkBtn: document.querySelector("#copyInviteLinkBtn"),
  sharedCalendarDialog: document.querySelector("#sharedCalendarDialog"),
  sharedCalendarForm: document.querySelector("#sharedCalendarForm"),
  sharedCalendarName: document.querySelector("#sharedCalendarName"),
  cancelSharedCalendarBtn: document.querySelector("#cancelSharedCalendarBtn")
};

const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

init();

async function init() {
  loadLocalEvents();
  bindEvents();
  setDefaultDates();
  reconcileVisibleEvents();
  render();
  syncSidePanelHeight();
  window.addEventListener("resize", syncSidePanelHeight);
  new ResizeObserver(syncSidePanelHeight).observe(els.calendarSection);
  setInterval(updateCurrentTimeLine, 60000);
  setInterval(checkDateChange, 60000);
  setInterval(renderToday, 60000);
  setInterval(checkReminders, 30000);
  await setupFirebase();
}

function bindEvents() {
  els.prevBtn.addEventListener("click", () => movePeriod(-1));
  els.nextBtn.addEventListener("click", () => movePeriod(1));
  els.monthViewBtn.addEventListener("click", () => setView("month"));
  els.weekViewBtn.addEventListener("click", () => setView("week"));
  els.newEventBtn.addEventListener("click", () => openEventDialog(toDateKey(new Date())));
  els.closeDialogBtn.addEventListener("click", () => els.eventDialog.close());
  els.eventForm.addEventListener("submit", handleSaveEvent);
  els.deleteEventBtn.addEventListener("click", handleDeleteEvent);
  els.searchBtn.addEventListener("click", renderSearch);
  els.searchDate.addEventListener("change", renderSearch);
  els.notificationBtn.addEventListener("click", requestNotificationPermission);
  els.googleLoginBtn.addEventListener("click", handleGoogleLogin);
  els.logoutBtn.addEventListener("click", handleLogout);
  els.migrateBtn.addEventListener("click", handleMigrateToFirebase);
  els.menuBtn.addEventListener("click", openMenu);
  els.closeMenuBtn.addEventListener("click", closeMenu);
  els.menuOverlay.addEventListener("click", closeMenu);
  els.personalCalendarBtn.addEventListener("click", () => switchActiveCalendar({ type: "personal" }));
  els.createSharedCalendarBtn.addEventListener("click", openSharedCalendarDialog);
  els.cancelSharedCalendarBtn.addEventListener("click", () => els.sharedCalendarDialog.close());
  els.sharedCalendarForm.addEventListener("submit", handleCreateSharedCalendar);
  els.copyInviteLinkBtn.addEventListener("click", handleCopyInviteLink);
}

function setDefaultDates() {
  const today = toDateKey(new Date());
  els.eventDate.value = today;
}

function openMenu() {
  els.calendarMenu.classList.remove("hidden");
  els.menuOverlay.classList.remove("hidden");
}

function closeMenu() {
  els.calendarMenu.classList.add("hidden");
  els.menuOverlay.classList.add("hidden");
}

function isPersonalCalendar() {
  return state.activeCalendar.type === "personal";
}

function isSharedCalendar() {
  return state.activeCalendar.type === "shared";
}

function canEditActiveCalendar() {
  if (isPersonalCalendar()) return true;
  return ["owner", "editor"].includes(state.activeMemberRole);
}

function getEventTypeClass(eventItem) {
  return eventItem?.event_type === "other" ? "event-other" : "event-game";
}

function openSharedCalendarDialog() {
  if (!state.user || !state.firebaseReady) {
    alert("共有カレンダーを作成するにはGoogleログインが必要です。");
    return;
  }

  els.sharedCalendarName.value = "";
  els.sharedCalendarDialog.showModal();
}

function generateInviteCode(length = 12) {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => INVITE_CODE_CHARS[value % INVITE_CODE_CHARS.length]).join("");
}

function buildInviteLink(inviteCode) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", inviteCode);
  return url.toString();
}

function loadLocalEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    state.localEvents = Array.isArray(parsed) ? parsed.map(normalizeEvent).filter(Boolean).sort(sortEvents) : [];
  } catch (_error) {
    state.localEvents = [];
  }
}

function persistLocalEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.localEvents));
  state.notifiedKeys.clear();
}

function loadSyncMeta() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function persistSyncMeta() {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(state.syncMeta));
}

function getSharedSyncMeta() {
  const shared = state.syncMeta[SHARED_SYNC_META_KEY];
  if (shared && typeof shared === "object" && !Array.isArray(shared)) {
    return {
      lastActiveUid: typeof shared.lastActiveUid === "string" ? shared.lastActiveUid : "",
      eventOwners:
        shared.eventOwners && typeof shared.eventOwners === "object" && !Array.isArray(shared.eventOwners)
          ? shared.eventOwners
          : {},
      deletedEventRequests:
        shared.deletedEventRequests &&
        typeof shared.deletedEventRequests === "object" &&
        !Array.isArray(shared.deletedEventRequests)
          ? shared.deletedEventRequests
          : {}
    };
  }

  return { lastActiveUid: "", eventOwners: {}, deletedEventRequests: {} };
}

function setSharedSyncMeta(nextShared) {
  state.syncMeta[SHARED_SYNC_META_KEY] = nextShared;
  persistSyncMeta();
}

function getUserMeta(uid = state.user?.uid) {
  if (!uid) return { migrationCompleted: false, pendingLocalIds: [] };
  return state.syncMeta[uid] || { migrationCompleted: false, pendingLocalIds: [] };
}

function ensureUserMeta(uid) {
  if (!uid) return;

  const current = state.syncMeta[uid] || {};
  state.syncMeta[uid] = {
    migrationCompleted: Boolean(current.migrationCompleted),
    pendingLocalIds: Array.isArray(current.pendingLocalIds) ? current.pendingLocalIds : []
  };
  persistSyncMeta();
}

function setMigrationCompleted(uid) {
  if (!uid) return;
  state.syncMeta[uid] = {
    ...(state.syncMeta[uid] || {}),
    migrationCompleted: true,
    pendingLocalIds: []
  };
  persistSyncMeta();
}

function getPendingLocalIds(uid = state.user?.uid) {
  return getUserMeta(uid).pendingLocalIds || [];
}

function isPendingLocalEventId(eventId) {
  return getPendingLocalIds().includes(eventId);
}

function getEventOwner(eventId) {
  return getSharedSyncMeta().eventOwners[eventId] || null;
}

function getLastActiveUid() {
  return getSharedSyncMeta().lastActiveUid || "";
}

function setLastActiveUid(uid) {
  const shared = getSharedSyncMeta();
  setSharedSyncMeta({
    ...shared,
    lastActiveUid: uid || ""
  });
}

function setEventOwners(uid, eventIds) {
  if (!uid || !eventIds.length) return;

  const shared = getSharedSyncMeta();
  const nextOwners = { ...shared.eventOwners };
  eventIds.forEach((eventId) => {
    nextOwners[eventId] = uid;
  });
  setSharedSyncMeta({
    ...shared,
    eventOwners: nextOwners
  });
}

function removeEventOwner(eventId) {
  const shared = getSharedSyncMeta();
  if (!(eventId in shared.eventOwners)) return;

  const nextOwners = { ...shared.eventOwners };
  delete nextOwners[eventId];
  setSharedSyncMeta({
    ...shared,
    eventOwners: nextOwners
  });
}

function syncLocalEventsWithRemote(uid = state.user?.uid) {
  if (!uid) return;

  const remoteIds = new Set(state.remoteEvents.map((item) => item.id));
  let changed = false;

  state.localEvents = state.localEvents.filter((localItem) => {
    const ownerUid = getEventOwner(localItem.id);
    if (ownerUid !== uid) return true;
    if (remoteIds.has(localItem.id)) return true;

    removePendingLocalId(localItem.id, uid);
    removeEventOwner(localItem.id);
    changed = true;
    return false;
  });

  if (changed) {
    persistLocalEvents();
  }
}

function registerDeletedEventRequest(eventId, ownerUid) {
  if (!eventId || !ownerUid) return;

  const shared = getSharedSyncMeta();
  setSharedSyncMeta({
    ...shared,
    deletedEventRequests: {
      ...shared.deletedEventRequests,
      [eventId]: ownerUid
    }
  });
}

function getDeletedEventRequests(uid = state.user?.uid) {
  const requests = getSharedSyncMeta().deletedEventRequests;
  if (!uid) return {};

  return Object.fromEntries(Object.entries(requests).filter(([, ownerUid]) => ownerUid === uid));
}

function clearDeletedEventRequest(eventId) {
  const shared = getSharedSyncMeta();
  if (!(eventId in shared.deletedEventRequests)) return;

  const nextRequests = { ...shared.deletedEventRequests };
  delete nextRequests[eventId];
  setSharedSyncMeta({
    ...shared,
    deletedEventRequests: nextRequests
  });
}

function refreshPendingLocalIds(uid = state.user?.uid) {
  if (!uid) return;

  const remoteMap = new Map(state.remoteEvents.map((item) => [item.id, item]));
  const pendingLocalIds = state.localEvents
    .filter((localItem) => {
      const ownerUid = getEventOwner(localItem.id);
      if (ownerUid && ownerUid !== uid) return false;

      const remoteItem = remoteMap.get(localItem.id);
      if (!remoteItem) return true;
      return String(localItem.updated_at || "") > String(remoteItem.updated_at || "");
    })
    .map((item) => item.id);

  const current = getUserMeta(uid);
  state.syncMeta[uid] = {
    ...current,
    migrationCompleted: pendingLocalIds.length === 0 ? current.migrationCompleted : false,
    pendingLocalIds
  };
  persistSyncMeta();
}

function removePendingLocalId(eventId, uid = state.user?.uid) {
  if (!uid) return;
  const nextIds = getPendingLocalIds(uid).filter((id) => id !== eventId);
  state.syncMeta[uid] = {
    ...getUserMeta(uid),
    pendingLocalIds: nextIds
  };
  persistSyncMeta();
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.id || "").trim();
  const eventDate = String(raw.event_date || "").trim();
  const friendName = String(raw.friend_name || "").trim();

  if (!id || !eventDate || !friendName) return null;

  const startTime = normalizeTime(raw.start_time);
  const endTime = normalizeTime(raw.end_time);
  const reminder = sanitizeReminder(raw.reminder_minutes);
  const createdAt = String(raw.created_at || new Date().toISOString());
  const updatedAt = String(raw.updated_at || createdAt);
  const eventType = raw.event_type === "other" ? "other" : "game";

  return {
    id,
    event_date: eventDate,
    event_type: eventType,
    start_time: startTime || null,
    end_time: endTime || null,
    friend_name: friendName.slice(0, 80),
    memo: String(raw.memo || "").slice(0, 500),
    reminder_minutes: reminder,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

function sanitizeReminder(value) {
  const allowed = [0, 5, 10, 30, 60];
  const numeric = Number(value);
  return allowed.includes(numeric) ? numeric : DEFAULT_REMINDER_MINUTES;
}

function upsertLocalEvent(nextEvent) {
  const index = state.localEvents.findIndex((item) => item.id === nextEvent.id);
  if (index >= 0) {
    state.localEvents[index] = nextEvent;
  } else {
    state.localEvents.push(nextEvent);
  }
  state.localEvents.sort(sortEvents);
  persistLocalEvents();
}

function removeLocalEvent(id) {
  const ownerUid = getEventOwner(id);
  if (ownerUid && (!state.user || state.user.uid !== ownerUid || !state.firebaseReady)) {
    registerDeletedEventRequest(id, ownerUid);
  }

  state.localEvents = state.localEvents.filter((item) => item.id !== id);
  persistLocalEvents();
  removePendingLocalId(id);
  if (!ownerUid || (state.user && state.user.uid === ownerUid && state.firebaseReady)) {
    removeEventOwner(id);
  }
}

function sortEvents(a, b) {
  return (
    a.event_date.localeCompare(b.event_date) ||
    (a.start_time || "").localeCompare(b.start_time || "") ||
    a.friend_name.localeCompare(b.friend_name) ||
    a.id.localeCompare(b.id)
  );
}

function mergeEvents(primaryEvents, secondaryEvents) {
  const merged = new Map();
  secondaryEvents.forEach((item) => merged.set(item.id, item));
  primaryEvents.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values()).sort(sortEvents);
}

function reconcileVisibleEvents() {
  state.events = deriveVisibleEvents();
  state.notifiedKeys.clear();
  renderSyncState();
}

function deriveVisibleEvents() {
  if (isSharedCalendar()) {
    if (!state.user || !state.firebaseReady || !state.remoteLoaded) return [];
    return state.remoteEvents.map((item) => ({ ...item }));
  }

  if (!state.user || !state.firebaseReady) {
    return state.localEvents
      .filter((item) => {
        const ownerUid = getEventOwner(item.id);
        if (!ownerUid) return true;
        return ownerUid === getLastActiveUid();
      })
      .map((item) => ({ ...item }));
  }

  if (hasPendingMigration()) {
    const pendingLocalEvents = state.localEvents.filter((item) => isPendingLocalEventId(item.id));
    return mergeEvents(pendingLocalEvents, state.remoteEvents);
  }

  if (!state.remoteLoaded) {
    return state.localEvents.map((item) => ({ ...item }));
  }

  return state.remoteEvents.map((item) => ({ ...item }));
}

function hasPendingMigration() {
  if (!state.user) return false;
  return getPendingLocalIds().length > 0;
}

function isRemoteEventId(eventId) {
  return state.remoteEvents.some((item) => item.id === eventId);
}

function shouldSyncEvent(nextEvent, previousLocalEvent) {
  if (isSharedCalendar()) {
    return Boolean(state.user && state.firebaseReady && canEditActiveCalendar());
  }

  if (!state.user || !state.firebaseReady) return false;
  if (getUserMeta().migrationCompleted) return true;
  if (!previousLocalEvent) return true;
  if (isPendingLocalEventId(nextEvent.id)) return false;
  return isRemoteEventId(nextEvent.id);
}

function shouldDeleteRemotely(eventId) {
  if (isSharedCalendar()) {
    return Boolean(state.user && state.firebaseReady && canEditActiveCalendar());
  }

  if (!state.user || !state.firebaseReady) return false;
  if (getUserMeta().migrationCompleted) return true;
  return isRemoteEventId(eventId);
}

async function setupFirebase() {
  if (!hasFirebaseConfig(firebaseConfig)) {
    state.authReady = true;
    renderSyncState();
    render();
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    state.firebaseReady = true;

    onAuthStateChanged(state.auth, (user) => {
      if (typeof state.unsubscribeEvents === "function") {
        state.unsubscribeEvents();
      }
      if (typeof state.unsubscribeMemberships === "function") {
        state.unsubscribeMemberships();
      }

      state.user = user;
      state.remoteEvents = [];
      state.remoteLoaded = !user;
      state.syncError = "";
      state.unsubscribeEvents = null;
      state.unsubscribeMemberships = null;
      state.authReady = true;
      state.sharedCalendars = [];
      state.activeMemberRole = isPersonalCalendar() ? "owner" : "";

      if (user) {
        setLastActiveUid(user.uid);
        ensureUserMeta(user.uid);
        subscribeToMemberships(user.uid);
        if (state.pendingInviteCode) {
          acceptInviteCode(state.pendingInviteCode);
        } else {
          subscribeToActiveEvents();
        }
      } else {
        switchActiveCalendar({ type: "personal" }, { keepMenuOpen: true });
      }

      reconcileVisibleEvents();
      render();
    });
  } catch (error) {
    console.error(error);
    state.syncError = "同期の準備に失敗しました。";
    state.authReady = true;
    renderSyncState();
    render();
  }
}

function subscribeToMemberships(uid) {
  const membershipsRef = collection(state.db, "users", uid, "calendarMemberships");
  state.unsubscribeMemberships = onSnapshot(
    membershipsRef,
    (snapshot) => {
      state.sharedCalendars = snapshot.docs
        .map((item) => normalizeMembership({ id: item.id, ...item.data() }))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));

      if (isSharedCalendar()) {
        const active = state.sharedCalendars.find((item) => item.id === state.activeCalendar.id);
        if (active) {
          state.activeCalendar = { type: "shared", id: active.id, name: active.name, inviteCode: active.inviteCode || "" };
          state.activeMemberRole = active.role;
        } else {
          switchActiveCalendar({ type: "personal" }, { keepMenuOpen: true });
        }
      }

      renderCalendarMenu();
      renderSyncState();
    },
    (error) => {
      console.error(error);
      state.syncError = "共有カレンダー一覧の読み込みに失敗しました。";
      render();
    }
  );
}

function normalizeMembership(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.calendarId || "").trim();
  const name = String(raw.name || "").trim();
  const role = String(raw.role || "viewer");
  if (!id || !name || !["owner", "editor", "viewer"].includes(role)) return null;
  return {
    id,
    name: name.slice(0, 80),
    role,
    inviteCode: typeof raw.inviteCode === "string" ? raw.inviteCode : "",
    joinedAt: String(raw.joinedAt || "")
  };
}

function subscribeToActiveEvents() {
  if (!state.user || !state.firebaseReady) return;

  if (typeof state.unsubscribeEvents === "function") {
    state.unsubscribeEvents();
  }

  state.remoteEvents = [];
  state.remoteLoaded = false;
  state.syncError = "";

  if (isSharedCalendar()) {
    subscribeToSharedEvents(state.activeCalendar.id);
    return;
  }

  subscribeToPersonalEvents(state.user.uid);
}

function subscribeToPersonalEvents(uid) {
  const eventsRef = collection(state.db, "users", uid, "events");
  state.unsubscribeEvents = onSnapshot(
    eventsRef,
    (snapshot) => {
      state.remoteEvents = snapshot.docs
        .map((item) => normalizeEvent({ id: item.id, ...item.data() }))
        .filter(Boolean)
        .sort(sortEvents);
      state.remoteLoaded = true;
      state.syncError = "";
      setEventOwners(
        uid,
        state.remoteEvents.map((item) => item.id)
      );
      syncLocalEventsWithRemote(uid);
      refreshPendingLocalIds(uid);

      reconcileVisibleEvents();
      render();
      processDeletedEventRequests(uid);
    },
    (error) => {
      console.error(error);
      state.syncError = "予定の読み込みに失敗しました。";
      state.remoteLoaded = true;
      reconcileVisibleEvents();
      render();
    }
  );
}

function subscribeToSharedEvents(calendarId) {
  const eventsRef = collection(state.db, "sharedCalendars", calendarId, "events");
  state.unsubscribeEvents = onSnapshot(
    eventsRef,
    (snapshot) => {
      state.remoteEvents = snapshot.docs
        .map((item) => normalizeEvent({ id: item.id, ...item.data() }))
        .filter(Boolean)
        .sort(sortEvents);
      state.remoteLoaded = true;
      state.syncError = "";

      reconcileVisibleEvents();
      render();
    },
    (error) => {
      console.error(error);
      state.syncError = "共有カレンダーの予定を読み込めませんでした。";
      state.remoteLoaded = true;
      reconcileVisibleEvents();
      render();
    }
  );
}

async function processDeletedEventRequests(uid = state.user?.uid) {
  if (!uid || state.deletionPromptInProgress || !state.remoteLoaded) return;

  const requests = Object.keys(getDeletedEventRequests(uid));
  if (!requests.length) return;

  state.deletionPromptInProgress = true;

  try {
    for (const eventId of requests) {
      const remoteItem = state.remoteEvents.find((item) => item.id === eventId);
      clearDeletedEventRequest(eventId);

      if (!remoteItem) {
        removeEventOwner(eventId);
        continue;
      }

      const confirmed = await confirmRemoteDeletion(remoteItem);
      if (confirmed) {
        try {
          await deleteRemoteEvent(eventId);
          removeEventOwner(eventId);
        } catch (error) {
          console.error(error);
          registerDeletedEventRequest(eventId, uid);
          state.syncError = "他の端末の予定を削除できませんでした。";
        }
        continue;
      }

      upsertLocalEvent(remoteItem);
      setEventOwners(uid, [eventId]);
    }
  } finally {
    state.deletionPromptInProgress = false;
    refreshPendingLocalIds(uid);
    reconcileVisibleEvents();
    render();
  }
}

function confirmRemoteDeletion(eventItem) {
  return new Promise((resolve) => {
    const cleanup = () => {
      els.syncDeleteConfirmBtn.removeEventListener("click", handleConfirm);
      els.syncDeleteCancelBtn.removeEventListener("click", handleCancel);
      els.syncDeleteDialog.removeEventListener("cancel", handleCancel);
      els.syncDeleteDialog.removeEventListener("close", handleClose);
    };

    const finish = (result) => {
      cleanup();
      if (els.syncDeleteDialog.open) {
        els.syncDeleteDialog.close();
      }
      resolve(result);
    };

    const handleConfirm = () => finish(true);
    const handleCancel = () => finish(false);
    const handleClose = () => finish(false);

    els.syncDeleteEventTitle.textContent = `${formatTimeRange(eventItem)} ${eventItem.friend_name}`;
    els.syncDeleteEventDate.textContent = formatDeletedEventDate(eventItem);
    els.syncDeleteEventMemo.textContent = eventItem.memo || "メモはありません";

    els.syncDeleteConfirmBtn.addEventListener("click", handleConfirm);
    els.syncDeleteCancelBtn.addEventListener("click", handleCancel);
    els.syncDeleteDialog.addEventListener("cancel", handleCancel);
    els.syncDeleteDialog.addEventListener("close", handleClose);
    els.syncDeleteDialog.showModal();
  });
}

function formatDeletedEventDate(eventItem) {
  const date = new Date(`${eventItem.event_date}T00:00:00`);
  return `${formatJapaneseDate(date)} / ${formatTimeRange(eventItem)}`;
}

function hasFirebaseConfig(config) {
  if (!config || typeof config !== "object") return false;
  const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
  return requiredKeys.every((key) => {
    const value = String(config[key] || "").trim();
    return value && !value.startsWith("YOUR_");
  });
}

function switchActiveCalendar(nextCalendar, options = {}) {
  if (nextCalendar.type === "shared") {
    const membership = state.sharedCalendars.find((item) => item.id === nextCalendar.id);
    if (!membership) return;
    state.activeCalendar = {
      type: "shared",
      id: membership.id,
      name: membership.name,
      inviteCode: membership.inviteCode || ""
    };
    state.activeMemberRole = membership.role;
  } else {
    state.activeCalendar = { type: "personal", id: PERSONAL_CALENDAR_ID, name: "個人カレンダー" };
    state.activeMemberRole = "owner";
  }

  state.remoteEvents = [];
  state.remoteLoaded = !state.user;
  state.syncError = "";
  subscribeToActiveEvents();
  reconcileVisibleEvents();
  render();
  renderCalendarMenu();
  if (!options.keepMenuOpen) closeMenu();
}

function renderCalendarMenu() {
  els.personalCalendarBtn.classList.toggle("active", isPersonalCalendar());
  els.sharedCalendarList.replaceChildren();

  if (!state.sharedCalendars.length) {
    els.sharedCalendarList.textContent = state.user ? "共有カレンダーはありません" : "ログイン後に表示されます";
    els.sharedCalendarList.classList.add("empty");
  } else {
    els.sharedCalendarList.classList.remove("empty");
    state.sharedCalendars.forEach((calendar) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.classList.toggle("active", isSharedCalendar() && state.activeCalendar.id === calendar.id);
      button.textContent = calendar.name;
      button.addEventListener("click", () => switchActiveCalendar({ type: "shared", id: calendar.id }));
      els.sharedCalendarList.appendChild(button);
    });
  }

  els.copyInviteLinkBtn.classList.toggle("hidden", !isSharedCalendar());
}

async function handleCreateSharedCalendar(event) {
  event.preventDefault();
  if (!state.user || !state.db) return;

  const name = els.sharedCalendarName.value.trim().slice(0, 80);
  if (!name) return;

  const now = new Date().toISOString();
  const inviteCode = generateInviteCode();
  let createStep = "shared calendar";

  try {
    const calendarRef = await addDoc(collection(state.db, "sharedCalendars"), {
      name,
      ownerUid: state.user.uid,
      inviteCode,
      createdAt: now,
      updatedAt: now
    });

    createStep = "owner member";
    await setDoc(doc(state.db, "sharedCalendars", calendarRef.id, "members", state.user.uid), {
      role: "owner",
      joinedAt: now
    });

    createStep = "membership and invite code";
    await Promise.all([
      setDoc(doc(state.db, "users", state.user.uid, "calendarMemberships", calendarRef.id), {
        role: "owner",
        joinedAt: now,
        name,
        inviteCode
      }),
      setDoc(doc(state.db, "inviteCodes", inviteCode), {
        calendarId: calendarRef.id,
        createdAt: now
      })
    ]);

    els.sharedCalendarDialog.close();
    state.sharedCalendars = [
      ...state.sharedCalendars.filter((item) => item.id !== calendarRef.id),
      { id: calendarRef.id, name, role: "owner", inviteCode, joinedAt: now }
    ];
    switchActiveCalendar({ type: "shared", id: calendarRef.id }, { keepMenuOpen: true });
  } catch (error) {
    console.error(error);
    alert(`共有カレンダーの作成に失敗しました。step=${createStep} code=${error.code || "unknown"}`);
  }
}

async function handleCopyInviteLink() {
  if (!isSharedCalendar()) return;

  let inviteCode = state.activeCalendar.inviteCode;
  if (!inviteCode) {
    const membership = state.sharedCalendars.find((item) => item.id === state.activeCalendar.id);
    inviteCode = membership?.inviteCode || "";
  }

  if (!inviteCode) {
    alert("共有リンクを作成できませんでした。");
    return;
  }

  const link = buildInviteLink(inviteCode);
  try {
    await navigator.clipboard.writeText(link);
    alert("共有リンクをコピーしました。");
  } catch (_error) {
    prompt("共有リンクをコピーしてください。", link);
  }
}

async function acceptInviteCode(inviteCode) {
  if (!state.user || !state.db || !inviteCode) return;

  try {
    const inviteSnapshot = await getDoc(doc(state.db, "inviteCodes", inviteCode));
    if (!inviteSnapshot.exists()) {
      alert("共有リンクが見つかりませんでした。");
      state.pendingInviteCode = "";
      subscribeToActiveEvents();
      return;
    }

    const calendarId = String(inviteSnapshot.data().calendarId || "");
    if (!calendarId) throw new Error("Invite code has no calendarId.");

    const existingMembership = state.sharedCalendars.find((item) => item.id === calendarId);
    if (existingMembership) {
      state.pendingInviteCode = "";
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash || ""}`);
      switchActiveCalendar({ type: "shared", id: calendarId }, { keepMenuOpen: true });
      return;
    }

    const now = new Date().toISOString();
    await setDoc(
      doc(state.db, "sharedCalendars", calendarId, "members", state.user.uid),
      {
        role: "editor",
        joinedAt: now,
        inviteCodeUsed: inviteCode
      },
      { merge: true }
    );

    const calendarSnapshot = await getDoc(doc(state.db, "sharedCalendars", calendarId));
    const calendarData = calendarSnapshot.exists() ? calendarSnapshot.data() : {};
    const name = String(calendarData.name || "共有カレンダー").slice(0, 80);

    await setDoc(
      doc(state.db, "users", state.user.uid, "calendarMemberships", calendarId),
      {
        role: "editor",
        joinedAt: now,
        name,
        inviteCode
      },
      { merge: true }
    );

    state.pendingInviteCode = "";
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash || ""}`);
    state.sharedCalendars = [
      ...state.sharedCalendars.filter((item) => item.id !== calendarId),
      { id: calendarId, name, role: "editor", inviteCode, joinedAt: now }
    ];
    switchActiveCalendar({ type: "shared", id: calendarId }, { keepMenuOpen: true });
    alert(`${name} に参加しました。`);
  } catch (error) {
    console.error(error);
    state.pendingInviteCode = "";
    state.syncError = "共有カレンダーへの参加に失敗しました。";
    subscribeToActiveEvents();
    render();
  }
}

async function handleGoogleLogin() {
  if (!state.firebaseReady || !state.auth) {
    alert("ログインの準備がまだ完了していません。");
    return;
  }

  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(state.auth, provider);
  } catch (error) {
    console.error(error);
    alert("Googleログインに失敗しました。ポップアップの許可設定を確認してください。");
  }
}

async function handleLogout() {
  if (!state.auth) return;

  try {
    await signOut(state.auth);
  } catch (error) {
    console.error(error);
    alert("ログアウトに失敗しました。");
  }
}

async function handleMigrateToFirebase() {
  if (!state.user || !state.db) return;
  if (!state.localEvents.length) {
    alert("同期する予定はありません。");
    return;
  }

  const confirmed = confirm("この端末の予定を、他の端末でも見られるようにします。今の予定はこの端末にも残ります。続けますか？");
  if (!confirmed) return;

  try {
    const writes = state.localEvents.map((eventItem) =>
      setDoc(doc(state.db, "users", state.user.uid, "events", eventItem.id), eventItem, { merge: true })
    );

    await Promise.all(writes);
    setEventOwners(
      state.user.uid,
      state.localEvents.map((item) => item.id)
    );
    setMigrationCompleted(state.user.uid);
    reconcileVisibleEvents();
    render();
    alert("この端末の予定を同期しました。");
  } catch (error) {
    console.error(error);
    alert("予定の同期に失敗しました。");
  }
}

async function writeRemoteEvent(eventItem) {
  if (isSharedCalendar()) {
    await setDoc(doc(state.db, "sharedCalendars", state.activeCalendar.id, "events", eventItem.id), eventItem);
    return;
  }

  await setDoc(doc(state.db, "users", state.user.uid, "events", eventItem.id), eventItem);
  setEventOwners(state.user.uid, [eventItem.id]);
  removePendingLocalId(eventItem.id, state.user.uid);
  clearDeletedEventRequest(eventItem.id);
}

async function deleteRemoteEvent(eventId) {
  if (isSharedCalendar()) {
    await deleteDoc(doc(state.db, "sharedCalendars", state.activeCalendar.id, "events", eventId));
    return;
  }

  await deleteDoc(doc(state.db, "users", state.user.uid, "events", eventId));
}

async function handleSaveEvent(event) {
  event.preventDefault();

  const id = els.eventId.value || crypto.randomUUID();
  const now = new Date().toISOString();
  const previousLocalEvent = state.localEvents.find((item) => item.id === id) || null;
  const previousRemoteEvent = state.remoteEvents.find((item) => item.id === id) || null;
  const previousEvent = previousLocalEvent || previousRemoteEvent;

  const nextEvent = normalizeEvent({
    id,
    event_date: els.eventDate.value,
    start_time: els.startTime.value || null,
    end_time: els.endTime.value || null,
    friend_name: els.friendName.value.trim(),
    memo: els.memo.value.trim(),
    event_type: els.eventType.value === "other" ? "other" : "game",
    reminder_minutes: sanitizeReminder(els.reminderMinutes.value),
    created_at: previousEvent?.created_at || now,
    updated_at: now
  });

  if (!nextEvent) {
    alert("予定データが不正です。入力内容を確認してください。");
    return;
  }

  if (isSharedCalendar() && !canEditActiveCalendar()) {
    alert("This shared calendar is read-only for your account.");
    return;
  }

  if (isPersonalCalendar()) {
    upsertLocalEvent(nextEvent);
  } else {
    state.remoteEvents = mergeEvents([nextEvent], state.remoteEvents);
  }
  reconcileVisibleEvents();
  els.eventDialog.close();
  render();

  if (!shouldSyncEvent(nextEvent, previousLocalEvent)) {
    return;
  }

  try {
    await writeRemoteEvent(nextEvent);
  } catch (error) {
    console.error(error);
    state.syncError = "予定の保存に失敗しました。この端末には保存されています。";
    renderSyncState();
    render();
  }
}

async function handleDeleteEvent() {
  const id = els.eventId.value;
  if (!id || !confirm("この予定を削除しますか？")) return;

  if (isSharedCalendar() && !canEditActiveCalendar()) {
    alert("This shared calendar is read-only for your account.");
    return;
  }

  if (isPersonalCalendar()) {
    removeLocalEvent(id);
  } else {
    state.remoteEvents = state.remoteEvents.filter((item) => item.id !== id);
  }
  reconcileVisibleEvents();
  els.eventDialog.close();
  render();

  if (!shouldDeleteRemotely(id)) {
    return;
  }

  try {
    await deleteRemoteEvent(id);
  } catch (error) {
    console.error(error);
    state.syncError = "予定の削除に失敗しました。この端末では削除されています。";
    renderSyncState();
    render();
  }
}

function renderSyncState() {
  if (!state.firebaseReady) {
    els.authStatus.textContent = state.syncError || "今はこの端末だけで予定を使えます。";
    els.syncStatus.textContent = "この端末にだけ予定が保存されます。";
    els.modeMessage.textContent = "この端末の予定を表示しています。";
    els.googleLoginBtn.classList.remove("hidden");
    els.googleLoginBtn.disabled = true;
    els.logoutBtn.classList.add("hidden");
    els.migrateBtn.classList.add("hidden");
    return;
  }

  els.googleLoginBtn.disabled = false;

  if (!state.authReady) {
    els.authStatus.textContent = "認証状態を確認しています。";
    els.syncStatus.textContent = "しばらくお待ちください。";
    els.modeMessage.textContent = "認証状態を確認しています。";
    els.googleLoginBtn.classList.add("hidden");
    els.logoutBtn.classList.add("hidden");
    els.migrateBtn.classList.add("hidden");
    return;
  }

  if (!state.user) {
    els.authStatus.innerHTML = "Googleでログインすると、<br />PCとスマホで同じ予定を見られます。";
    els.syncStatus.innerHTML = "まだ同期はしていません。<br />この端末だけに予定が保存されています。";
    els.modeMessage.textContent = "この端末の予定を表示しています。";
    els.googleLoginBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
    els.migrateBtn.classList.add("hidden");
    return;
  }

  els.authStatus.textContent = state.user.email || "Googleアカウントでログイン中です。";
  els.googleLoginBtn.classList.add("hidden");
  els.logoutBtn.classList.remove("hidden");

  if (isSharedCalendar()) {
    const roleLabels = {
      owner: "オーナー",
      editor: "編集者",
      viewer: "閲覧のみ"
    };
    const roleLabel = roleLabels[state.activeMemberRole] || "閲覧のみ";
    els.syncStatus.textContent = `共有カレンダー: ${state.activeCalendar.name}（${roleLabel}）`;
    els.modeMessage.textContent = canEditActiveCalendar()
      ? "共有カレンダーの予定を表示しています。"
      : "この共有カレンダーは読み取り専用です。";
    els.migrateBtn.classList.add("hidden");
    return;
  }

  if (state.syncError) {
    els.syncStatus.textContent = state.syncError;
    els.modeMessage.textContent = state.syncError;
  } else if (hasPendingMigration()) {
    els.syncStatus.textContent = "別の端末でも予定を見たい場合は、下の移行ボタンを押してください。";
    els.modeMessage.textContent = "この端末の予定を表示しています。";
  } else if (!state.remoteLoaded) {
    els.syncStatus.textContent = "予定を読み込んでいます。";
    els.modeMessage.textContent = "予定を読み込んでいます。";
  } else {
    els.syncStatus.textContent = "他の端末とも予定を共有できます。";
    els.modeMessage.textContent = "別の端末で変更した予定も反映されます。";
  }

  els.migrateBtn.classList.toggle("hidden", !hasPendingMigration());
}

function setView(view) {
  state.view = view;
  els.monthViewBtn.classList.toggle("active", view === "month");
  els.weekViewBtn.classList.toggle("active", view === "week");
  render();
}

function movePeriod(direction) {
  const next = new Date(state.currentDate);
  if (state.view === "month") {
    next.setMonth(next.getMonth() + direction);
  } else {
    next.setDate(next.getDate() + direction * 7);
  }
  state.currentDate = next;
  render();
}

function render() {
  if (state.view === "month") renderMonth();
  if (state.view === "week") renderWeek();
  renderToday();
  renderSearch();
  renderSyncState();
  renderCalendarMenu();
  syncSidePanelHeight();
}

function checkDateChange() {
  const currentDateKey = toDateKey(new Date());
  if (currentDateKey === state.lastDateKey) return;

  state.lastDateKey = currentDateKey;
  render();
}

function syncSidePanelHeight() {
  if (window.matchMedia("(max-width: 980px)").matches) {
    els.sidePanel.style.height = "";
    return;
  }

  const calendarHeight = els.calendarSection.getBoundingClientRect().height;
  els.sidePanel.style.height = `${calendarHeight}px`;
  requestAnimationFrame(() => {
    const nextCalendarHeight = els.calendarSection.getBoundingClientRect().height;
    els.sidePanel.style.height = `${nextCalendarHeight}px`;
  });
}

function renderMonth() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  els.periodTitle.textContent = `${year}年 ${month + 1}月`;

  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  const wrapper = document.createElement("div");
  wrapper.className = "month-grid";
  addWeekHeaders(wrapper);

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    wrapper.appendChild(createDayCell(date, date.getMonth() !== month));
  }

  els.calendarRoot.replaceChildren(wrapper);
}

function renderWeek() {
  const current = new Date(state.currentDate);
  const start = new Date(current);
  start.setDate(current.getDate() - current.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  els.periodTitle.textContent = `${formatJapaneseDate(start)} - ${formatJapaneseDate(end)}`;

  const wrapper = document.createElement("div");
  wrapper.className = "week-schedule";

  const corner = document.createElement("div");
  corner.className = "week-time-corner";
  wrapper.appendChild(corner);

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);

    const header = document.createElement("div");
    header.className = "week-day-header";
    if (toDateKey(date) === toDateKey(new Date())) header.classList.add("today");
    if (date.getDay() === 0) header.classList.add("sunday");
    if (date.getDay() === 6) header.classList.add("saturday");

    const weekdayLabel = document.createElement("span");
    weekdayLabel.textContent = weekdays[date.getDay()];

    const dateLabel = document.createElement("strong");
    dateLabel.textContent = String(date.getDate());

    header.append(weekdayLabel, dateLabel);
    wrapper.appendChild(header);
  }

  const timeRail = document.createElement("div");
  timeRail.className = "week-time-rail";
  for (let hour = 0; hour < 24; hour += 1) {
    const label = document.createElement("div");
    label.className = "time-label";
    label.textContent = `${String(hour).padStart(2, "0")}:00`;
    timeRail.appendChild(label);
  }
  wrapper.appendChild(timeRail);

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    wrapper.appendChild(createWeekDayColumn(date));
  }

  els.calendarRoot.replaceChildren(wrapper);
  updateCurrentTimeLine();
}

function addWeekHeaders(wrapper) {
  weekdays.forEach((day, index) => {
    const header = document.createElement("div");
    header.className = "weekday";
    if (index === 0) header.classList.add("sunday");
    if (index === 6) header.classList.add("saturday");
    header.textContent = day;
    wrapper.appendChild(header);
  });
}

function createDayCell(date, isMuted) {
  const key = toDateKey(date);
  const cell = document.createElement("section");
  cell.className = "day-cell";
  if (isMuted) cell.classList.add("muted-day");
  if (key === toDateKey(new Date())) cell.classList.add("today");
  cell.addEventListener("click", () => openEventDialog(key));

  const head = document.createElement("div");
  head.className = "day-head";

  const number = document.createElement("span");
  number.className = "date-number";
  number.textContent = String(date.getDate());

  head.append(number);
  cell.appendChild(head);

  getEventsByDate(key).forEach((item) => {
    const chip = document.createElement("button");
    chip.className = "event-chip";
    chip.classList.add(getEventTypeClass(item));
    chip.type = "button";
    chip.textContent = `${formatTimeRange(item)} ${item.friend_name}`;
    chip.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      openEventDialog(key, item);
    });
    cell.appendChild(chip);
  });

  return cell;
}

function createWeekDayColumn(date) {
  const key = toDateKey(date);
  const column = document.createElement("section");
  column.className = "week-day-column";
  column.style.height = `${HOUR_HEIGHT * 24}px`;
  if (key === toDateKey(new Date())) column.classList.add("today");
  column.addEventListener("click", (clickEvent) => {
    openEventDialog(key);
    els.startTime.value = getTimeFromWeekClick(clickEvent);
  });

  getWeekEventSegments(key).forEach(({ item, topMinutes, durationMinutes }) => {
    const eventButton = document.createElement("button");
    eventButton.className = "week-event";
    eventButton.classList.add(getEventTypeClass(item));
    eventButton.type = "button";
    eventButton.style.top = `${(topMinutes / 60) * HOUR_HEIGHT}px`;
    eventButton.style.height = `${(durationMinutes / 60) * HOUR_HEIGHT}px`;

    const timeLabel = document.createElement("strong");
    timeLabel.textContent = formatTimeRange(item);

    const friendLabel = document.createElement("span");
    friendLabel.textContent = item.friend_name;

    eventButton.append(timeLabel, friendLabel);
    eventButton.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      openEventDialog(key, item);
    });
    column.appendChild(eventButton);
  });

  if (key === toDateKey(new Date())) {
    const line = document.createElement("div");
    line.className = "current-time-line";
    column.appendChild(line);
  }

  return column;
}

function updateCurrentTimeLine() {
  const line = document.querySelector(".current-time-line");
  if (!line) return;

  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  line.style.top = `${(minutes / 60) * HOUR_HEIGHT}px`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return 0;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function getTimeFromWeekClick(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const rawMinutes = (y / HOUR_HEIGHT) * 60;
  const roundedMinutes = Math.min(23 * 60 + 30, Math.floor(rawMinutes / 30) * 30);
  return minutesToTime(roundedMinutes);
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getWeekEventSegments(dateKey) {
  const dayMinutes = 24 * 60;

  return state.events
    .flatMap((eventItem) => {
      const start = timeToMinutes(eventItem.start_time);
      const end = normalizeTime(eventItem.end_time) ? timeToMinutes(eventItem.end_time) : null;

      if (eventItem.event_date === dateKey) {
        if (end === null) {
          return [{ item: eventItem, topMinutes: start, durationMinutes: 45 }];
        }

        if (end > start) {
          return [{ item: eventItem, topMinutes: start, durationMinutes: Math.max(end - start, 30) }];
        }

        return [{ item: eventItem, topMinutes: start, durationMinutes: Math.max(dayMinutes - start, 30) }];
      }

      if (end !== null && end <= start && getNextDateKey(eventItem.event_date) === dateKey && end > 0) {
        return [{ item: eventItem, topMinutes: 0, durationMinutes: Math.max(end, 30) }];
      }

      return [];
    })
    .sort((a, b) => a.topMinutes - b.topMinutes || (a.item.start_time || "").localeCompare(b.item.start_time || ""));
}

function renderToday() {
  const items = getEventsByDate(toDateKey(new Date())).filter(isUpcomingTodayEvent);
  renderEventList(els.todayList, items);
}

function isUpcomingTodayEvent(eventItem) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = timeToMinutes(eventItem.start_time);
  return startMinutes > currentMinutes;
}

function renderSearch() {
  if (!els.searchDate.value) {
    els.searchResult.textContent = "日付を選んでください";
    els.searchResult.classList.add("empty");
    return;
  }
  renderEventList(els.searchResult, getEventsByDate(els.searchDate.value));
}

function renderEventList(root, items) {
  root.replaceChildren();
  if (!items.length) {
    root.textContent = "予定はありません";
    root.classList.add("empty");
    return;
  }

  root.classList.remove("empty");
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => openEventDialog(item.event_date, item));

    const article = document.createElement("article");
    article.className = "event-item";
    article.classList.add(getEventTypeClass(item));

    const main = document.createElement("div");
    const time = document.createElement("strong");
    time.className = "event-time";
    time.textContent = formatTimeRange(item);

    const friend = document.createElement("span");
    friend.className = "event-friend";
    friend.textContent = item.friend_name;

    const memo = document.createElement("p");
    memo.className = "event-memo";
    memo.textContent = item.memo || "メモはありません";

    main.append(time, friend);
    article.append(main, memo);
    button.appendChild(article);
    root.appendChild(button);
  });
}

function openEventDialog(dateKey, item = null) {
  if (isSharedCalendar() && !canEditActiveCalendar() && !item) {
    alert("This shared calendar is read-only for your account.");
    return;
  }

  els.dialogTitle.textContent = item ? "予定を編集" : "予定を追加";
  els.eventId.value = item?.id || "";
  els.eventDate.value = item?.event_date || dateKey;
  els.eventType.value = item?.event_type === "other" ? "other" : "game";
  els.startTime.value = normalizeTime(item?.start_time) || "";
  els.endTime.value = normalizeTime(item?.end_time) || "";
  els.friendName.value = item?.friend_name || "";
  els.memo.value = item?.memo || "";
  els.reminderMinutes.value = String(sanitizeReminder(item?.reminder_minutes));
  const readOnly = isSharedCalendar() && !canEditActiveCalendar();
  [els.eventDate, els.eventType, els.startTime, els.endTime, els.friendName, els.memo, els.reminderMinutes].forEach((input) => {
    input.disabled = readOnly;
  });
  els.eventForm.querySelector('button[type="submit"]').classList.toggle("hidden", readOnly);
  els.deleteEventBtn.classList.toggle("hidden", !item || readOnly);
  els.eventDialog.showModal();
}

function getEventsByDate(dateKey) {
  return state.events
    .filter((eventItem) => eventItem.event_date === dateKey)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("このブラウザは通知に対応していません。");
    return;
  }

  const result = await Notification.requestPermission();
  alert(result === "granted" ? "通知を許可しました。" : "通知は許可されませんでした。");
}

function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const now = new Date();
  state.events.forEach((eventItem) => {
    if (!eventItem.start_time) return;

    const remindAt = new Date(`${eventItem.event_date}T${normalizeTime(eventItem.start_time)}`);
    remindAt.setMinutes(remindAt.getMinutes() - Number(eventItem.reminder_minutes || 0));

    const diff = Math.abs(now.getTime() - remindAt.getTime());
    const key = `${eventItem.id}:${eventItem.event_date}:${eventItem.start_time}`;
    if (diff <= 30000 && !state.notifiedKeys.has(key)) {
      state.notifiedKeys.add(key);
      new Notification("ゲーム予定の時間です", {
        body: `${formatTimeRange(eventItem)} ${eventItem.friend_name}`
      });
    }
  });
}

function formatTimeRange(eventItem) {
  const start = normalizeTime(eventItem.start_time);
  const end = normalizeTime(eventItem.end_time);
  if (start && end) return `${start}-${end}`;
  if (start) return start;
  return "時刻未設定";
}

function normalizeTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNextDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return toDateKey(date);
}

function formatJapaneseDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
