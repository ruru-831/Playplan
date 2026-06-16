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
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "game-friend-calendar-events";
const SYNC_META_KEY = "game-friend-calendar-sync-meta";
const SHARED_SYNC_META_KEY = "__shared";
const HOUR_HEIGHT = 56;
const DEFAULT_REMINDER_MINUTES = 5;
const PERSONAL_CALENDAR_ID = "personal";
const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_THEME_COLOR = "#5B7C99";
const GAME_EVENT_COLOR = "#dff0e4";

const state = {
  localEvents: [],
  remoteEvents: [],
  events: [],
  sharedCalendars: [],
  activeCalendar: { type: "personal", id: PERSONAL_CALENDAR_ID, name: "\u500b\u4eba\u30ab\u30ec\u30f3\u30c0\u30fc" },
  activeMemberRole: "owner",
  activeMemberColor: DEFAULT_THEME_COLOR,
  shareSourceEvent: null,
  pendingInviteJoin: null,
  pendingInviteCode: new URLSearchParams(window.location.search).get("invite") || "",
  currentDate: new Date(),
  lastDateKey: toDateKey(new Date()),
  view: "month",
  notifiedKeys: new Set(),
  inAppNotificationsEnabled: false,
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
  activeCalendarTitle: document.querySelector("#activeCalendarTitle"),
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
  shareEventBtn: document.querySelector("#shareEventBtn"),
  shareEventDialog: document.querySelector("#shareEventDialog"),
  shareCalendarList: document.querySelector("#shareCalendarList"),
  cancelShareEventBtn: document.querySelector("#cancelShareEventBtn"),
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
  renameSharedCalendarBtn: document.querySelector("#renameSharedCalendarBtn"),
  copyInviteLinkBtn: document.querySelector("#copyInviteLinkBtn"),
  deleteSharedCalendarBtn: document.querySelector("#deleteSharedCalendarBtn"),
  sharedCalendarDialog: document.querySelector("#sharedCalendarDialog"),
  sharedCalendarForm: document.querySelector("#sharedCalendarForm"),
  sharedCalendarName: document.querySelector("#sharedCalendarName"),
  sharedCalendarColor: document.querySelector("#sharedCalendarColor"),
  cancelSharedCalendarBtn: document.querySelector("#cancelSharedCalendarBtn"),
  joinColorDialog: document.querySelector("#joinColorDialog"),
  joinColorForm: document.querySelector("#joinColorForm"),
  joinCalendarColor: document.querySelector("#joinCalendarColor"),
  appMessageDialog: document.querySelector("#appMessageDialog"),
  appMessageForm: document.querySelector("#appMessageForm"),
  appMessageTitle: document.querySelector("#appMessageTitle"),
  appMessageText: document.querySelector("#appMessageText"),
  appMessageInputLabel: document.querySelector("#appMessageInputLabel"),
  appMessageInput: document.querySelector("#appMessageInput"),
  appMessageCancelBtn: document.querySelector("#appMessageCancelBtn"),
  appMessageOkBtn: document.querySelector("#appMessageOkBtn"),
  toastRoot: document.querySelector("#toastRoot")
};

const weekdays = ["\u65e5", "\u6708", "\u706b", "\u6c34", "\u6728", "\u91d1", "\u571f"];

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
  els.shareEventBtn.addEventListener("click", openShareEventDialog);
  els.cancelShareEventBtn.addEventListener("click", () => els.shareEventDialog.close());
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
  els.renameSharedCalendarBtn.addEventListener("click", handleRenameSharedCalendar);
  els.cancelSharedCalendarBtn.addEventListener("click", () => els.sharedCalendarDialog.close());
  els.sharedCalendarForm.addEventListener("submit", handleCreateSharedCalendar);
  els.copyInviteLinkBtn.addEventListener("click", handleCopyInviteLink);
  els.deleteSharedCalendarBtn.addEventListener("click", handleDeleteSharedCalendar);
  els.joinColorForm.addEventListener("submit", handleJoinColorSubmit);
  els.joinColorDialog.addEventListener("cancel", (event) => event.preventDefault());
}

function setDefaultDates() {
  const today = toDateKey(new Date());
  els.eventDate.value = today;
}

