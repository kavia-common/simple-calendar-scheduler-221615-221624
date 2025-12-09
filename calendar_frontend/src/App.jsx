import { useEffect, useMemo, useRef, useState } from 'react'
import { useTizenKeys } from './hooks/useTizenKeys'
import './index.css'
import './App.css'

/**
 * Local storage helpers
 */
const STORAGE_KEY = 'calendar_events_v1'

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
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

  // Compute leading days (from previous month)
  const leading = startDay // number of leading empty cells
  const totalCells = 42
  const grid = []

  // Previous month end
  const prevMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0) // Last day of prev month
  const prevMonthDays = prevMonthEnd.getDate()

  // Fill leading
  for (let i = leading - 1; i >= 0; i--) {
    const day = prevMonthDays - i
    grid.push(new Date(date.getFullYear(), date.getMonth() - 1, day))
  }

  // Fill current month
  for (let d = 1; d <= daysInMonth; d++) {
    grid.push(new Date(date.getFullYear(), date.getMonth(), d))
  }

  // Fill trailing to complete 42
  const trailing = totalCells - grid.length
  for (let d = 1; d <= trailing; d++) {
    grid.push(new Date(date.getFullYear(), date.getMonth() + 1, d))
  }

  return grid
}

function useEvents() {
  const [eventsByDate, setEventsByDate] = useState(() => loadEvents())

  useEffect(() => {
    saveEvents(eventsByDate)
  }, [eventsByDate])

  const addEvent = (dateKey, event) => {
    setEventsByDate(prev => {
      const list = prev[dateKey] ? [...prev[dateKey]] : []
      const withId = { ...event, id: crypto.randomUUID() }
      const next = { ...prev, [dateKey]: [...list, withId] }
      return next
    })
  }

  const updateEvent = (dateKey, eventId, updates) => {
    setEventsByDate(prev => {
      const list = prev[dateKey] ? [...prev[dateKey]] : []
      const idx = list.findIndex(e => e.id === eventId)
      if (idx === -1) return prev
      list[idx] = { ...list[idx], ...updates }
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
 * Header with month navigation
 */
function Header({ currentMonth, onPrev, onNext }) {
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }),
    []
  )
  return (
    <header className="header surface shadow">
      <button aria-label="Previous month" className="icon-btn" onClick={onPrev}>
        ‹
      </button>
      <h1 className="title">{monthFormatter.format(currentMonth)}</h1>
      <button aria-label="Next month" className="icon-btn" onClick={onNext}>
        ›
      </button>
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
  const [title, setTitle] = useState(initialEvent?.title || '')
  const [desc, setDesc] = useState(initialEvent?.desc || '')
  const [start, setStart] = useState(initialEvent?.start || '09:00')
  const [end, setEnd] = useState(initialEvent?.end || '10:00')
  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setTitle(initialEvent?.title || '')
      setDesc(initialEvent?.desc || '')
      setStart(initialEvent?.start || '09:00')
      setEnd(initialEvent?.end || '10:00')
      setTimeout(() => firstFieldRef.current?.focus(), 0)
    }
  }, [isOpen, initialEvent])

  useEffect(() => {
    function onKey(e) {
      if (!isOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      desc: desc.trim(),
      start,
      end,
    })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Event editor">
      <div ref={dialogRef} className="modal surface shadow">
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
            />
          </div>
          <div className="field">
            <label htmlFor="desc">Notes</label>
            <textarea
              id="desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional notes"
              rows={3}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="start">Start</label>
              <input
                id="start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="end">End</label>
              <input
                id="end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            {onDelete && (
              <button
                type="button"
                className="btn danger"
                onClick={onDelete}
                aria-label="Delete event"
              >
                Delete
              </button>
            )}
            <div className="spacer" />
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
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
          const dayEvents = eventsByDate[key] || []

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
                {dayEvents.map(ev => (
                  <button
                    key={ev.id}
                    className="event chip"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick(d, ev)
                    }}
                    title={`${ev.start} - ${ev.end} ${ev.title}`}
                  >
                    <span className="time">{ev.start}</span>
                    <span className="sep">•</span>
                    <span className="label">{ev.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function App() {
  const [monthDate, setMonthDate] = useState(startOfMonth(new Date()))
  const { eventsByDate, addEvent, updateEvent, deleteEvent } = useEvents()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState(null)
  const [editingEvent, setEditingEvent] = useState(null)

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
    const key = formatDateKey(modalDate)
    if (editingEvent) {
      updateEvent(key, editingEvent.id, payload)
    } else {
      addEvent(key, payload)
    }
    setModalOpen(false)
  }

  const handleDelete = () => {
    if (!editingEvent || !modalDate) return
    deleteEvent(formatDateKey(modalDate), editingEvent.id)
    setModalOpen(false)
  }

  return (
    <div className="app-root">
      <Header
        currentMonth={monthDate}
        onPrev={() => setMonthDate(d => addMonths(d, -1))}
        onNext={() => setMonthDate(d => addMonths(d, 1))}
      />
      <main className="main">
        <CalendarGrid
          monthDate={monthDate}
          eventsByDate={eventsByDate}
          onDayClick={openNewEventModal}
          onEventClick={openEditEventModal}
        />
      </main>

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
