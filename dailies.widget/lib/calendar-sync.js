// Keeps the calendar cache fresh and hands the cached feeds to the widget.
// Kept free of Übersicht imports: `run` and `dispatch` are passed in.
//
// Feeds are downloaded by bin/dailies-fetch.sh (which skips anything still
// fresh), so ticking every minute is cheap. The cache is read first so events
// show up immediately, then again after the downloads in case anything changed.

const TICK_MS = 60 * 1000

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
  const fetchOne = (c) =>
    run(`${locate}; bash "$s/dailies-fetch.sh" ${c.id} ${refreshMinutes} <<'DAILIES_URL'\n${c.url}\nDAILIES_URL\n`).catch(() => {})

  const tick = async () => {
    await Promise.all(calendars.map(fetchOne))
    await read()
  }

  read().then(tick)
  const timer = setInterval(tick, TICK_MS)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

module.exports = { startCalendarSync }