function showAppMessage({ title = "\u901a\u77e5", message = "", kind = "alert", defaultValue = "" } = {}) {
  return new Promise((resolve) => {
    const cleanup = () => {
      els.appMessageForm.removeEventListener("submit", handleSubmit);
      els.appMessageCancelBtn.removeEventListener("click", handleCancel);
      els.appMessageDialog.removeEventListener("cancel", handleCancel);
      els.appMessageDialog.removeEventListener("close", handleClose);
    };

    const finish = (value) => {
      cleanup();
      if (els.appMessageDialog.open) {
        els.appMessageDialog.close();
      }
      resolve(value);
    };

    const handleSubmit = (event) => {
      event.preventDefault();
      if (kind === "prompt") {
        finish(els.appMessageInput.value);
        return;
      }
      finish(true);
    };
    const handleCancel = (event) => {
      event.preventDefault();
      finish(kind === "confirm" ? false : null);
    };
    const handleClose = () => {
      cleanup();
      resolve(kind === "confirm" ? false : null);
    };

    els.appMessageTitle.textContent = title;
    els.appMessageText.textContent = message;
    els.appMessageInput.value = defaultValue;
    els.appMessageInputLabel.classList.toggle("hidden", kind !== "prompt");
    els.appMessageCancelBtn.classList.toggle("hidden", kind === "alert");
    els.appMessageOkBtn.textContent = kind === "confirm" ? "OK" : "OK";

    els.appMessageForm.addEventListener("submit", handleSubmit);
    els.appMessageCancelBtn.addEventListener("click", handleCancel);
    els.appMessageDialog.addEventListener("cancel", handleCancel);
    els.appMessageDialog.addEventListener("close", handleClose);
    els.appMessageDialog.showModal();
    if (kind === "prompt") {
      els.appMessageInput.focus();
      els.appMessageInput.select();
    }
  });
}

function appAlert(message, title = "\u901a\u77e5") {
  return showAppMessage({ title, message, kind: "alert" });
}

function appConfirm(message, title = "\u78ba\u8a8d") {
  return showAppMessage({ title, message, kind: "confirm" });
}

function appPrompt(message, defaultValue = "", title = "\u5165\u529b") {
  return showAppMessage({ title, message, defaultValue, kind: "prompt" });
}
function showToast(title, message = "") {
  if (!els.toastRoot) return;
  const toast = document.createElement("article");
  toast.className = "toast";
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  const messageEl = document.createElement("p");
  messageEl.textContent = message;
  toast.append(titleEl, messageEl);
  els.toastRoot.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 7000);
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

function normalizeThemeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : DEFAULT_THEME_COLOR;
}

function getCurrentMemberColor() {
  return normalizeThemeColor(state.activeMemberColor);
}

function updateEventTypeLabels() {
  const gameLabel = isSharedCalendar() ? "\u3010\u5171\u901a\u3011\u30b2\u30fc\u30e0\u4e88\u5b9a" : "\u30b2\u30fc\u30e0\u4e88\u5b9a";
  const otherLabel = isSharedCalendar() ? "\u500b\u4eba\u306e\u4e88\u5b9a" : "\u305d\u308c\u4ee5\u5916\u306e\u4e88\u5b9a";
  const gameOption = els.eventType.querySelector('option[value="game"]');
  const otherOption = els.eventType.querySelector('option[value="other"]');
  if (gameOption) gameOption.textContent = gameLabel;
  if (otherOption) otherOption.textContent = otherLabel;
}

function getEventTypeClass(eventItem) {
  return eventItem?.event_type === "other" ? "event-other" : "event-game";
}

function applySharedEventColor(element, eventItem) {
  if (!isSharedCalendar() || eventItem?.event_type !== "other") return;
  const color = normalizeThemeColor(eventItem.creator_color);
  element.style.borderColor = color;
  element.style.background = color;
  element.style.color = "#fff";
}

function applySharedEventListColor(element, eventItem) {
  if (!isSharedCalendar() || eventItem?.event_type !== "other") return;
  const color = normalizeThemeColor(eventItem.creator_color);
  element.style.borderLeftColor = color;
  const time = element.querySelector(".event-time");
  if (time) time.style.color = color;
}

