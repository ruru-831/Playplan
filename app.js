const STORAGE_KEY = "game-friend-calendar-events";
const HOUR_HEIGHT = 56;

const state = {
  events: [],
  currentDate: new Date(),
  lastDateKey: toDateKey(new Date()),
  view: "month",
  notifiedKeys: new Set()
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
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  friendName: document.querySelector("#friendName"),
  memo: document.querySelector("#memo"),
  deleteEventBtn: document.querySelector("#deleteEventBtn")
};

const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

init();

function init() {
  loadEvents();
  bindEvents();
  setDefaultDates();
  render();
  syncSidePanelHeight();
  window.addEventListener("resize", syncSidePanelHeight);
  new ResizeObserver(syncSidePanelHeight).observe(els.calendarSection);
  setInterval(updateCurrentTimeLine, 60000);
  setInterval(checkDateChange, 60000);
  setInterval(renderToday, 60000);
  setInterval(checkReminders, 30000);
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
}

function setDefaultDates() {
  const today = toDateKey(new Date());
  els.searchDate.value = today;
  els.eventDate.value = today;
}

function loadEvents() {
  try {
    state.events = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (_error) {
    state.events = [];
  }
}

function persistEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.events));
  state.notifiedKeys.clear();
}

function handleSaveEvent(event) {
  event.preventDefault();

  const id = els.eventId.value || crypto.randomUUID();
  const now = new Date().toISOString();
  const nextEvent = {
    id,
    event_date: els.eventDate.value,
    start_time: els.startTime.value || null,
    end_time: els.endTime.value || null,
    friend_name: els.friendName.value.trim(),
    memo: els.memo.value.trim(),
    reminder_minutes: Number(els.reminderMinutes.value),
    created_at: now,
    updated_at: now
  };

  const index = state.events.findIndex((item) => item.id === id);
  if (index >= 0) {
    nextEvent.created_at = state.events[index].created_at || now;
    state.events[index] = nextEvent;
  } else {
    state.events.push(nextEvent);
  }

  persistEvents();
  els.eventDialog.close();
  render();
}

function handleDeleteEvent() {
  const id = els.eventId.value;
  if (!id || !confirm("この予定を削除しますか？")) return;

  state.events = state.events.filter((item) => item.id !== id);
  persistEvents();
  els.eventDialog.close();
  render();
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
    header.innerHTML = `<span>${weekdays[date.getDay()]}</span><strong>${date.getDate()}</strong>`;
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
    chip.type = "button";
    chip.textContent = `${formatTimeRange(item)} ${item.friend_name}`;
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
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
  column.addEventListener("click", (event) => {
    openEventDialog(key);
    els.startTime.value = getTimeFromWeekClick(event);
  });

  getEventsByDate(key).forEach((item) => {
    const eventButton = document.createElement("button");
    eventButton.className = "week-event";
    eventButton.type = "button";
    eventButton.style.top = `${timeToMinutes(item.start_time) / 60 * HOUR_HEIGHT}px`;
    eventButton.style.height = `${getEventDurationMinutes(item) / 60 * HOUR_HEIGHT}px`;
    eventButton.innerHTML = `<strong>${formatTimeRange(item)}</strong><span>${escapeHtml(item.friend_name)}</span>`;
    eventButton.addEventListener("click", (event) => {
      event.stopPropagation();
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
  line.style.top = `${minutes / 60 * HOUR_HEIGHT}px`;
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
  const rawMinutes = y / HOUR_HEIGHT * 60;
  const roundedMinutes = Math.min(23 * 60 + 30, Math.floor(rawMinutes / 30) * 30);
  return minutesToTime(roundedMinutes);
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getEventDurationMinutes(event) {
  const start = timeToMinutes(event.start_time);
  const end = timeToMinutes(event.end_time);
  if (end > start) return Math.max(end - start, 30);
  return 45;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderToday() {
  const items = getEventsByDate(toDateKey(new Date())).filter(isUpcomingTodayEvent);
  renderEventList(els.todayList, items);
}

function isUpcomingTodayEvent(event) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const eventMinutes = timeToMinutes(event.end_time || event.start_time);
  return eventMinutes >= currentMinutes;
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

    const main = document.createElement("div");
    const time = document.createElement("strong");
    time.className = "event-time";
    time.textContent = formatTimeRange(item);

    const friend = document.createElement("span");
    friend.className = "event-friend";
    friend.textContent = item.friend_name;

    const memo = document.createElement("p");
    memo.className = "event-memo";
    memo.textContent = item.memo || "メモなし";

    main.append(time, friend);
    article.append(main, memo);
    button.appendChild(article);
    root.appendChild(button);
  });
}

function openEventDialog(dateKey, item = null) {
  els.dialogTitle.textContent = item ? "予定編集" : "予定追加";
  els.eventId.value = item?.id || "";
  els.eventDate.value = item?.event_date || dateKey;
  els.startTime.value = normalizeTime(item?.start_time) || "";
  els.endTime.value = normalizeTime(item?.end_time) || "";
  els.friendName.value = item?.friend_name || "";
  els.memo.value = item?.memo || "";
  els.deleteEventBtn.classList.toggle("hidden", !item);
  els.eventDialog.showModal();
}

function getEventsByDate(dateKey) {
  return state.events
    .filter((event) => event.event_date === dateKey)
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
  state.events.forEach((event) => {
    if (!event.start_time) return;

    const remindAt = new Date(`${event.event_date}T${normalizeTime(event.start_time)}`);
    remindAt.setMinutes(remindAt.getMinutes() - Number(event.reminder_minutes || 0));

    const diff = Math.abs(now.getTime() - remindAt.getTime());
    const key = `${event.id}:${event.event_date}:${event.start_time}`;
    if (diff <= 30000 && !state.notifiedKeys.has(key)) {
      state.notifiedKeys.add(key);
      new Notification("ゲーム予定の時間です", {
        body: `${formatTimeRange(event)} ${event.friend_name}`
      });
    }
  });
}

function formatTimeRange(event) {
  const start = normalizeTime(event.start_time);
  const end = normalizeTime(event.end_time);
  if (start && end) return `${start}-${end}`;
  if (start) return start;
  return "時間未設定";
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

function formatJapaneseDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
