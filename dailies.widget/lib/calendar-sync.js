// Keeps the calendar cache fresh and hands the cached feeds to the widget.
// Kept free of Übersicht imports: `run` and `dispatch` are passed in.
//
// Feeds are downloaded by bin/dailies-fetch.sh (which skips anything still
// fresh), so ticking every minute is cheap. The cache is read first so events
// show up immediately, then again after the downloads in case anything changed.

const TICK_MS = 60 * 1000
const MIN_BUSY_MS = 700 // so a quick refresh still visibly acknowledges the click

// Returns { stop, refresh }. refresh() re-downloads every feed right now,
// ignoring the cache age and any failure back-off, and reports progress with
// DAILIES/REFRESHING events so the widget can spin its button.
function startCalendarSync({ run, dispatch, locate, calendars, refreshMinutes }) {
  let last = null
  let stopped = false

  const read = () =>
    run(`${locate}; bash "$s/dailies-calendars.sh"`)
      .then((output) => {
        if (stopped || output === last) return
        last = output
        dispatch({ type: 'DAILIES/CALENDARS', output })
      })
      .catch(() => {})

  // The URL goes in on stdin (a quoted heredoc: no escaping needed, and it
  // never appears in a process list). core.normalizeCalendars has already
  // rejected URLs containing whitespace or quotes.
  const fetchOne = (c, force) =>
    run(
      `${locate}; bash "$s/dailies-fetch.sh" ${c.id} ${refreshMinutes}${force ? ' force' : ''} <<'DAILIES_URL'\n${c.url}\nDAILIES_URL\n`,
    ).catch(() => {})

  const tick = async () => {
    await Promise.all(calendars.map((c) => fetchOne(c, false)))
    await read()
  }

  let busy = false
  const refresh = async () => {
    if (busy || stopped) return
    busy = true
    dispatch({ type: 'DAILIES/REFRESHING', busy: true })
    try {
      await Promise.all([
        Promise.all(calendars.map((c) => fetchOne(c, true))).then(read),
        new Promise((resolve) => setTimeout(resolve, MIN_BUSY_MS)),
      ])
    } finally {
      busy = false
      if (!stopped) dispatch({ type: 'DAILIES/REFRESHING', busy: false })
    }
  }

  read().then(tick)
  const timer = setInterval(tick, TICK_MS)
  const stop = () => {
    stopped = true
    clearInterval(timer)
  }
  return { stop, refresh }
}

module.exports = { startCalendarSync }