function openSharedCalendarDialog() {
  if (!state.user || !state.firebaseReady) {
    appAlert("\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u3092\u4f5c\u6210\u3059\u308b\u306b\u306fGoogle\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002");
    return;
  }

  els.sharedCalendarName.value = "";
  els.sharedCalendarColor.value = DEFAULT_THEME_COLOR;
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

  const eventItem = {
    id,
    event_date: eventDate,
    start_time: startTime || null,
    end_time: endTime || null,
    friend_name: friendName.slice(0, 80),
    memo: String(raw.memo || "").slice(0, 500),
    reminder_minutes: reminder,
    created_at: createdAt,
    updated_at: updatedAt
  };

  if (raw.event_type === "game" || raw.event_type === "other") {
    eventItem.event_type = raw.event_type;
  }
  if (typeof raw.created_by === "string" && raw.created_by.trim()) {
    eventItem.created_by = raw.created_by.trim().slice(0, 120);
  }
  if (typeof raw.creator_color === "string") {
    eventItem.creator_color = normalizeThemeColor(raw.creator_color);
  }

  return eventItem;
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
    state.syncError = "Sync setup failed.";
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
          state.activeMemberColor = normalizeThemeColor(active.themeColor);
        } else {
          switchActiveCalendar({ type: "personal" }, { keepMenuOpen: true });
        }
      }

      renderCalendarMenu();
      renderSyncState();
    },
    (error) => {
      console.error(error);
      state.syncError = "\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
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
    themeColor: normalizeThemeColor(raw.themeColor),
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
      state.syncError = "\u4e88\u5b9a\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
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
      state.syncError = "\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306e\u4e88\u5b9a\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
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
          state.syncError = "\u540c\u671f\u5148\u306e\u4e88\u5b9a\u524a\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
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
    els.syncDeleteEventMemo.textContent = eventItem.memo || "\u30e1\u30e2\u306f\u3042\u308a\u307e\u305b\u3093";

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
    state.activeMemberColor = normalizeThemeColor(membership.themeColor);
  } else {
    state.activeCalendar = { type: "personal", id: PERSONAL_CALENDAR_ID, name: "\u500b\u4eba\u30ab\u30ec\u30f3\u30c0\u30fc" };
    state.activeMemberRole = "owner";
    state.activeMemberColor = DEFAULT_THEME_COLOR;
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
    els.sharedCalendarList.textContent = state.user ? "\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306f\u3042\u308a\u307e\u305b\u3093" : "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059";
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

  els.renameSharedCalendarBtn.classList.toggle("hidden", !(isSharedCalendar() && state.activeMemberRole === "owner"));
  els.copyInviteLinkBtn.classList.toggle("hidden", !isSharedCalendar());
  els.deleteSharedCalendarBtn.classList.toggle("hidden", !(isSharedCalendar() && state.activeMemberRole === "owner"));
}

