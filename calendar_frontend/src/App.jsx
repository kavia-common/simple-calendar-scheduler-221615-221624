import { useEffect, useMemo, useRef, useState } from 'react'
import { useTizenKeys } from './hooks/useTizenKeys'
import './index.css'
import './App.css'

/**
 * Local storage helpers with migration
 */
const STORAGE_KEY = 'calendar_events_v3' // bump for reminder schema
const LEGACY_KEYS = ['calendar_events_v2', 'calendar_events_v1']

// Keys for reminder preferences and dedupe persistence
const STORAGE_GLOBAL_REMINDERS = 'calendar_global_reminders_enabled'
const STORAGE_LAST_NOTIFIED = 'calendar_last_notified_map' // { [eventId]: timestamp }

/**
 * Event color mapping for Ocean Professional theme
 */
const TYPE_META = {
  meeting: {
    color: '#2563EB',
    bg: 'rgba(37,99,235,0.10)',
    border: 'rgba(37,99,235,0.35)',
    text: '#1e3a8a',
    icon: '👥',
    label: 'Meeting',
  },
  reminder: {
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.14)',
    border: 'rgba(245,158,11,0.45)',
    text: '#7c2d12',
    icon: '⏰',
    label: 'Reminder',
  },
  task: {
    color: '#6b7280',
    bg: 'rgba(107,114,128,0.14)',
    border: 'rgba(107,114,128,0.35)',
    text: '#374151',
    icon: '✔️',
    label: 'Task',
  },
}

/**
 * Utilities
 */

// PUBLIC_INTERFACE
function formatDateKey(date) {
  /** Returns YYYY-MM-DD for a Date input. */
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function getMonthGrid(date) {
  // Returns an array of 42 Date objects covering the 6-row month grid
  const start = startOfMonth(date)
  const end = endOfMonth(date)
  const startDay = start.getDay() // 0-6 (Sun-Sat)
  const daysInMonth = end.getDate()

  const leading = startDay
  const totalCells = 42
  const grid = []

  const prevMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0)
  const prevMonthDays = prevMonthEnd.getDate()

  for (let i = leading - 1; i >= 0; i--) {
    const day = prevMonthDays - i
    grid.push(new Date(date.getFullYear(), date.getMonth() - 1, day))
  }
  for (let d = 1; d <= daysInMonth; d++) {
    grid.push(new Date(date.getFullYear(), date.getMonth(), d))
  }
  const trailing = totalCells - grid.length
  for (let d = 1; d <= trailing; d++) {
    grid.push(new Date(date.getFullYear(), date.getMonth() + 1, d))
  }
  return grid
}

/**
 * Schema:
 * id, title, description, type ("meeting"|"reminder"|"task"),
 * startDateTime (ISO local), endDateTime? (ISO local), allDay? (boolean, default false),
 * reminderEnabled? (boolean), reminderMinutesBefore? (number; 5/10/15/30/60, default 10)
 */

function parseLegacy(recordsByDate) {
  // Legacy structure: { 'YYYY-MM-DD': [ { id?, title, desc, start, end } ] }
  const migrated = {}
  for (const [dateKey, list] of Object.entries(recordsByDate || {})) {
    const nextList = (list || []).map((ev) => {
      const id = ev.id || crypto.randomUUID()
      const title = ev.title ?? ''
      const description = ev.desc ?? ''
      const start = ev.start || '00:00'
      const end = ev.end || ''
      const type = ev.type || 'task'
      const allDay = Boolean(ev.allDay) || false
      const startDateTime = toLocalISO(dateKey, start)
      const endDateTime = end ? toLocalISO(dateKey, end) : undefined
      const reminderEnabled = ev.reminderEnabled ?? true
      const reminderMinutesBefore = normalizeReminderMinutes(ev.reminderMinutesBefore)
      return {
        id,
        title,
        description,
        type,
        startDateTime,
        endDateTime,
        allDay,
        reminderEnabled,
        reminderMinutesBefore,
      }
    })
    if (nextList.length) migrated[dateKey] = nextList
  }
  return migrated
}

function normalizeReminderMinutes(val) {
  const allowed = [5, 10, 15, 30, 60]
  const n = Number(val)
  if (allowed.includes(n)) return n
  return 10
}

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)

    // Try legacy keys and migrate
    for (const k of LEGACY_KEYS) {
      const legacyRaw = localStorage.getItem(k)
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw)
        const migrated = parseLegacy(legacy)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        return migrated
      }
    }
    return {}
  } catch {
    return {}
  }
}

