const DAY = 86400000;
const firstMonth = "2000-01",
  lastMonth = "2099-12";
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
let sequence = 0;
const dayTime = (day) => Date.parse(`${day}T00:00:00Z`);
const isoDay = (time) => new Date(time).toISOString().slice(0, 10);
const validDay = (day) =>
  typeof day === "string" &&
  /^20\d{2}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(dayTime(day)) &&
  isoDay(dayTime(day)) === day;
export const todayJst = (now = Date.now()) => isoDay(Number(now) + 9 * 3600000);
export function validSchoolSelection(days) {
  return (
    Array.isArray(days) &&
    days.length <= 60 &&
    days.every((day, i) => validDay(day) && (!i || days[i - 1] < day)) &&
    (days.length < 2 || dayTime(days.at(-1)) - dayTime(days[0]) <= 180 * DAY)
  );
}
export function weekdayProposal(dueOn, now = Date.now()) {
  const due = typeof dueOn === "string" ? Date.parse(dueOn) : NaN;
  if (!Number.isFinite(due) || !Number.isFinite(Number(now))) return [];
  const first = todayJst(now),
    last = todayJst(due);
  if (!validDay(first) || !validDay(last)) return [];
  const start = dayTime(first),
    end = dayTime(last);
  if (end < start || end - start > 180 * DAY) return [];
  const days = [];
  for (let time = start; time <= end; time += DAY) {
    const weekday = new Date(time).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(isoDay(time));
  }
  return days.length <= 60 ? days : [];
}
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const monthAfter = (month, delta) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};
const daysInMonth = (month) =>
  new Date(dayTime(`${monthAfter(month, 1)}-01`) - DAY).getUTCDate();
const dayLabel = (day) => {
  const [year, month, date] = day.split("-").map(Number);
  return `${year}年${month}月${date}日`;
};