async function handleCreateSharedCalendar(event) {
  event.preventDefault();
  if (!state.user || !state.db) return;

  const name = els.sharedCalendarName.value.trim().slice(0, 80);
  if (!name) return;

  const now = new Date().toISOString();
  const inviteCode = generateInviteCode();
  const themeColor = normalizeThemeColor(els.sharedCalendarColor.value);
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
      joinedAt: now,
      themeColor
    });

    createStep = "membership and invite code";
    await Promise.all([
      setDoc(doc(state.db, "users", state.user.uid, "calendarMemberships", calendarRef.id), {
        role: "owner",
        joinedAt: now,
        name,
        inviteCode,
        themeColor
      }),
      setDoc(doc(state.db, "inviteCodes", inviteCode), {
        calendarId: calendarRef.id,
        createdAt: now
      })
    ]);

    els.sharedCalendarDialog.close();
    state.sharedCalendars = [
      ...state.sharedCalendars.filter((item) => item.id !== calendarRef.id),
      { id: calendarRef.id, name, role: "owner", inviteCode, joinedAt: now, themeColor }
    ];
    switchActiveCalendar({ type: "shared", id: calendarRef.id }, { keepMenuOpen: true });
  } catch (error) {
    console.error(error);
    appAlert(`\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306e\u4f5c\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002step=${createStep} code=${error.code || "unknown"}`);
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
    appAlert("\u5171\u6709\u30ea\u30f3\u30af\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
    return;
  }

  const link = buildInviteLink(inviteCode);
  try {
    await navigator.clipboard.writeText(link);
    appAlert("\u5171\u6709\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f\u3002");
  } catch (_error) {
    await appPrompt("\u5171\u6709\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc\u3057\u3066\u304f\u3060\u3055\u3044\u3002", link);
  }
}
async function handleRenameSharedCalendar() {
  if (!isSharedCalendar() || state.activeMemberRole !== "owner" || !state.user || !state.db) return;

  const nextName = await appPrompt("\u65b0\u3057\u3044\u30ab\u30ec\u30f3\u30c0\u30fc\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002", state.activeCalendar.name || "");
  const name = String(nextName || "").trim().slice(0, 80);
  if (!name || name === state.activeCalendar.name) return;

  const now = new Date().toISOString();

  try {
    await updateDoc(doc(state.db, "sharedCalendars", state.activeCalendar.id), {
      name,
      updatedAt: now
    });

    const membersSnapshot = await getDocs(collection(state.db, "sharedCalendars", state.activeCalendar.id, "members"));
    const batch = writeBatch(state.db);
    membersSnapshot.docs.forEach((memberDoc) => {
      batch.update(doc(state.db, "users", memberDoc.id, "calendarMemberships", state.activeCalendar.id), { name });
    });
    await batch.commit();

    state.activeCalendar = { ...state.activeCalendar, name };
    state.sharedCalendars = state.sharedCalendars.map((calendar) =>
      calendar.id === state.activeCalendar.id ? { ...calendar, name } : calendar
    );
    render();
    appAlert("\u30ab\u30ec\u30f3\u30c0\u30fc\u540d\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f\u3002");
  } catch (error) {
    console.error(error);
    appAlert("\u30ab\u30ec\u30f3\u30c0\u30fc\u540d\u306e\u66f4\u65b0\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }
}
async function handleDeleteSharedCalendar() {
  if (!isSharedCalendar() || state.activeMemberRole !== "owner" || !state.user || !state.db) return;

  const confirmed = await appConfirm(`\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u300c${state.activeCalendar.name}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\u3053\u306e\u64cd\u4f5c\u306f\u5143\u306b\u623b\u305b\u307e\u305b\u3093\u3002`);
  if (!confirmed) return;

  const calendarId = state.activeCalendar.id;

  try {
    const [eventsSnapshot, membersSnapshot] = await Promise.all([
      getDocs(collection(state.db, "sharedCalendars", calendarId, "events")),
      getDocs(collection(state.db, "sharedCalendars", calendarId, "members"))
    ]);

    const inviteCode = state.activeCalendar.inviteCode || state.sharedCalendars.find((item) => item.id === calendarId)?.inviteCode || "";
    const batch = writeBatch(state.db);

    eventsSnapshot.docs.forEach((eventDoc) => {
      batch.delete(doc(state.db, "sharedCalendars", calendarId, "events", eventDoc.id));
    });
    membersSnapshot.docs.forEach((memberDoc) => {
      batch.delete(doc(state.db, "users", memberDoc.id, "calendarMemberships", calendarId));
      batch.delete(doc(state.db, "sharedCalendars", calendarId, "members", memberDoc.id));
    });
    if (inviteCode) {
      batch.delete(doc(state.db, "inviteCodes", inviteCode));
    }
    batch.delete(doc(state.db, "sharedCalendars", calendarId));

    await batch.commit();

    state.sharedCalendars = state.sharedCalendars.filter((calendar) => calendar.id !== calendarId);
    switchActiveCalendar({ type: "personal" }, { keepMenuOpen: true });
    appAlert("\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u3092\u524a\u9664\u3057\u307e\u3057\u305f\u3002");
  } catch (error) {
    console.error(error);
    appAlert("\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306e\u524a\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }
}
function getWritableSharedCalendars() {
  return state.sharedCalendars.filter((calendar) => ["owner", "editor"].includes(calendar.role));
}

function openShareEventDialog() {
  const sourceEvent = state.shareSourceEvent;
  if (!sourceEvent || !isPersonalCalendar()) return;

  els.shareCalendarList.replaceChildren();
  const calendars = getWritableSharedCalendars();

  if (!state.user || !state.firebaseReady) {
    els.shareCalendarList.textContent = "\u5171\u6709\u3059\u308b\u306b\u306fGoogle\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002";
    els.shareCalendarList.classList.add("empty");
  } else if (!calendars.length) {
    els.shareCalendarList.textContent = "\u5171\u6709\u53ef\u80fd\u306a\u30ab\u30ec\u30f3\u30c0\u30fc\u306f\u3042\u308a\u307e\u305b\u3093\u3002";
    els.shareCalendarList.classList.add("empty");
  } else {
    els.shareCalendarList.classList.remove("empty");
    calendars.forEach((calendar) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.textContent = calendar.name;
      button.addEventListener("click", () => handleShareEventToCalendar(calendar.id));
      els.shareCalendarList.appendChild(button);
    });
  }

  els.shareEventDialog.showModal();
}

function buildSharedEventCopy(sourceEvent, calendar) {
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const copiedEvent = {
    id: eventId,
    event_date: sourceEvent.event_date,
    start_time: sourceEvent.start_time || null,
    end_time: sourceEvent.end_time || null,
    friend_name: sourceEvent.friend_name,
    memo: sourceEvent.memo || "",
    reminder_minutes: sanitizeReminder(sourceEvent.reminder_minutes),
    created_at: now,
    updated_at: now,
    created_by: state.user?.uid || "",
    creator_color: normalizeThemeColor(calendar?.themeColor)
  };

  if (sourceEvent.event_type === "game" || sourceEvent.event_type === "other") {
    copiedEvent.event_type = sourceEvent.event_type;
  }

  return copiedEvent;
}

async function handleShareEventToCalendar(calendarId) {
  const sourceEvent = state.shareSourceEvent;
  const calendar = getWritableSharedCalendars().find((item) => item.id === calendarId);
  if (!sourceEvent || !calendar || !state.user || !state.db) {
    appAlert("\u5171\u6709\u3067\u304d\u307e\u305b\u3093\u3002\u5171\u6709\u5148\u306e\u30ab\u30ec\u30f3\u30c0\u30fc\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    return;
  }

  const copiedEvent = buildSharedEventCopy(sourceEvent, calendar);

  try {
    await setDoc(doc(state.db, "sharedCalendars", calendar.id, "events", copiedEvent.id), copiedEvent);
    els.shareEventDialog.close();
    appAlert(`${calendar.name} \u306b\u5171\u6709\u3057\u307e\u3057\u305f\u3002`);
  } catch (error) {
    console.error(error);
    appAlert("\u5171\u6709\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u6a29\u9650\u3084Firestore Rules\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
  }
}
async function acceptInviteCode(inviteCode) {
  if (!state.user || !state.db || !inviteCode) return;

  try {
    const inviteSnapshot = await getDoc(doc(state.db, "inviteCodes", inviteCode));
    if (!inviteSnapshot.exists()) {
      appAlert("\u5171\u6709\u30ea\u30f3\u30af\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
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

    const calendarSnapshot = await getDoc(doc(state.db, "sharedCalendars", calendarId));
    const calendarData = calendarSnapshot.exists() ? calendarSnapshot.data() : {};
    const name = String(calendarData.name || "\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc").slice(0, 80);

    state.pendingInviteJoin = { calendarId, inviteCode, name };
    els.joinCalendarColor.value = DEFAULT_THEME_COLOR;
    els.joinColorDialog.showModal();
  } catch (error) {
    console.error(error);
    state.pendingInviteCode = "";
    state.syncError = "\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u3078\u306e\u53c2\u52a0\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
    subscribeToActiveEvents();
    render();
  }
}

async function handleJoinColorSubmit(event) {
  event.preventDefault();
  const join = state.pendingInviteJoin;
  if (!join || !state.user || !state.db) return;

  const now = new Date().toISOString();
  const themeColor = normalizeThemeColor(els.joinCalendarColor.value);

  try {
    await setDoc(
      doc(state.db, "sharedCalendars", join.calendarId, "members", state.user.uid),
      {
        role: "editor",
        joinedAt: now,
        inviteCodeUsed: join.inviteCode,
        themeColor
      },
      { merge: true }
    );

    await setDoc(
      doc(state.db, "users", state.user.uid, "calendarMemberships", join.calendarId),
      {
        role: "editor",
        joinedAt: now,
        name: join.name,
        inviteCode: join.inviteCode,
        themeColor
      },
      { merge: true }
    );

    state.pendingInviteCode = "";
    state.pendingInviteJoin = null;
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash || ""}`);
    state.sharedCalendars = [
      ...state.sharedCalendars.filter((item) => item.id !== join.calendarId),
      {
        id: join.calendarId,
        name: join.name,
        role: "editor",
        inviteCode: join.inviteCode,
        joinedAt: now,
        themeColor
      }
    ];
    els.joinColorDialog.close();
    switchActiveCalendar({ type: "shared", id: join.calendarId }, { keepMenuOpen: true });
    appAlert(`${join.name} \u306b\u53c2\u52a0\u3057\u307e\u3057\u305f\u3002`);
  } catch (error) {
    console.error(error);
    appAlert("\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u3078\u306e\u53c2\u52a0\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }
}

async function handleGoogleLogin() {
  if (!state.firebaseReady || !state.auth) {
    appAlert("\u30ed\u30b0\u30a4\u30f3\u306e\u6e96\u5099\u304c\u307e\u3060\u5b8c\u4e86\u3057\u3066\u3044\u307e\u305b\u3093\u3002");
    return;
  }

  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(state.auth, provider);
  } catch (error) {
    console.error(error);
    appAlert("Google\u30ed\u30b0\u30a4\u30f3\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u30dd\u30c3\u30d7\u30a2\u30c3\u30d7\u306e\u8a31\u53ef\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
  }
}

async function handleLogout() {
  if (!state.auth) return;

  try {
    await signOut(state.auth);
  } catch (error) {
    console.error(error);
    appAlert("\u30ed\u30b0\u30a2\u30a6\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }
}

async function handleMigrateToFirebase() {
  if (!state.user || !state.db) return;
  if (!state.localEvents.length) {
    appAlert("\u540c\u671f\u3059\u308b\u4e88\u5b9a\u306f\u3042\u308a\u307e\u305b\u3093\u3002");
    return;
  }

  const confirmed = await appConfirm("\u3053\u306e\u7aef\u672b\u306e\u4e88\u5b9a\u3092\u3001\u4ed6\u306e\u7aef\u672b\u3067\u3082\u898b\u3089\u308c\u308b\u3088\u3046\u306b\u540c\u671f\u3057\u307e\u3059\u3002\u4e88\u5b9a\u306f\u3053\u306e\u7aef\u672b\u306b\u3082\u6b8b\u308a\u307e\u3059\u3002\u7d9a\u3051\u307e\u3059\u304b\uff1f");
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
    appAlert("\u4e88\u5b9a\u3092\u540c\u671f\u3057\u307e\u3057\u305f\u3002");
  } catch (error) {
    console.error(error);
    appAlert("\u4e88\u5b9a\u306e\u540c\u671f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
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
    appAlert("\u4e88\u5b9a\u306e\u5165\u529b\u5185\u5bb9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u3002");
    return;
  }

  if (isSharedCalendar()) {
    nextEvent.created_by = previousEvent?.created_by || state.user?.uid || "";
    nextEvent.creator_color = normalizeThemeColor(previousEvent?.creator_color || getCurrentMemberColor());
  }

  if (isSharedCalendar() && !canEditActiveCalendar()) {
    appAlert("\u3053\u306e\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306f\u8aad\u307f\u53d6\u308a\u5c02\u7528\u3067\u3059\u3002");
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
    state.syncError = "\u4e88\u5b9a\u306e\u4fdd\u5b58\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u3053\u306e\u7aef\u672b\u306b\u306f\u4fdd\u5b58\u3055\u308c\u3066\u3044\u307e\u3059\u3002";
    renderSyncState();
    render();
  }
}

async function handleDeleteEvent() {
  const id = els.eventId.value;
  if (!id || !(await appConfirm("\u3053\u306e\u4e88\u5b9a\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f"))) return;

  if (isSharedCalendar() && !canEditActiveCalendar()) {
    appAlert("\u3053\u306e\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306f\u8aad\u307f\u53d6\u308a\u5c02\u7528\u3067\u3059\u3002");
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
    state.syncError = "\u4e88\u5b9a\u306e\u524a\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u3053\u306e\u7aef\u672b\u4e0a\u3067\u306f\u524a\u9664\u6e08\u307f\u3067\u3059\u3002";
    renderSyncState();
    render();
  }
}
function renderSyncState() {
  if (!state.firebaseReady) {
    els.authStatus.textContent = state.syncError || "\u4eca\u306f\u3053\u306e\u7aef\u672b\u3060\u3051\u3067\u4e88\u5b9a\u3092\u4f7f\u3048\u307e\u3059\u3002";
    els.syncStatus.textContent = "\u3053\u306e\u7aef\u672b\u306b\u3060\u3051\u4e88\u5b9a\u304c\u4fdd\u5b58\u3055\u308c\u307e\u3059\u3002";
    els.modeMessage.textContent = "\u3053\u306e\u7aef\u672b\u306e\u4e88\u5b9a\u3092\u8868\u793a\u3057\u3066\u3044\u307e\u3059\u3002";
    els.googleLoginBtn.classList.remove("hidden");
    els.googleLoginBtn.disabled = true;
    els.logoutBtn.classList.add("hidden");
    els.migrateBtn.classList.add("hidden");
    return;
  }

  els.googleLoginBtn.disabled = false;

  if (!state.authReady) {
    els.authStatus.textContent = "\u8a8d\u8a3c\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u3002";
    els.syncStatus.textContent = "\u3057\u3070\u3089\u304f\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002";
    els.modeMessage.textContent = "\u8a8d\u8a3c\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u3002";
    els.googleLoginBtn.classList.add("hidden");
    els.logoutBtn.classList.add("hidden");
    els.migrateBtn.classList.add("hidden");
    return;
  }

  if (!state.user) {
    els.authStatus.textContent = "Google\u3067\u30ed\u30b0\u30a4\u30f3\u3059\u308b\u3068\u3001PC\u3068\u30b9\u30de\u30db\u3067\u540c\u3058\u4e88\u5b9a\u3092\u898b\u3089\u308c\u307e\u3059\u3002";
    els.syncStatus.textContent = "\u307e\u3060\u540c\u671f\u306f\u3057\u3066\u3044\u307e\u305b\u3093\u3002\u3053\u306e\u7aef\u672b\u3060\u3051\u306b\u4e88\u5b9a\u304c\u4fdd\u5b58\u3055\u308c\u3066\u3044\u307e\u3059\u3002";
    els.modeMessage.textContent = "\u3053\u306e\u7aef\u672b\u306e\u4e88\u5b9a\u3092\u8868\u793a\u3057\u3066\u3044\u307e\u3059\u3002";
    els.googleLoginBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
    els.migrateBtn.classList.add("hidden");
    return;
  }

  els.authStatus.textContent = state.user.email || "Google\u30a2\u30ab\u30a6\u30f3\u30c8\u3067\u30ed\u30b0\u30a4\u30f3\u4e2d\u3067\u3059\u3002";
  els.googleLoginBtn.classList.add("hidden");
  els.logoutBtn.classList.remove("hidden");

  if (isSharedCalendar()) {
    const roleLabels = {
      owner: "\u30aa\u30fc\u30ca\u30fc",
      editor: "\u7de8\u96c6\u8005",
      viewer: "\u95b2\u89a7\u306e\u307f"
    };
    const roleLabel = roleLabels[state.activeMemberRole] || "\u95b2\u89a7\u306e\u307f";
    els.syncStatus.textContent = `\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc: ${state.activeCalendar.name}\u3000${roleLabel}`;
    els.modeMessage.textContent = canEditActiveCalendar()
      ? "\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306e\u4e88\u5b9a\u3092\u8868\u793a\u3057\u3066\u3044\u307e\u3059\u3002"
      : "\u3053\u306e\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306f\u8aad\u307f\u53d6\u308a\u5c02\u7528\u3067\u3059\u3002";
    els.migrateBtn.classList.add("hidden");
    return;
  }

  if (state.syncError) {
    els.syncStatus.textContent = state.syncError;
    els.modeMessage.textContent = state.syncError;
  } else if (hasPendingMigration()) {
    els.syncStatus.textContent = "\u5225\u306e\u7aef\u672b\u3067\u3082\u4e88\u5b9a\u3092\u898b\u305f\u3044\u5834\u5408\u306f\u3001\u4e0b\u306e\u79fb\u884c\u30dc\u30bf\u30f3\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
    els.modeMessage.textContent = "\u3053\u306e\u7aef\u672b\u306e\u4e88\u5b9a\u3092\u8868\u793a\u3057\u3066\u3044\u307e\u3059\u3002";
  } else if (!state.remoteLoaded) {
    els.syncStatus.textContent = "\u4e88\u5b9a\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059\u3002";
    els.modeMessage.textContent = "\u4e88\u5b9a\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059\u3002";
  } else {
    els.syncStatus.textContent = "\u4ed6\u306e\u7aef\u672b\u3068\u3082\u4e88\u5b9a\u3092\u5171\u6709\u3067\u304d\u307e\u3059\u3002";
    els.modeMessage.textContent = "\u5225\u306e\u7aef\u672b\u3067\u5909\u66f4\u3057\u305f\u4e88\u5b9a\u3082\u53cd\u6620\u3055\u308c\u307e\u3059\u3002";
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
  els.activeCalendarTitle.textContent = state.activeCalendar.name || "\u500b\u4eba\u30ab\u30ec\u30f3\u30c0\u30fc";
  updateEventTypeLabels();
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
  els.periodTitle.textContent = `${year}\u5e74 ${month + 1}\u6708`;

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
    applySharedEventColor(chip, item);
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
    applySharedEventColor(eventButton, item);
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
    els.searchResult.textContent = "\u65e5\u4ed8\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044";
    els.searchResult.classList.add("empty");
    return;
  }
  renderEventList(els.searchResult, getEventsByDate(els.searchDate.value));
}

function renderEventList(root, items) {
  root.replaceChildren();
  if (!items.length) {
    root.textContent = "\u4e88\u5b9a\u306f\u3042\u308a\u307e\u305b\u3093";
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
    memo.textContent = item.memo || "\u30e1\u30e2\u306f\u3042\u308a\u307e\u305b\u3093";

    main.append(time, friend);
    article.append(main, memo);
    applySharedEventListColor(article, item);
    button.appendChild(article);
    root.appendChild(button);
  });
}

function openEventDialog(dateKey, item = null) {
  if (isSharedCalendar() && !canEditActiveCalendar() && !item) {
    appAlert("\u3053\u306e\u5171\u6709\u30ab\u30ec\u30f3\u30c0\u30fc\u306f\u8aad\u307f\u53d6\u308a\u5c02\u7528\u3067\u3059\u3002");
    return;
  }

  state.shareSourceEvent = isPersonalCalendar() && item ? { ...item } : null;
  els.dialogTitle.textContent = item ? "\u4e88\u5b9a\u3092\u7de8\u96c6" : "\u4e88\u5b9a\u3092\u8ffd\u52a0";
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
  els.shareEventBtn.classList.toggle("hidden", !(isPersonalCalendar() && item));
  els.eventDialog.showModal();
}

function getEventsByDate(dateKey) {
  return state.events
    .filter((eventItem) => eventItem.event_date === dateKey)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
}

async function requestNotificationPermission() {
  state.inAppNotificationsEnabled = true;
  await appAlert("\u30a2\u30d7\u30ea\u5185\u901a\u77e5\u3092\u30aa\u30f3\u306b\u3057\u307e\u3057\u305f\u3002PlayPlan\u3092\u958b\u3044\u3066\u3044\u308b\u9593\u3001\u4e88\u5b9a\u306e\u30ea\u30de\u30a4\u30f3\u30c0\u30fc\u3092\u753b\u9762\u5185\u306b\u8868\u793a\u3057\u307e\u3059\u3002");
}

function checkReminders() {
  if (!state.inAppNotificationsEnabled) return;

  const now = new Date();
  state.events.forEach((eventItem) => {
    if (!eventItem.start_time) return;

    const remindAt = new Date(`${eventItem.event_date}T${normalizeTime(eventItem.start_time)}`);
    remindAt.setMinutes(remindAt.getMinutes() - Number(eventItem.reminder_minutes || 0));

    const diff = Math.abs(now.getTime() - remindAt.getTime());
    const key = `${eventItem.id}:${eventItem.event_date}:${eventItem.start_time}`;
    if (diff <= 30000 && !state.notifiedKeys.has(key)) {
      state.notifiedKeys.add(key);
      showToast("\u4e88\u5b9a\u306e\u6642\u9593\u3067\u3059", `${formatTimeRange(eventItem)} ${eventItem.friend_name}`);
    }
  });
}
function formatTimeRange(eventItem) {
  const start = normalizeTime(eventItem.start_time);
  const end = normalizeTime(eventItem.end_time);
  if (start && end) return `${start}-${end}`;
  if (start) return start;
  return "\u6642\u523b\u672a\u8a2d\u5b9a";
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
  return `${date.getFullYear()}\u5e74${date.getMonth() + 1}\u6708${date.getDate()}\u65e5`;
}