function saveEvents(eventsByDate) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(eventsByDate))
  } catch {
    // ignore
  }
}

/**
 * Time helpers (timezone-safe local handling)
 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

function toLocalISO(dateKey, timeHHMM) {
  // Constructs ISO string using local time, not UTC adjusted.
  const [year, month, day] = dateKey.split('-').map(Number)
  let h = 0, m = 0
  if (timeHHMM) {
    const [hh, mm] = timeHHMM.split(':')
    h = Number(hh) || 0
    m = Number(mm) || 0
  }
  const d = new Date(year, month - 1, day, h, m, 0, 0)
  // Build ISO without timezone shift by constructing from local components
  const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
  return iso
}

function fromISOtoTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function sortByStart(a, b) {
  if (a.allDay && !b.allDay) return -1
  if (!a.allDay && b.allDay) return 1
  const ta = a.startDateTime || ''
  const tb = b.startDateTime || ''
  return ta.localeCompare(tb)
}

function useEvents() {
  const [eventsByDate, setEventsByDate] = useState(() => loadEvents())

  useEffect(() => {
    saveEvents(eventsByDate)
  }, [eventsByDate])

  const addEvent = (dateKey, event) => {
    setEventsByDate(prev => {
      const list = prev[dateKey] ? [...prev[dateKey]] : []
      // default reminder settings for new events
      const withDefaults = {
        reminderEnabled: event.reminderEnabled ?? true,
        reminderMinutesBefore: normalizeReminderMinutes(event.reminderMinutesBefore),
      }
      const withId = { ...{ reminderMinutesBefore: 10 }, ...event, ...withDefaults, id: crypto.randomUUID() }
      const next = { ...prev, [dateKey]: [...list, withId] }
      return next
    })
  }

  const updateEvent = (dateKey, eventId, updates) => {
    setEventsByDate(prev => {
      const list = prev[dateKey] ? [...prev[dateKey]] : []
      const idx = list.findIndex(e => e.id === eventId)
      if (idx === -1) return prev
      const normalized = { ...updates }
      if ('reminderMinutesBefore' in normalized) {
        normalized.reminderMinutesBefore = normalizeReminderMinutes(normalized.reminderMinutesBefore)
      }
      if ('reminderEnabled' in normalized) {
        normalized.reminderEnabled = Boolean(normalized.reminderEnabled)
      }
      list[idx] = { ...{ reminderEnabled: true, reminderMinutesBefore: 10 }, ...list[idx], ...normalized }
      return { ...prev, [dateKey]: list }
    })
  }

  const deleteEvent = (dateKey, eventId) => {
    setEventsByDate(prev => {
      const list = prev[dateKey] ? prev[dateKey].filter(e => e.id !== eventId) : []
      const next = { ...prev }
      if (list.length) next[dateKey] = list
      else delete next[dateKey]
      return next
    })
  }

  return { eventsByDate, addEvent, updateEvent, deleteEvent }
}

/**
 * Header with month navigation, type filter chips, and global reminders toggle
 */
function Header({ currentMonth, onPrev, onNext, filters, onToggle, remindersEnabled, onToggleReminders }) {
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }),
    []
  )
  const chips = [
    { key: 'meeting', meta: TYPE_META.meeting },
    { key: 'reminder', meta: TYPE_META.reminder },
    { key: 'task', meta: TYPE_META.task },
  ]
  return (
    <header className="header surface shadow">
      <button aria-label="Previous month" className="icon-btn" onClick={onPrev}>
        ‹
      </button>
      <div className="title">
        {monthFormatter.format(currentMonth)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <div className="bell-wrap">
          <button
            aria-label={remindersEnabled ? 'Disable reminders' : 'Enable reminders'}
            className={`bell-btn ${remindersEnabled ? 'on' : 'off'}`}
            onClick={onToggleReminders}
            title={`${remindersEnabled ? 'Disable' : 'Enable'} reminders`}
          >
            {remindersEnabled ? '🔔' : '🔕'}
          </button>
          <div className="bell-dropdown">
            <div className="bell-row">
              <span>Reminders</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={remindersEnabled}
                  onChange={onToggleReminders}
                  aria-label="Toggle reminders globally"
                />
                <span className="slider" />
              </label>
            </div>
            <div className="bell-hint">Alert before events across sessions</div>
          </div>
        </div>
      </div>

      <div className="filters">
        <span className="legend-label">Show:</span>
        {chips.map(c => {
          const active = filters[c.key]
          return (
            <button
              key={c.key}
              className={`chip filter ${active ? 'active' : ''}`}
              onClick={() => onToggle(c.key)}
              title={`${active ? 'Hide' : 'Show'} ${c.meta.label}s`}
              style={{
                borderColor: active ? c.meta.border : 'rgba(17,24,39,0.15)',
                background: active ? c.meta.bg : '#fff',
                color: active ? c.meta.text : 'inherit',
              }}
            >
              <span className="dot" style={{ background: c.meta.color }} />
              {c.meta.icon} {c.meta.label}
            </button>
          )
        })}
      </div>
    </header>
  )
}