export function createSchoolCalendar({ onChange }) {
  const element = el("div", "burn-calendar");
  element.id = "burn-school-days";
  const headingId = `burn-calendar-month-${++sequence}`,
    header = el("div", "burn-calendar-header"),
    previous = el("button", "burn-calendar-nav", "‹"),
    heading = el("h3", "burn-calendar-month"),
    next = el("button", "burn-calendar-nav", "›"),
    grid = el("div", "burn-calendar-grid"),
    count = el("p", "burn-calendar-count"),
    warning = el("p", "burn-calendar-warning");
  heading.id = headingId;
  heading.setAttribute("aria-live", "polite");
  previous.type = next.type = "button";
  previous.setAttribute("aria-label", "前の月");
  next.setAttribute("aria-label", "次の月");
  header.append(previous, heading, next);
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-labelledby", headingId);
  grid.setAttribute("aria-multiselectable", "true");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  warning.setAttribute("role", "alert");
  warning.hidden = true;
  element.append(header, grid, count, warning);
  let days = [],
    month = null,
    focusedDay = null,
    disabled = false;

  function focus(day) {
    if (!validDay(day)) return;
    month = day.slice(0, 7);
    focusedDay = day;
    render(day);
  }
  function toggle(day) {
    if (disabled) return;
    const selected = new Set(days);
    if (selected.has(day)) selected.delete(day);
    else selected.add(day);
    const value = [...selected].sort();
    if (selected.has(day) && !validSchoolSelection(value)) {
      warning.textContent =
        "選べるのは60日まで、最初から最後まで180日以内です。選択中の日を解除して調整してください。";
      warning.hidden = false;
      return;
    }
    warning.hidden = true;
    days = value;
    focusedDay = day;
    render(day);
    onChange([...days]);
  }
  function shiftMonth(delta) {
    const target = monthAfter(month, delta);
    if (target < firstMonth || target > lastMonth) return;
    month = target;
    const date = Math.min(
      Number(focusedDay?.slice(8)) || 1,
      daysInMonth(month),
    );
    focusedDay = `${month}-${String(date).padStart(2, "0")}`;
    render();
  }
  previous.onclick = () => shiftMonth(-1);
  next.onclick = () => shiftMonth(1);
  grid.onkeydown = (event) => {
    const day = event.target?.dataset?.day;
    if (!day || disabled || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const time = dayTime(day),
      weekday = new Date(time).getUTCDay();
    let target;
    if (event.key === "ArrowLeft") target = isoDay(time - DAY);
    else if (event.key === "ArrowRight") target = isoDay(time + DAY);
    else if (event.key === "ArrowUp") target = isoDay(time - 7 * DAY);
    else if (event.key === "ArrowDown") target = isoDay(time + 7 * DAY);
    else if (event.key === "Home") target = isoDay(time - weekday * DAY);
    else if (event.key === "End") target = isoDay(time + (6 - weekday) * DAY);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const targetMonth = monthAfter(month, event.key === "PageUp" ? -1 : 1);
      target = `${targetMonth}-${String(Math.min(Number(day.slice(8)), daysInMonth(targetMonth))).padStart(2, "0")}`;
    } else return;
    event.preventDefault();
    focus(target);
  };

  function render(restoreFocus = null) {
    const activeDay = grid.contains(document.activeElement)
      ? document.activeElement.dataset.day
      : null;
    const today = todayJst(),
      selected = new Set(days),
      first = `${month}-01`,
      offset = new Date(dayTime(first)).getUTCDay(),
      length = daysInMonth(month);
    if (!focusedDay?.startsWith(month)) {
      focusedDay =
        days.find((day) => day.startsWith(month)) ||
        (today.startsWith(month) ? today : first);
    }
    element.dataset.month = month;
    heading.textContent = `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;
    previous.disabled = disabled || month === firstMonth;
    next.disabled = disabled || month === lastMonth;
    const weekdayRow = el("div", "burn-calendar-week");
    weekdayRow.setAttribute("role", "row");
    weekdays.forEach((name) => {
      const label = el("span", "burn-calendar-weekday", name);
      label.setAttribute("role", "columnheader");
      weekdayRow.append(label);
    });
    const rows = [weekdayRow];
    for (
      let index = 0;
      index < Math.ceil((offset + length) / 7) * 7;
      index += 7
    ) {
      const row = el("div", "burn-calendar-week");
      row.setAttribute("role", "row");
      for (let column = 0; column < 7; column++) {
        const number = index + column - offset + 1,
          cell = el("div", "burn-calendar-cell");
        cell.setAttribute("role", "gridcell");
        if (number >= 1 && number <= length) {
          const day = `${month}-${String(number).padStart(2, "0")}`,
            button = el("button", "burn-calendar-day"),
            numberLabel = el("span", null, String(number)),
            check = el("span", "burn-calendar-check", "✓");
          button.type = "button";
          button.dataset.day = day;
          button.setAttribute("aria-label", dayLabel(day));
          button.setAttribute("aria-pressed", String(selected.has(day)));
          cell.setAttribute("aria-selected", String(selected.has(day)));
          button.tabIndex = day === focusedDay ? 0 : -1;
          button.disabled = disabled;
          if (day === today) button.setAttribute("aria-current", "date");
          check.setAttribute("aria-hidden", "true");
          button.append(numberLabel, check);
          button.onclick = () => toggle(day);
          button.onfocus = () => {
            focusedDay = day;
            for (const candidate of grid.querySelectorAll("button[data-day]"))
              candidate.tabIndex = candidate === button ? 0 : -1;
          };
          cell.append(button);
        }
        row.append(cell);
      }
      rows.push(row);
    }
    grid.replaceChildren(...rows);
    count.textContent = `${days.length}日選択中`;
    const day = restoreFocus || activeDay;
    if (day?.startsWith(month))
      grid.querySelector(`[data-day="${day}"]`)?.focus({ preventScroll: true });
  }
  return {
    element,
    setState(state) {
      const nextDays = [...new Set((state.days || []).filter(validDay))].sort();
      if (JSON.stringify(nextDays) !== JSON.stringify(days))
        warning.hidden = true;
      days = nextDays;
      disabled = state.disabled === true;
      const proposed = state.month?.slice(0, 7);
      if (proposed && validDay(`${proposed}-01`)) {
        if (month !== proposed) warning.hidden = true;
        month = proposed;
      }
      if (!month) month = (days[0] || todayJst()).slice(0, 7);
      render();
    },
    focusDay: focus,
    get month() {
      return month;
    },
  };
}