/**
 * Event Modal (Add/Edit)
 */
function EventModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialDate,
  initialEvent,
}) {
  const dateKey = initialDate ? formatDateKey(initialDate) : ''
  const [title, setTitle] = useState(initialEvent?.title || '')
  const [description, setDescription] = useState(initialEvent?.description || '')
  const [type, setType] = useState(initialEvent?.type || 'task')
  const [date, setDate] = useState(dateKey)
  const [startTime, setStartTime] = useState(initialEvent?.startDateTime ? fromISOtoTime(initialEvent.startDateTime) : '09:00')
  const [endTime, setEndTime] = useState(initialEvent?.endDateTime ? fromISOtoTime(initialEvent.endDateTime) : '')
  const [allDay, setAllDay] = useState(Boolean(initialEvent?.allDay) || false)
  const [error, setError] = useState('')
  const firstFieldRef = useRef(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reminder fields
  const [reminderEnabled, setReminderEnabled] = useState(
    initialEvent?.reminderEnabled ?? true
  )
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState(
    normalizeReminderMinutes(initialEvent?.reminderMinutesBefore)
  )

  useEffect(() => {
    if (isOpen) {
      const dk = initialDate ? formatDateKey(initialDate) : ''
      setDate(dk)
      setTitle(initialEvent?.title || '')
      setDescription(initialEvent?.description || '')
      setType(initialEvent?.type || 'task')
      setAllDay(Boolean(initialEvent?.allDay) || false)
      setStartTime(initialEvent?.startDateTime ? fromISOtoTime(initialEvent.startDateTime) : '09:00')
      setEndTime(initialEvent?.endDateTime ? fromISOtoTime(initialEvent.endDateTime) : '')
      setError('')
      setConfirmDelete(false)

      setReminderEnabled(initialEvent?.reminderEnabled ?? true)
      setReminderMinutesBefore(normalizeReminderMinutes(initialEvent?.reminderMinutesBefore))

      setTimeout(() => firstFieldRef.current?.focus(), 0)
    }
  }, [isOpen, initialDate, initialEvent])

  useEffect(() => {
    function onKey(e) {
      if (!isOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        // Only trigger save when not confirming delete
        if (!confirmDelete) {
          const fake = { preventDefault() {} }
          handleSubmit(fake)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, title, description, type, date, startTime, endTime, allDay, confirmDelete, reminderEnabled, reminderMinutesBefore])

  if (!isOpen) return null

  const validate = () => {
    if (!title.trim()) return 'Title is required'
    if (!date) return 'Date is required'
    if (!allDay && !startTime) return 'Start time is required'
    if (startTime && endTime) {
      const s = toLocalISO(date, startTime)
      const e = toLocalISO(date, endTime)
      if (e < s) return 'End time must be after start time'
    }
    if (reminderEnabled) {
      const allowed = [5, 10, 15, 30, 60]
      if (!allowed.includes(Number(reminderMinutesBefore))) {
        return 'Invalid reminder minutes'
      }
    }
    return ''
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    const startDateTime = allDay ? toLocalISO(date, '00:00') : toLocalISO(date, startTime)
    const endDateTime = endTime ? toLocalISO(date, endTime) : undefined
    onSave({
      title: title.trim(),
      description: description.trim(),
      type,
      startDateTime,
      endDateTime,
      allDay,
      reminderEnabled,
      reminderMinutesBefore: normalizeReminderMinutes(reminderMinutesBefore),
    })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Event editor">
      <div className="modal surface shadow">
        <div className="modal-header">
          <h2 className="modal-title">
            {initialEvent ? 'Edit Event' : 'Add Event'}
          </h2>
          <button className="close-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              ref={firstFieldRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              required
            />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="meeting">Meeting</option>
                <option value="reminder">Reminder</option>
                <option value="task">Task</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="date">Date</label>
              <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="start">Start Time</label>
              <input id="start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} required={!allDay} />
            </div>
            <div className="field">
              <label htmlFor="end">End Time (optional)</label>
              <input id="end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={allDay} />
            </div>
          </div>

          <div className="field toggle">
            <label htmlFor="allday">All-day</label>
            <div className="toggle-wrap">
              <input id="allday" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              <span className="hint">No time range when enabled</span>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Reminder</label>
              <div className="toggle-wrap">
                <input
                  id="reminderEnabled"
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => setReminderEnabled(e.target.checked)}
                />
                <span className="hint">Enable alert before start</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="reminderMinutes">Minutes before</label>
              <select
                id="reminderMinutes"
                value={reminderMinutesBefore}
                onChange={(e) => setReminderMinutesBefore(Number(e.target.value))}
                disabled={!reminderEnabled}
              >
                {[5, 10, 15, 30, 60].map(m => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="desc">Description</label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <div className="modal-footer">
            {onDelete && (
              <>
                {!confirmDelete ? (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Delete event"
                  >
                    Delete
                  </button>
                ) : (
                  <>
                    <span role="status" aria-live="polite" className="confirm-text">Confirm delete?</span>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => {
                        setConfirmDelete(false)
                        onDelete()
                      }}
                      aria-label="Confirm delete event"
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setConfirmDelete(false)}
                      aria-label="Cancel delete"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </>
            )}
            <div className="spacer" />
            <button type="button" className="btn ghost" onClick={onClose} aria-label="Cancel editing">
              Cancel
            </button>
            <button type="submit" className="btn primary" aria-label={initialEvent ? 'Save event' : 'Add event'}>
              {initialEvent ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Calendar grid
 */
function CalendarGrid({
  monthDate,
  eventsByDate,
  onDayClick,
  onEventClick,
  filters,
}) {
  const grid = useMemo(() => getMonthGrid(monthDate), [monthDate])
  const month = monthDate.getMonth()
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  return (
    <div className="calendar">
      <div className="dow">
        {dow.map(d => (
          <div key={d} className="dow-cell">{d}</div>
        ))}
      </div>
      <div className="grid">
        {grid.map((d, i) => {
          const key = formatDateKey(d)
          const inMonth = d.getMonth() === month
          const dayEvents = (eventsByDate[key] || [])
            .filter(ev => filters[ev.type] !== false)
            .slice()
            .sort(sortByStart)

          return (
            <div
              key={key + i}
              className={`cell ${inMonth ? '' : 'muted'}`}
              onClick={() => onDayClick(d)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onDayClick(d)}
              aria-label={`Day ${d.getDate()} ${inMonth ? '' : '(adjacent month)'}`}
            >
              <div className="cell-header">
                <span className="date">{d.getDate()}</span>
                <button
                  className="add-btn"
                  aria-label="Add event"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDayClick(d)
                  }}
                >
                  +
                </button>
              </div>
              <div className="events">
                {dayEvents.map(ev => {
                  const meta = TYPE_META[ev.type] || TYPE_META.task
                  const startLabel = ev.allDay ? 'All day' : (ev.startDateTime ? fromISOtoTime(ev.startDateTime) : '')
                  const endLabel = (!ev.allDay && ev.endDateTime) ? fromISOtoTime(ev.endDateTime) : ''
                  const timeLabel = ev.allDay ? 'All day' : `${startLabel}${endLabel ? `–${endLabel}` : ''}`
                  const titleAttr = `${meta.label} ${timeLabel} ${ev.title}`
                  return (
                    <button
                      key={ev.id}
                      className="event chip"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick(d, ev)
                      }}
                      title={titleAttr}
                      style={{
                        background: `linear-gradient(90deg, ${meta.bg}, rgba(255,255,255,0.96))`,
                        borderColor: meta.border,
                        color: meta.text,
                      }}
                      aria-label={`${meta.label} ${ev.title} ${timeLabel}. Click to edit.`}
                    >
                      <span className="type-icon" title={meta.label}>{meta.icon}</span>
                      <span className="time">{timeLabel}</span>
                      <span className="sep">•</span>
                      <span className="label">{ev.title}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function readLastNotifiedMap() {
  try {
    const raw = localStorage.getItem(STORAGE_LAST_NOTIFIED)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

function writeLastNotifiedMap(map) {
  try {
    localStorage.setItem(STORAGE_LAST_NOTIFIED, JSON.stringify(map))
  } catch { /* ignore */ }
}

function App() {
  const [monthDate, setMonthDate] = useState(startOfMonth(new Date()))
  const { eventsByDate, addEvent, updateEvent, deleteEvent } = useEvents()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState(null)
  const [editingEvent, setEditingEvent] = useState(null)
  const [filters, setFilters] = useState({ meeting: true, reminder: true, task: true })

  // Global reminders enabled
  const [remindersEnabled, setRemindersEnabled] = useState(() => {
    const raw = localStorage.getItem(STORAGE_GLOBAL_REMINDERS)
    if (raw === null) return true
    return raw === 'true'
  })

  // Toast state
  const [toasts, setToasts] = useState([]) // [{id, eventId, title, timeLabel, type, color}]
  const notifiedIdsRef = useRef(new Set()) // in-session dedupe
  const lastNotifiedMapRef = useRef(readLastNotifiedMap())

  useTizenKeys({
    onLeft: () => setMonthDate(d => addMonths(d, -1)),
    onRight: () => setMonthDate(d => addMonths(d, 1)),
    onBack: () => setModalOpen(false),
  })

  const openNewEventModal = (date) => {
    setModalDate(date)
    setEditingEvent(null)
    setModalOpen(true)
  }

  const openEditEventModal = (date, event) => {
    setModalDate(date)
    setEditingEvent(event)
    setModalOpen(true)
  }

  const handleSave = (payload) => {
    const key = payload.startDateTime
      ? `${new Date(payload.startDateTime).getFullYear()}-${pad2(new Date(payload.startDateTime).getMonth()+1)}-${pad2(new Date(payload.startDateTime).getDate())}`
      : (modalDate ? formatDateKey(modalDate) : '')
    if (!key) return

    if (editingEvent) {
      // Handle possible date change: move across date buckets while preserving id
      const oldKey = editingEvent.startDateTime
        ? `${new Date(editingEvent.startDateTime).getFullYear()}-${pad2(new Date(editingEvent.startDateTime).getMonth()+1)}-${pad2(new Date(editingEvent.startDateTime).getDate())}`
        : (modalDate ? formatDateKey(modalDate) : key)

      if (oldKey !== key) {
        // remove from old bucket
        deleteEvent(oldKey, editingEvent.id)
        // add in new bucket with same id to preserve identity
        const next = { ...eventsByDate }
        const list = next[key] ? [...next[key]] : []
        list.push({ ...payload, id: editingEvent.id })
        next[key] = list
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      } else {
        updateEvent(key, editingEvent.id, payload)
      }
    } else {
      addEvent(key, payload)
    }
    setModalOpen(false)
  }

  const handleDelete = () => {
    if (!editingEvent) return
    const key = editingEvent.startDateTime
      ? `${new Date(editingEvent.startDateTime).getFullYear()}-${pad2(new Date(editingEvent.startDateTime).getMonth()+1)}-${pad2(new Date(editingEvent.startDateTime).getDate())}`
      : (modalDate ? formatDateKey(modalDate) : '')
    if (!key) return
    deleteEvent(key, editingEvent.id)
    setModalOpen(false)
  }

  const toggleFilter = (key) => {
    setFilters(f => ({ ...f, [key]: !f[key] }))
  }

  const toggleReminders = () => {
    setRemindersEnabled(prev => {
      const next = !prev
      try { localStorage.setItem(STORAGE_GLOBAL_REMINDERS, String(next)) } catch {}
      return next
    })
  }

  // Build flat list of future events for scheduler
  const flatEvents = useMemo(() => {
    const arr = []
    const now = new Date()
    Object.entries(eventsByDate).forEach(([dateKey, list]) => {
      for (const ev of list || []) {
        // Allow reminders for meetings/tasks/reminders by default
        // Skip events with no start or in the past (start < now)
        if (!ev.startDateTime) continue
        const start = new Date(ev.startDateTime)
        if (isNaN(start.getTime())) continue
        // Only consider future or upcoming events (including those within reminder window)
        if (start.getTime() < now.getTime()) continue
        const reminderEnabled = ev.reminderEnabled ?? true
        const reminderMinutesBefore = normalizeReminderMinutes(ev.reminderMinutesBefore)
        arr.push({
          ...ev,
          dateKey,
          reminderEnabled,
          reminderMinutesBefore,
        })
      }
    })
    return arr
  }, [eventsByDate])

  // Scheduler scanning every 30s
  useEffect(() => {
    function tick() {
      if (!remindersEnabled) return
      const now = new Date()
      const lastNotified = lastNotifiedMapRef.current || {}

      for (const ev of flatEvents) {
        if (!ev.reminderEnabled) continue
        const start = new Date(ev.startDateTime)
        const remindMs = (ev.reminderMinutesBefore ?? 10) * 60 * 1000
        const triggerAt = new Date(start.getTime() - remindMs)

        if (now.getTime() >= triggerAt.getTime()) {
          // Deduping: per-session and persisted
          if (notifiedIdsRef.current.has(ev.id)) continue
          const lastTs = lastNotified[ev.id]
          if (lastTs) {
            // If previously notified inside this same window (triggerAt..start), skip
            const lastDate = new Date(lastTs)
            if (lastDate.getTime() >= triggerAt.getTime() && lastDate.getTime() <= start.getTime()) {
              continue
            }
          }

          // Trigger toast
          const meta = TYPE_META[ev.type] || TYPE_META.task
          const startLabel = ev.allDay ? 'All day' : (ev.startDateTime ? fromISOtoTime(ev.startDateTime) : '')
          const toastId = `${ev.id}-${Date.now()}`
          setToasts(prev => [
            ...prev,
            {
              id: toastId,
              eventId: ev.id,
              title: ev.title,
              type: ev.type,
              color: meta.color,
              timeLabel: ev.allDay ? 'All day' : startLabel,
              dateKey: ev.dateKey,
            },
          ])

          // Mark as notified
          notifiedIdsRef.current.add(ev.id)
          const updated = { ...lastNotified, [ev.id]: new Date().toISOString() }
          lastNotifiedMapRef.current = updated
          writeLastNotifiedMap(updated)
        }
      }
    }

    // initial check quickly, then every 30s
    const initialTimer = setTimeout(tick, 300)
    const interval = setInterval(tick, 30000)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [flatEvents, remindersEnabled])

  const dismissToast = (tid) => {
    setToasts(prev => prev.filter(t => t.id !== tid))
  }

  const openEventFromToast = (toast) => {
    // find event by id to open editor
    const lists = Object.entries(eventsByDate)
    for (const [dk, list] of lists) {
      const ev = (list || []).find(e => e.id === toast.eventId)
      if (ev) {
        setModalDate(new Date(ev.startDateTime))
        setEditingEvent(ev)
        setModalOpen(true)
        break
      }
    }
    // also dismiss toast
    dismissToast(toast.id)
  }

  return (
    <div className="app-root">
      <Header
        currentMonth={monthDate}
        onPrev={() => setMonthDate(d => addMonths(d, -1))}
        onNext={() => setMonthDate(d => addMonths(d, 1))}
        filters={filters}
        onToggle={toggleFilter}
        remindersEnabled={remindersEnabled}
        onToggleReminders={toggleReminders}
      />
      <main className="main">
        <CalendarGrid
          monthDate={monthDate}
          eventsByDate={eventsByDate}
          onDayClick={openNewEventModal}
          onEventClick={openEditEventModal}
          filters={filters}
        />
      </main>

      {/* Toast container */}
      <div className="toast-container">
        {toasts.map(t => {
          const meta = TYPE_META[t.type] || TYPE_META.task
          return (
            <div key={t.id} className="toast shadow" style={{ borderLeftColor: meta.color }}>
              <div className="toast-icon" aria-hidden="true">{meta.icon}</div>
              <div className="toast-body">
                <div className="toast-title">{t.title}</div>
                <div className="toast-sub">
                  <span className="dot" style={{ background: meta.color }} />
                  <span className="toast-type">{meta.label}</span>
                  <span className="toast-sep">•</span>
                  <span className="toast-time">{t.timeLabel}</span>
                </div>
              </div>
              <div className="toast-actions">
                <button className="btn ghost sm" onClick={() => dismissToast(t.id)}>Dismiss</button>
                <button className="btn primary sm" onClick={() => openEventFromToast(t)}>Open Event</button>
              </div>
            </div>
          )
        })}
      </div>

      <EventModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={editingEvent ? handleDelete : undefined}
        initialDate={modalDate}
        initialEvent={editingEvent || null}
      />
    </div>
  )
}

export default App
