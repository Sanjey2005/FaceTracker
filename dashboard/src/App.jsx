import { useState, useEffect, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  RadialBarChart, RadialBar,
} from 'recharts'
import './App.css'

const API = 'http://localhost:8000'
const CORRECT_PIN = '1234'

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem('ft_authenticated') === 'true')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)

  const handlePinSubmit = () => {
    if (pin === CORRECT_PIN) {
      localStorage.setItem('ft_authenticated', 'true')
      setAuthenticated(true)
      setPin('')
      setPinError(false)
    } else {
      setPinError(true)
      setPin('')
    }
  }

  const handleLock = () => {
    localStorage.removeItem('ft_authenticated')
    setAuthenticated(false)
    setPinError(false)
    setPin('')
  }

  const [stats, setStats] = useState({ total_visitors: 0, today_visitors: 0, currently_inside: 0, avg_dwell_secs: null })
  const [events, setEvents] = useState([])
  const [hourlyData, setHourlyData] = useState([])
  const [demographics, setDemographics] = useState({ Male: 0, Female: 0 })

  const [activePage, setActivePage] = useState('dashboard')
  const [chartView, setChartView] = useState('day')
  const [weeklyData, setWeeklyData] = useState([])

  // Multi-camera wizard state
  const [cameras, setCameras] = useState([])
  const [numCameras, setNumCameras] = useState(null)
  const [activeCam, setActiveCam] = useState(null)
  const [autoFollow, setAutoFollow] = useState(false)
  const [featuredCamera, setFeaturedCamera] = useState(null)
  const [feedFlashing, setFeedFlashing] = useState(false)

  // Person search state
  const [targetStatus, setTargetStatus] = useState(null)  // null | 'found' | 'searching'
  const [targetFaceId, setTargetFaceId] = useState(null)
  const [targetPhotoCount, setTargetPhotoCount] = useState(0)

  // Dashboard Live Cameras tile state (synced from localStorage)
  const [dashboardSavedCameras, setDashboardSavedCameras] = useState(() =>
    JSON.parse(localStorage.getItem('ft_saved_cameras') || '[]')
  )

  // Notifications (tracking events — used for internal badge only)
  const [alerts, setAlerts] = useState([])
  const [showAlerts, setShowAlerts] = useState(false)
  const alertsRef = useRef(null)
  const lastEventTimestampRef = useRef(null)
  const liveFeedRef = useRef(null)
  // Analytics page pagination
  const [eventsPage, setEventsPage] = useState(0)
  // Settings page re-render trigger
  const [settingsTick, setSettingsTick] = useState(0)

  // Watchlist page state
  const [watchlistEntries, setWatchlistEntries] = useState([])
  const [showAddPersonModal, setShowAddPersonModal] = useState(false)
  const [addPersonName, setAddPersonName] = useState('')
  const [addPersonFile, setAddPersonFile] = useState(null)
  const [addPersonPreview, setAddPersonPreview] = useState(null)
  const [addPersonLoading, setAddPersonLoading] = useState(false)
  const [addPersonError, setAddPersonError] = useState('')

  // Watchlist alerts — polled from /alerts?unacknowledged_only=true every 5s
  const [watchlistAlerts, setWatchlistAlerts] = useState([])

  const fetchAll = async () => {
    try {
      const [s, e, h, d] = await Promise.all([
        fetch(`${API}/stats`).then(r => r.json()),
        fetch(`${API}/events`).then(r => r.json()),
        fetch(`${API}/hourly`).then(r => r.json()),
        fetch(`${API}/demographics`).then(r => r.json()),
      ])
      setStats(s)
      setEvents(e)
      setHourlyData(h)
      setDemographics(d)
      return e
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    const doFetch = async () => {
      const newEvts = await fetchAll()
      if (!newEvts) return
      if (lastEventTimestampRef.current !== null && newEvts.length > 0) {
        const freshOnes = newEvts.filter(ev => ev.timestamp > lastEventTimestampRef.current)
        if (freshOnes.length > 0) {
          setAlerts(prev => {
            const added = freshOnes.map(ev => ({
              id: `${ev.face_id}-${ev.timestamp}`,
              message: `${ev.event_type} detected: #FT-${ev.face_id.slice(0, 5).toUpperCase()}`,
              time: ev.timestamp,
              read: false,
            }))
            return [...added, ...prev].slice(0, 10)
          })
        }
      }
      if (newEvts.length > 0) lastEventTimestampRef.current = newEvts[0].timestamp
    }
    doFetch()
    const id = setInterval(doFetch, 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (chartView === 'week') {
      fetch(`${API}/hourly?range=week`).then(r => r.json()).then(setWeeklyData).catch(console.error)
    }
  }, [chartView])

  // Auto-scroll live event feed to top when new events arrive
  useEffect(() => {
    if (liveFeedRef.current) liveFeedRef.current.scrollTop = 0
  }, [events])

  // Poll watchlist alerts every 5s
  useEffect(() => {
    const fetchWatchlistAlerts = async () => {
      try {
        const res = await fetch(`${API}/alerts?unacknowledged_only=true`)
        if (res.ok) setWatchlistAlerts(await res.json())
      } catch (err) { console.error('Watchlist alerts poll failed', err) }
    }
    fetchWatchlistAlerts()
    const id = setInterval(fetchWatchlistAlerts, 5000)
    return () => clearInterval(id)
  }, [])

  // Close alerts dropdown when clicking outside it
  useEffect(() => {
    if (!showAlerts) return
    const handleClickOutside = (e) => {
      if (alertsRef.current && !alertsRef.current.contains(e.target)) {
        setShowAlerts(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAlerts])

  // Re-sync dashboard camera tiles from localStorage when returning to dashboard
  // Also fetch watchlist entries when navigating to watchlist page
  useEffect(() => {
    if (activePage === 'dashboard') {
      setDashboardSavedCameras(JSON.parse(localStorage.getItem('ft_saved_cameras') || '[]'))
    }
    if (activePage === 'watchlist') {
      fetch(`${API}/watchlist`).then(r => r.json()).then(setWatchlistEntries).catch(console.error)
    }
  }, [activePage])

  // Auto-follow: poll /search/active-camera every 2s when enabled
  useEffect(() => {
    if (!autoFollow) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/search/active-camera`)
        const data = await res.json()
        if (data.active_camera && data.active_camera !== activeCam) {
          setActiveCam(data.active_camera)
        }
        if (data.active_camera && data.active_camera !== featuredCamera) {
          setFeaturedCamera(data.active_camera)
          setFeedFlashing(true)
          setTimeout(() => setFeedFlashing(false), 1000)
        }
      } catch (err) {
        console.error('Auto-follow poll failed', err)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [autoFollow, activeCam, featuredCamera])

  const anyRunning = cameras.some(c => c.status === 'running')
  const activeCamObj = cameras.find(c => c.id === activeCam)

  // ── Camera wizard handlers ──

  const handleSelectCount = (n) => {
    setNumCameras(n)
    setCameras(Array.from({ length: n }, (_, i) => ({
      id: `cam_0${i + 1}`,
      name: `Camera ${i + 1}`,
      source: 'video',
      path: '',
      rtspUrl: '',
      status: 'idle',
    })))
  }

  const handleCamNameChange = (idx, name) => {
    setCameras(prev => prev.map((c, i) => i === idx ? { ...c, name } : c))
  }

  const handleCamSourceToggle = (idx, source) => {
    setCameras(prev => prev.map((c, i) => i === idx ? { ...c, source } : c))
  }

  const handleCamUpload = async (idx, file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API}/stream/upload`, { method: 'POST', body: form })
    const data = await res.json()
    setCameras(prev => prev.map((c, i) => i === idx ? { ...c, path: data.path } : c))
  }

  const handleCamRtspChange = (idx, url) => {
    setCameras(prev => prev.map((c, i) => i === idx ? { ...c, rtspUrl: url } : c))
  }

  const handleCamStart = async (idx) => {
    const cam = cameras[idx]
    const body = {
      camera_id: cam.id,
      source: cam.source,
      path: cam.source === 'video' ? cam.path : undefined,
      url: cam.source === 'rtsp' ? cam.rtspUrl : undefined,
    }
    const res = await fetch(`${API}/stream/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setCameras(prev => prev.map((c, i) => i === idx ? { ...c, status: 'running' } : c))
      if (!activeCam) setActiveCam(cam.id)
      if (!featuredCamera) setFeaturedCamera(cam.id)
      // Auto-save camera config to localStorage
      const savedCams = JSON.parse(localStorage.getItem('ft_saved_cameras') || '[]')
      const record = { name: cam.name, source: cam.source, path: cam.path, rtspUrl: cam.rtspUrl }
      const existIdx = savedCams.findIndex(s => s.name === cam.name)
      if (existIdx >= 0) savedCams[existIdx] = record; else savedCams.push(record)
      localStorage.setItem('ft_saved_cameras', JSON.stringify(savedCams))
    }
  }

  const handleCamStop = async (camId) => {
    await fetch(`${API}/stream/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: camId }),
    })
    setCameras(prev => prev.map(c => c.id === camId ? { ...c, status: 'stopped' } : c))
    if (activeCam === camId) {
      const next = cameras.find(c => c.id !== camId && c.status === 'running')
      setActiveCam(next ? next.id : null)
    }
    if (featuredCamera === camId) {
      const next = cameras.find(c => c.id !== camId && c.status === 'running')
      setFeaturedCamera(next ? next.id : null)
    }
  }

  const handleResetSetup = async () => {
    for (const cam of cameras) {
      if (cam.status === 'running') {
        await fetch(`${API}/stream/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ camera_id: cam.id }),
        })
      }
    }
    setCameras([])
    setNumCameras(null)
    setActiveCam(null)
    setAutoFollow(false)
    setFeaturedCamera(null)
  }

  // ── Person search handlers ──

  const handleTargetUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const form = new FormData()
    form.append('image', file)
    try {
      const res = await fetch(`${API}/search/set-target`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json()
        alert(`Search error: ${err.detail}`)
        return
      }
      const data = await res.json()
      setTargetFaceId(data.matched_face_id)
      setTargetStatus(data.matched_face_id === 'SEARCHING' ? 'searching' : 'found')
      setTargetPhotoCount(1)
    } catch (err) {
      console.error('Search target upload failed', err)
    }
  }

  const handleAddPhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const form = new FormData()
    form.append('image', file)
    try {
      const res = await fetch(`${API}/search/add-photo`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json()
        alert(`Add photo error: ${err.detail}`)
        return
      }
      const data = await res.json()
      setTargetPhotoCount(data.total_photos)
      if (data.matched_face_id && data.matched_face_id !== 'SEARCHING') {
        setTargetFaceId(data.matched_face_id)
        setTargetStatus('found')
      }
    } catch (err) {
      console.error('Add photo failed', err)
    }
  }

  const handleClearTarget = async () => {
    await fetch(`${API}/search/clear`, { method: 'POST' })
    setTargetStatus(null)
    setTargetFaceId(null)
    setTargetPhotoCount(0)
  }

  // ── Watchlist handlers ──

  const handleAddPersonFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setAddPersonFile(file)
    setAddPersonPreview(URL.createObjectURL(file))
  }

  const handleAddPerson = async () => {
    if (!addPersonName.trim() || !addPersonFile) return
    setAddPersonLoading(true)
    setAddPersonError('')
    try {
      const form = new FormData()
      form.append('name', addPersonName.trim())
      form.append('photo', addPersonFile)
      const res = await fetch(`${API}/watchlist/add`, { method: 'POST', body: form })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.detail || 'Failed to add person')
      }
      // Success — close modal and refresh list
      setShowAddPersonModal(false)
      setAddPersonName('')
      setAddPersonFile(null)
      setAddPersonPreview(null)
      setAddPersonError('')
      fetch(`${API}/watchlist`).then(r => r.json()).then(setWatchlistEntries)
    } catch (err) {
      console.error('Add to watchlist failed', err)
      setAddPersonError(err.message || 'Something went wrong')
    } finally {
      setAddPersonLoading(false)
    }
  }

  const handleCloseAddPersonModal = () => {
    setShowAddPersonModal(false)
    setAddPersonName('')
    setAddPersonFile(null)
    setAddPersonPreview(null)
    setAddPersonError('')
  }

  const handleRemoveWatchlistEntry = async (id) => {
    await fetch(`${API}/watchlist/${id}`, { method: 'DELETE' })
    setWatchlistEntries(prev => prev.filter(e => e.id !== id))
  }

  const handleAcknowledgeAlert = async (id) => {
    await fetch(`${API}/alerts/${id}/acknowledge`, { method: 'POST' })
    setWatchlistAlerts(prev => prev.filter(a => a.id !== id))
  }

  const handleAcknowledgeAllAlerts = async () => {
    await Promise.all(watchlistAlerts.map(a =>
      fetch(`${API}/alerts/${a.id}/acknowledge`, { method: 'POST' })
    ))
    setWatchlistAlerts([])
  }

  // ── Analytics & Settings handlers ──

  const handleExportCSV = () => {
    const header = 'face_id,event_type,timestamp,dwell_secs,camera_id'
    const rows = events.map(ev =>
      [ev.face_id, ev.event_type, ev.timestamp, ev.dwell_secs ?? '', ev.camera_id].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'facetracker_events.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const relativeTime = (ts) => {
    const diff = (Date.now() - new Date(ts).getTime()) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`
    return `${Math.floor(diff / 3600)} hrs ago`
  }

  const handleRemoveSavedCamera = (idx) => {
    const saved = JSON.parse(localStorage.getItem('ft_saved_cameras') || '[]')
    saved.splice(idx, 1)
    localStorage.setItem('ft_saved_cameras', JSON.stringify(saved))
    setSettingsTick(t => t + 1)
  }

  const handleLoadSavedCameras = () => {
    const saved = JSON.parse(localStorage.getItem('ft_saved_cameras') || '[]')
    if (!saved.length) return
    setNumCameras(saved.length)
    setCameras(saved.map((s, i) => ({
      id: `cam_0${i + 1}`,
      name: s.name,
      source: s.source,
      path: s.path || '',
      rtspUrl: s.rtspUrl || '',
      status: 'idle',
    })))
    setActivePage('cameras')
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-full max-w-sm px-8">
          <div className="text-center mb-10">
            <span className="material-symbols-outlined text-5xl text-white mb-4 block">face</span>
            <h1 className="text-2xl font-bold text-white tracking-tight">FaceTracker AI</h1>
            <p className="text-xs font-mono text-neutral-500 mt-2 uppercase tracking-widest">Enter PIN to continue</p>
          </div>
          <div className="flex flex-col gap-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setPinError(false) }}
              onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
              placeholder="••••"
              className="w-full bg-[#111] border border-surface-border rounded-xl px-5 py-4 text-center text-2xl tracking-[0.5em] text-white placeholder-neutral-700 outline-none focus:border-neutral-500 transition-colors font-mono"
              autoFocus
            />
            {pinError && (
              <p className="text-center text-xs font-mono text-red-500 uppercase tracking-wider">Incorrect PIN</p>
            )}
            <button
              onClick={handlePinSubmit}
              className="w-full py-3 bg-white text-black rounded-xl text-sm font-bold hover:bg-neutral-200 transition-colors"
            >Enter</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background overflow-x-hidden text-on-surface">

      {/* Top Navigation Bar */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-8 h-16 bg-black border-b border-surface-border">
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold tracking-tight text-white">FaceTracker AI</span>
          <nav className="hidden md:flex items-center gap-6">
            <a
              className={`${activePage === 'dashboard' ? 'text-white border-b border-white pb-1' : 'text-on-surface-variant hover:text-white'} font-medium transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider cursor-pointer`}
              onClick={() => setActivePage('dashboard')}
            >Dashboard</a>
            <a
              className={`${activePage === 'analytics' ? 'text-white border-b border-white pb-1' : 'text-on-surface-variant hover:text-white'} font-medium transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider cursor-pointer`}
              onClick={() => { setActivePage('analytics'); setEventsPage(0) }}
            >Analytics</a>
            <a
              className={`${activePage === 'cameras' ? 'text-white border-b border-white pb-1' : 'text-on-surface-variant hover:text-white'} font-medium transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider cursor-pointer`}
              onClick={() => setActivePage('cameras')}
            >Cameras</a>
            <a
              className={`${activePage === 'settings' ? 'text-white border-b border-white pb-1' : 'text-on-surface-variant hover:text-white'} font-medium transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider cursor-pointer`}
              onClick={() => setActivePage('settings')}
            >Settings</a>
            <a
              className={`${activePage === 'watchlist' ? 'text-white border-b border-white pb-1' : 'text-on-surface-variant hover:text-white'} font-medium transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider cursor-pointer`}
              onClick={() => setActivePage('watchlist')}
            >Watchlist</a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-tertiary/10 px-3 py-1 rounded-full border border-tertiary/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
            </span>
            <span className="text-[0.6875rem] font-mono text-tertiary uppercase tracking-tighter">Live</span>
          </div>
          <div className="flex items-center gap-3 text-on-surface-variant">
            <div ref={alertsRef} className="relative">
              <span
                className="material-symbols-outlined cursor-pointer hover:text-white transition-colors"
                onClick={() => setShowAlerts(a => !a)}
              >notifications</span>
              {watchlistAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center pointer-events-none">
                  {watchlistAlerts.length}
                </span>
              )}
              {showAlerts && (
                <div className="absolute right-0 top-8 w-96 bg-[#171717] border border-surface-border rounded-xl shadow-2xl z-50 overflow-hidden">
                  <div className="flex justify-between items-center px-4 py-3 border-b border-surface-border">
                    <span className="text-xs font-mono text-white uppercase tracking-wider">Watchlist Alerts</span>
                    {watchlistAlerts.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAcknowledgeAllAlerts() }}
                        className="text-[0.625rem] font-mono text-neutral-500 hover:text-white transition-colors"
                      >Mark all acknowledged</button>
                    )}
                  </div>
                  {watchlistAlerts.length === 0 && (
                    <p className="px-4 py-6 text-xs font-mono text-zinc-500 text-center">No active alerts</p>
                  )}
                  <div className="max-h-96 overflow-y-auto">
                    {watchlistAlerts.slice(0, 10).map(alert => (
                      <div key={alert.id} className="px-4 py-3 border-b border-surface-border hover:bg-[#262626] transition-colors">
                        <div className="flex gap-3">
                          {alert.snapshot_b64 && (
                            <img
                              src={`data:image/jpeg;base64,${alert.snapshot_b64}`}
                              className="w-10 h-10 rounded object-cover flex-shrink-0"
                              alt="snapshot"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-amber-400 font-mono font-medium truncate">
                              ⚠ Match Found: {alert.watchlist_name}
                            </p>
                            <p className="text-[0.625rem] text-zinc-400 font-mono mt-0.5">
                              #{alert.face_id?.slice(0, 5).toUpperCase()} · {alert.camera_id}
                            </p>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[0.625rem] text-zinc-500">{relativeTime(alert.matched_at)}</span>
                              <span className="text-[0.625rem] text-emerald-400 font-mono">
                                {(alert.similarity * 100).toFixed(1)}% match
                              </span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAcknowledgeAlert(alert.id) }}
                          className="mt-2 text-[0.625rem] font-mono text-neutral-500 hover:text-white border border-surface-border px-2 py-0.5 rounded transition-colors"
                        >Acknowledge</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleLock}
              className="flex items-center gap-1.5 text-[0.625rem] font-mono text-neutral-500 hover:text-white border border-surface-border px-2.5 py-1.5 rounded-lg transition-colors uppercase tracking-wider"
              title="Lock"
            >
              <span className="material-symbols-outlined text-[14px]">lock</span>
              Lock
            </button>
          </div>
        </div>
      </header>



      {/* Main Content */}
      <main className="mt-20 p-8 max-w-[1440px] mx-auto">

        {/* ── Dashboard Page ── */}
        {activePage === 'dashboard' && (
          <>
            {/* TOP ROW: Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">

              {/* Total Visitors */}
              <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Total Visitors</p>
                  <span className="material-symbols-outlined text-[16px] text-neutral-500">person</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-4xl font-bold text-white tracking-tight font-headline">{stats.total_visitors}</h2>
                </div>
              </div>

              {/* Today's Visitors */}
              <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Today's Visitors</p>
                  <span className="material-symbols-outlined text-[16px] text-neutral-500">calendar_today</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-4xl font-bold text-white tracking-tight font-headline">{stats.today_visitors}</h2>
                  <span className="text-neutral-500 text-xs font-medium font-mono">Daily Target</span>
                </div>
              </div>

              {/* Currently Inside */}
              <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Currently Inside</p>
                  <span className="material-symbols-outlined text-[16px] text-neutral-500">sensor_door</span>
                </div>
                <div className="flex items-center gap-3">
                  <h2 className="text-4xl font-bold text-white tracking-tight font-headline">{stats.currently_inside}</h2>
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-tertiary"></span>
                  </span>
                </div>
                <p className="mt-4 text-[0.6875rem] font-mono text-neutral-500">REAL-TIME CAPACITY</p>
              </div>

              {/* Avg Dwell Time */}
              <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Avg Dwell Time</p>
                  <span className="material-symbols-outlined text-[16px] text-neutral-500">schedule</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-4xl font-bold text-white tracking-tight font-headline">
                    {stats.avg_dwell_secs != null ? stats.avg_dwell_secs : '—'}
                  </h2>
                  <span className="text-neutral-400 text-sm font-medium uppercase tracking-widest">sec</span>
                </div>
                <p className="mt-4 text-[0.6875rem] font-mono text-neutral-500">STABLE VS LAST HOUR</p>
              </div>
            </div>

            {/* WATCHLIST ALERT BANNER */}
            {watchlistAlerts.length > 0 && (
              <div
                className="mb-6 flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 cursor-pointer"
                onClick={() => setShowAlerts(true)}
              >
                <span className="material-symbols-outlined text-red-400 text-sm">warning</span>
                <span className="text-red-400 text-xs font-mono">
                  ⚠ {watchlistAlerts.length} watchlist match{watchlistAlerts.length !== 1 ? 'es' : ''} detected — view alerts
                </span>
              </div>
            )}

            {/* MIDDLE ROW: Live Cameras + Live Event Feed */}
            <div className="flex gap-6 mb-6" style={{ alignItems: 'stretch' }}>
              {/* LEFT: Live Cameras (65%) */}
              <div className="card-neutral p-6 rounded-xl flex-[65]">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-base font-medium tracking-tight text-white">Live Cameras</h3>
                  <span className="relative flex h-2 w-2 ml-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                </div>
                {dashboardSavedCameras.length === 0 ? (
                  <div className="flex flex-col items-center justify-center" style={{ minHeight: '200px' }}>
                    <span className="material-symbols-outlined text-neutral-600 text-5xl mb-3">videocam_off</span>
                    <p className="text-zinc-400 text-sm">No cameras added yet</p>
                    <p className="text-zinc-500 text-xs mt-1">Add a camera feed to see it live here</p>
                    <button
                      onClick={() => setActivePage('cameras')}
                      className="mt-4 px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors"
                    >Go to Cameras →</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {dashboardSavedCameras.map((cam) => (
                      <div
                        key={cam.name}
                        onClick={() => setActivePage('cameras')}
                        className="relative bg-[#171717] rounded-xl overflow-hidden cursor-pointer hover:border hover:border-white/20 transition-all"
                        style={{ aspectRatio: '16/9' }}
                      >
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <span className="material-symbols-outlined text-neutral-600 text-4xl">videocam</span>
                          <span className="text-xs font-mono text-neutral-500">{cam.name}</span>
                        </div>
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded-full">
                          <span className="text-green-500 text-[10px]">●</span>
                          <span className="text-[10px] font-mono text-green-400 uppercase tracking-wider">LIVE</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT: Live Event Feed (35%) */}
              <div className="card-neutral p-6 rounded-xl flex-[35] flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-base font-medium tracking-tight text-white">Live Event Feed</h3>
                  <span className="relative flex h-2 w-2 ml-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                </div>
                <div
                  ref={liveFeedRef}
                  className="flex-1 overflow-y-auto"
                  style={{ maxHeight: '280px' }}
                >
                  {events.slice(0, 20).map((ev, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-zinc-800">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${ev.event_type === 'ENTRY' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          {ev.event_type}
                        </span>
                        <span className="text-sm font-mono text-white">#FT-{ev.face_id.slice(0, 5).toUpperCase()}</span>
                      </div>
                      <span className="text-xs text-zinc-500 font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  {events.length === 0 && (
                    <p className="text-xs font-mono text-neutral-500 text-center py-8">NO EVENTS YET</p>
                  )}
                </div>
              </div>
            </div>

            {/* BOTTOM ROW: Occupancy */}
            {(() => {
              const capacity = 50
              const inside = stats.currently_inside || 0
              const pct = Math.round((inside / capacity) * 100)
              const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#eab308' : '#22c55e'
              const peakToday = hourlyData.length > 0 ? Math.max(...hourlyData.map(d => d.count || 0)) : 0
              const activeHours = hourlyData.filter(d => (d.count || 0) > 0).length || 1
              const totalVisitorsHourly = hourlyData.reduce((sum, d) => sum + (d.count || 0), 0)
              const avgPerHour = Math.round(totalVisitorsHourly / activeHours)
              const lastEntry = events.find(ev => ev.event_type === 'ENTRY')
              return (
                <div className="card-neutral p-6 rounded-xl">
                  <h3 className="text-base font-medium tracking-tight text-white mb-4">Current Occupancy</h3>
                  <div className="flex items-center gap-8">
                    {/* Radial chart */}
                    <div className="relative flex-shrink-0" style={{ width: 200, height: 200 }}>
                      <RadialBarChart
                        width={200}
                        height={200}
                        cx={100}
                        cy={100}
                        innerRadius={60}
                        outerRadius={90}
                        startAngle={210}
                        endAngle={-30}
                        data={[{ value: inside, fill: barColor }]}
                        barSize={14}
                      >
                        <RadialBar
                          background={{ fill: '#262626' }}
                          dataKey="value"
                          max={capacity}
                          cornerRadius={7}
                        />
                      </RadialBarChart>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-3xl font-bold text-white">{pct}%</span>
                        <span className="text-xs text-zinc-400 font-mono mt-1">{inside} / {capacity} people</span>
                      </div>
                    </div>

                    {/* Stat pills */}
                    <div className="flex flex-col gap-3">
                      <div className="bg-[#171717] border border-surface-border rounded-lg px-4 py-3">
                        <p className="text-[0.6875rem] font-mono uppercase text-neutral-500 mb-1">Peak Today</p>
                        <p className="text-xl font-bold text-white">{peakToday}</p>
                      </div>
                      <div className="bg-[#171717] border border-surface-border rounded-lg px-4 py-3">
                        <p className="text-[0.6875rem] font-mono uppercase text-neutral-500 mb-1">Avg per Hour</p>
                        <p className="text-xl font-bold text-white">{avgPerHour}</p>
                      </div>
                      <div className="bg-[#171717] border border-surface-border rounded-lg px-4 py-3">
                        <p className="text-[0.6875rem] font-mono uppercase text-neutral-500 mb-1">Last Entry</p>
                        <p className="text-sm font-mono text-white">
                          {lastEntry ? new Date(lastEntry.timestamp).toLocaleTimeString() : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {/* ── Analytics Page ── */}
        {activePage === 'analytics' && (() => {
          const totalPages = Math.ceil(events.length / 10)
          const pageStart = eventsPage * 10
          const pageEnd = Math.min(pageStart + 10, events.length)
          const pageEvents = events.slice(pageStart, pageEnd)
          return (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white">Analytics</h2>
              </div>

              {/* Stat Cards — reuse stats state */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Total Visitors</p>
                    <span className="material-symbols-outlined text-[16px] text-neutral-500">person</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-4xl font-bold text-white tracking-tight font-headline">{stats.total_visitors}</h2>
                  </div>
                </div>
                <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Today's Visitors</p>
                    <span className="material-symbols-outlined text-[16px] text-neutral-500">calendar_today</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-4xl font-bold text-white tracking-tight font-headline">{stats.today_visitors}</h2>
                    <span className="text-neutral-500 text-xs font-medium font-mono">Daily Target</span>
                  </div>
                </div>
                <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Currently Inside</p>
                    <span className="material-symbols-outlined text-[16px] text-neutral-500">sensor_door</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-4xl font-bold text-white tracking-tight font-headline">{stats.currently_inside}</h2>
                    <span className="flex h-3 w-3 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-tertiary"></span>
                    </span>
                  </div>
                  <p className="mt-4 text-[0.6875rem] font-mono text-neutral-500">REAL-TIME CAPACITY</p>
                </div>
                <div className="card-neutral p-6 rounded-xl relative overflow-hidden group">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Avg Dwell Time</p>
                    <span className="material-symbols-outlined text-[16px] text-neutral-500">schedule</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-4xl font-bold text-white tracking-tight font-headline">
                      {stats.avg_dwell_secs != null ? stats.avg_dwell_secs : '—'}
                    </h2>
                    <span className="text-neutral-400 text-sm font-medium uppercase tracking-widest">sec</span>
                  </div>
                  <p className="mt-4 text-[0.6875rem] font-mono text-neutral-500">STABLE VS LAST HOUR</p>
                </div>
              </div>

              {/* Full-width bar chart at 400px */}
              <div className="card-neutral p-8 rounded-xl mb-8">
                <div className="flex justify-between items-center mb-10">
                  <h3 className="text-lg font-medium tracking-tight text-white">Hourly Foot Traffic</h3>
                  <div className="flex gap-2">
                    <span
                      onClick={() => setChartView('day')}
                      className={`px-3 py-1 text-[0.6875rem] font-medium rounded-md cursor-pointer border ${chartView === 'day' ? 'bg-surface-variant border-surface-border text-white' : 'border-transparent text-neutral-500 hover:bg-surface-variant'}`}
                    >Day</span>
                    <span
                      onClick={() => setChartView('week')}
                      className={`px-3 py-1 text-[0.6875rem] font-medium rounded-md cursor-pointer border ${chartView === 'week' ? 'bg-surface-variant border-surface-border text-white' : 'border-transparent text-neutral-500 hover:bg-surface-variant'}`}
                    >Week</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={chartView === 'week' ? weeklyData : hourlyData} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="#262626" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: '#737373', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px' }}
                      labelStyle={{ color: '#ffffff', fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                      itemStyle={{ color: '#ffffff' }}
                      formatter={(value) => [value, 'Visitors']}
                      labelFormatter={(label) => `Hour: ${label}:00`}
                    />
                    <Bar dataKey="count" fill="#ffffff" radius={[2, 2, 0, 0]} cursor={{ fill: '#262626' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Full events table with pagination */}
              <div className="card-neutral rounded-xl overflow-hidden">
                <div className="p-6 border-b border-surface-border flex justify-between items-center">
                  <h3 className="text-lg font-medium tracking-tight text-white">All Events</h3>
                  <button
                    onClick={handleExportCSV}
                    className="text-[0.6875rem] uppercase font-bold tracking-[0.1em] text-white hover:underline transition-all"
                  >Export Data</button>
                </div>
                <div className="overflow-x-auto no-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-variant/50">
                        <th className="p-4 text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Face ID</th>
                        <th className="p-4 text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Event Type</th>
                        <th className="p-4 text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Timestamp</th>
                        <th className="p-4 text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Dwell Time</th>
                        <th className="p-4 text-[0.75rem] uppercase tracking-[0.05em] font-medium text-neutral-500">Camera</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {pageEvents.map((event, idx) => (
                        <tr
                          key={pageStart + idx}
                          className={`${(pageStart + idx) % 2 === 0 ? 'bg-[#171717]' : 'bg-black'} hover:bg-[#262626] transition-colors`}
                        >
                          <td className="p-4 font-mono text-[0.75rem] text-white">
                            #FT-{event.face_id.slice(0, 5).toUpperCase()}
                          </td>
                          <td className="p-4">
                            {event.event_type === 'ENTRY' ? (
                              <span className="bg-tertiary/10 text-tertiary px-3 py-1 rounded-full text-[0.625rem] font-bold uppercase tracking-widest border border-tertiary/20">
                                Entry
                              </span>
                            ) : (
                              <span className="bg-error/10 text-error px-3 py-1 rounded-full text-[0.625rem] font-bold uppercase tracking-widest border border-error/20">
                                Exit
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-sm text-neutral-300">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="p-4 text-sm font-mono text-neutral-500">
                            {event.dwell_secs ? event.dwell_secs + 's' : '-'}
                          </td>
                          <td className="p-4 text-sm text-neutral-300">
                            {event.camera_id}
                          </td>
                        </tr>
                      ))}
                      {events.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-neutral-500 text-sm font-mono">
                            NO EVENTS RECORDED
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {events.length > 0 && (
                  <div className="p-4 border-t border-surface-border flex justify-between items-center">
                    <span className="text-xs font-mono text-neutral-500">
                      Showing {pageStart + 1}–{pageEnd} of {events.length} events
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEventsPage(p => p - 1)}
                        disabled={eventsPage === 0}
                        className="px-3 py-1.5 text-xs font-mono rounded-lg border border-surface-border text-neutral-400 hover:text-white hover:border-neutral-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >Previous</button>
                      <button
                        onClick={() => setEventsPage(p => p + 1)}
                        disabled={eventsPage >= totalPages - 1}
                        className="px-3 py-1.5 text-xs font-mono rounded-lg border border-surface-border text-neutral-400 hover:text-white hover:border-neutral-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >Next</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* ── Cameras Page ── */}
        {activePage === 'cameras' && (
          <div>
            {/* Page header */}
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold text-white">Live Monitoring</h2>
              {numCameras !== null && (
                <button
                  onClick={handleResetSetup}
                  className="flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-white border border-surface-border px-4 py-2 rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  Reset Setup
                </button>
              )}
            </div>

            {/* STEP 1 — Camera count selection */}
            {numCameras === null && (
              <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="card-neutral p-12 rounded-2xl text-center max-w-lg w-full">
                  <span className="material-symbols-outlined text-5xl text-neutral-400 block mb-4">videocam</span>
                  <h3 className="text-2xl font-bold text-white mb-2">Camera Setup</h3>
                  <p className="text-neutral-500 font-mono text-sm mb-10">How many camera feeds do you have?</p>
                  <div className="grid grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(n => (
                      <button
                        key={n}
                        onClick={() => handleSelectCount(n)}
                        className="aspect-square flex items-center justify-center text-3xl font-bold text-white bg-surface-variant hover:bg-white hover:text-black border border-surface-border rounded-xl transition-all duration-200"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 — Setup cards for cameras not yet started */}
            {numCameras !== null && cameras.some(c => c.status === 'idle') && (
              <div className={`grid gap-6 mb-6 ${
                cameras.filter(c => c.status === 'idle').length === 1
                  ? 'grid-cols-1 max-w-sm'
                  : cameras.filter(c => c.status === 'idle').length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-2 lg:grid-cols-2'
              }`}>
                {cameras.filter(c => c.status === 'idle').map(cam => {
                  const idx = cameras.findIndex(c => c.id === cam.id)
                  const dimmed = anyRunning
                  return (
                    <div key={cam.id} className={`card-neutral p-6 rounded-xl ${dimmed ? 'opacity-70 border border-dashed border-surface-border' : ''}`}>
                      <div className="flex items-center gap-3 mb-5">
                        <span className={`material-symbols-outlined ${dimmed ? 'text-neutral-600' : 'text-neutral-400'}`}>videocam</span>
                        <input
                          type="text"
                          value={cam.name}
                          onChange={e => handleCamNameChange(idx, e.target.value)}
                          className={`flex-1 bg-transparent border-b border-surface-border text-base font-medium outline-none focus:border-neutral-400 transition-colors pb-0.5 ${dimmed ? 'text-neutral-400' : 'text-white'}`}
                        />
                      </div>
                      <div className="flex rounded-lg overflow-hidden border border-surface-border mb-4">
                        <button
                          onClick={() => handleCamSourceToggle(idx, 'video')}
                          className={`flex-1 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${cam.source === 'video' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}
                        >
                          Video File
                        </button>
                        <button
                          onClick={() => handleCamSourceToggle(idx, 'rtsp')}
                          className={`flex-1 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${cam.source === 'rtsp' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}
                        >
                          RTSP
                        </button>
                      </div>
                      {cam.source === 'video' ? (
                        <div className="mb-4">
                          <input
                            type="file"
                            accept="video/*"
                            onChange={e => e.target.files[0] && handleCamUpload(idx, e.target.files[0])}
                            className="block w-full text-sm text-neutral-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-variant file:text-white hover:file:bg-neutral-700 cursor-pointer"
                          />
                          {cam.path && (
                            <p className="text-[0.625rem] font-mono text-neutral-500 mt-2 truncate">
                              {cam.path.split(/[/\\]/).pop()}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mb-4">
                          <input
                            type="text"
                            placeholder="rtsp://192.168.1.x:554/stream"
                            value={cam.rtspUrl}
                            onChange={e => handleCamRtspChange(idx, e.target.value)}
                            className="w-full bg-surface-variant border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-neutral-500 transition-colors"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => handleCamStart(idx)}
                        disabled={cam.source === 'video' ? !cam.path : !cam.rtspUrl}
                        className="w-full py-2 px-4 bg-white text-black rounded-lg text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-200 transition-colors"
                      >
                        Start
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* STEP 3 + 4 — Live view and person search (once any camera is running) */}
            {anyRunning && (
              <>
                {/* Person Search card */}
                <div className="card-neutral p-6 rounded-xl mb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="material-symbols-outlined text-neutral-400">person_search</span>
                    <h3 className="text-lg font-medium text-white">Person Search</h3>
                  </div>
                  <div className="flex items-start gap-6">
                    <div className="flex-1">
                      <p className="text-xs text-neutral-500 mb-3 font-mono">
                        Upload a photo of a target person to track them across all camera feeds in real time.
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleTargetUpload}
                        className="block w-full text-sm text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface-variant file:text-white hover:file:bg-neutral-700 cursor-pointer"
                      />
                      {targetStatus !== null && (
                        <div className="mt-4">
                          <p className="text-xs text-neutral-500 mb-2 font-mono">
                            Add another photo (different angle / lighting)
                          </p>
                          <input
                            key={targetPhotoCount}
                            type="file"
                            accept="image/*"
                            onChange={handleAddPhoto}
                            className="block w-full text-sm text-neutral-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-variant file:text-white hover:file:bg-neutral-700 cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-3 min-w-[240px]">
                      {targetStatus === 'found' && (
                        <>
                          <span className="flex items-center gap-2 bg-green-500/10 text-green-400 border border-green-500/20 px-3 py-1.5 rounded-full text-xs font-mono font-bold">
                            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
                            Found: #FT-{targetFaceId?.slice(0, 5).toUpperCase()}
                          </span>
                          <span className="text-[0.625rem] font-mono text-neutral-500">
                            {targetPhotoCount} photo{targetPhotoCount !== 1 ? 's' : ''} enrolled
                          </span>
                        </>
                      )}
                      {targetStatus === 'searching' && (
                        <>
                          <span className="flex items-center gap-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-3 py-1.5 rounded-full text-xs font-mono font-bold">
                            <span className="animate-ping w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0"></span>
                            Searching across cameras...
                          </span>
                          <span className="text-[0.625rem] font-mono text-neutral-500">
                            {targetPhotoCount} photo{targetPhotoCount !== 1 ? 's' : ''} enrolled
                          </span>
                        </>
                      )}
                      {autoFollow && targetStatus === 'found' && activeCamObj && (
                        <span className="flex items-center gap-2 bg-green-500/5 text-green-300 border border-green-500/10 px-3 py-1.5 rounded-full text-xs font-mono">
                          <span className="animate-ping w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
                          Auto-following on {activeCamObj.name}
                        </span>
                      )}
                      {targetStatus !== null && (
                        <button
                          onClick={handleClearTarget}
                          className="text-xs font-mono text-neutral-500 hover:text-white border border-surface-border px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Clear Target
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Live feed + stats */}
                <div className="flex gap-6">

                  {/* Live Feed (70%) */}
                  <div className="flex-[7] card-neutral p-4 rounded-xl">
                    {/* Feed header */}
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-medium text-white">Live Feed</h3>
                        {activeCamObj && (
                          <span className="text-xs font-mono text-neutral-500 uppercase">{activeCamObj.name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {/* Auto-Follow toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">Auto-Follow</span>
                          <div
                            onClick={() => setAutoFollow(f => !f)}
                            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${autoFollow ? 'bg-green-500' : 'bg-surface-variant border border-surface-border'}`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 ${autoFollow ? 'left-5' : 'left-0.5'}`}></span>
                          </div>
                        </label>
                        {/* Live indicator */}
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
                          </span>
                          <span className="text-xs font-mono text-tertiary uppercase">Live</span>
                        </div>
                      </div>
                    </div>

                    {/* MJPEG stream — key forces remount on camera switch */}
                    {(featuredCamera ?? activeCam) ? (
                      <div className="relative">
                        <img
                          key={featuredCamera ?? activeCam}
                          src={`${API}/stream/feed?camera_id=${featuredCamera ?? activeCam}`}
                          className={`w-full rounded-lg bg-black transition-all duration-100 ${feedFlashing ? 'border-2 border-yellow-400' : ''}`}
                          alt="Live camera feed"
                        />
                        {autoFollow && featuredCamera && (
                          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 border border-yellow-400/50 px-2 py-1 rounded-full pointer-events-none">
                            <span className="text-yellow-400 text-[10px]">●</span>
                            <span className="text-[10px] font-mono text-yellow-400 uppercase tracking-wider">AUTO-FOLLOWING</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full h-64 rounded-lg bg-surface-variant flex items-center justify-center border border-surface-border border-dashed">
                        <p className="text-neutral-500 text-sm font-mono">SELECT A CAMERA BELOW</p>
                      </div>
                    )}

                    {/* Camera pills */}
                    <div className="flex items-center gap-3 mt-4 flex-wrap">
                      <span className="text-xs font-mono text-neutral-500 uppercase tracking-wider">Switch:</span>
                      {cameras.filter(c => c.status === 'running').map(cam => (
                        <button
                          key={cam.id}
                          onClick={() => { setActiveCam(cam.id); setFeaturedCamera(cam.id) }}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-bold transition-colors ${
                            autoFollow && featuredCamera === cam.id
                              ? 'bg-yellow-400/10 text-yellow-400 border-2 border-yellow-400'
                              : activeCam === cam.id
                              ? 'bg-white text-black'
                              : 'bg-surface-variant text-neutral-400 hover:text-white border border-surface-border'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0"></span>
                          {cam.name}
                          {autoFollow && featuredCamera === cam.id && (
                            <span className="text-[8px] font-mono text-yellow-400 uppercase tracking-widest">TRACKING</span>
                          )}
                        </button>
                      ))}
                      {cameras.filter(c => c.status === 'stopped').map(cam => (
                        <span
                          key={cam.id}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono text-neutral-600 border border-surface-border opacity-50"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-600 flex-shrink-0"></span>
                          {cam.name}
                        </span>
                      ))}
                    </div>

                    {/* Legend */}
                    <div className="flex gap-6 mt-3 text-xs font-mono text-neutral-400">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-white inline-block flex-shrink-0"></span>
                        Tracked person
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-red-500 inline-block flex-shrink-0"></span>
                        TARGET FOUND
                      </span>
                    </div>

                    {/* Per-camera stop buttons */}
                    {cameras.filter(c => c.status === 'running').length > 0 && (
                      <div className="flex gap-3 mt-4">
                        {cameras.filter(c => c.status === 'running').map(cam => (
                          <button
                            key={cam.id}
                            onClick={() => handleCamStop(cam.id)}
                            className="flex-1 py-2 px-4 bg-error/10 text-error border border-error/20 rounded-lg text-xs font-bold hover:bg-error/20 transition-colors"
                          >
                            Stop {cam.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Live Stats (30%) */}
                  <div className="flex-[3] flex flex-col gap-4">
                    <h3 className="text-lg font-medium text-white">Live Stats</h3>

                    <div className="card-neutral p-6 rounded-xl">
                      <p className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Currently Inside</p>
                      <div className="flex items-center gap-3">
                        <span className="text-5xl font-bold text-white font-headline">{stats.currently_inside}</span>
                        <span className="flex h-4 w-4 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-tertiary"></span>
                        </span>
                      </div>
                    </div>

                    <div className="card-neutral p-5 rounded-xl">
                      <p className="text-xs uppercase tracking-widest text-neutral-500 mb-1">Total Visitors</p>
                      <span className="text-3xl font-bold text-white">{stats.total_visitors}</span>
                    </div>

                    <div className="card-neutral p-5 rounded-xl">
                      <p className="text-xs uppercase tracking-widest text-neutral-500 mb-1">Today's Visitors</p>
                      <span className="text-3xl font-bold text-white">{stats.today_visitors}</span>
                    </div>

                    <div className="card-neutral p-5 rounded-xl">
                      <p className="text-xs uppercase tracking-widest text-neutral-500 mb-1">Avg Dwell Time</p>
                      <span className="text-3xl font-bold text-white">
                        {stats.avg_dwell_secs != null ? stats.avg_dwell_secs : '—'}
                      </span>
                      <span className="text-neutral-500 text-xs ml-1">sec</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Settings Page ── */}
        {activePage === 'settings' && (() => {
          const savedCameras = JSON.parse(localStorage.getItem('ft_saved_cameras') || '[]')
          void settingsTick // consume to trigger re-render on remove
          return (
            <div className="max-w-2xl">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white">Settings</h2>
              </div>

              {/* Section 1: Saved Cameras */}
              <div className="card-neutral p-6 rounded-xl mb-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-medium text-white">Saved Cameras</h3>
                    <p className="text-xs font-mono text-neutral-500 mt-1">Camera configs saved from previous sessions</p>
                  </div>
                  {savedCameras.length > 0 && (
                    <button
                      onClick={handleLoadSavedCameras}
                      className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-xs font-bold hover:bg-neutral-200 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                      Load All
                    </button>
                  )}
                </div>
                {savedCameras.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 border border-dashed border-surface-border rounded-xl">
                    <span className="material-symbols-outlined text-3xl text-neutral-600 mb-2">videocam_off</span>
                    <p className="text-xs font-mono text-neutral-500">No saved cameras yet</p>
                    <p className="text-[0.625rem] font-mono text-neutral-600 mt-1">Start a camera on the Cameras page to save it here</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {savedCameras.map((cam, idx) => (
                      <div key={idx} className="flex items-center gap-4 bg-surface-variant p-4 rounded-lg border border-surface-border">
                        <span className="material-symbols-outlined text-neutral-400 flex-shrink-0">videocam</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{cam.name}</p>
                          <p className="text-[0.625rem] font-mono text-neutral-500 truncate mt-0.5">
                            {cam.source === 'rtsp' ? cam.rtspUrl : (cam.path ? cam.path.split(/[/\\]/).pop() : 'No file')}
                          </p>
                        </div>
                        <span className={`text-[0.625rem] font-mono font-bold uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${cam.source === 'rtsp' ? 'text-blue-400 border-blue-400/30 bg-blue-400/10' : 'text-neutral-400 border-neutral-400/30 bg-neutral-400/10'}`}>
                          {cam.source === 'rtsp' ? 'RTSP' : 'Video'}
                        </span>
                        <button
                          onClick={() => handleRemoveSavedCamera(idx)}
                          className="text-[0.625rem] font-mono text-neutral-500 hover:text-error border border-surface-border hover:border-error/30 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                        >Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: Detection Settings (display only) */}
              <div className="card-neutral p-6 rounded-xl">
                <div className="mb-4">
                  <h3 className="text-lg font-medium text-white">Detection Settings</h3>
                  <p className="text-xs font-mono text-neutral-500 mt-1">Read-only — edit config.json to change values</p>
                </div>
                {[
                  ['Similarity Threshold', '0.62'],
                  ['Track Buffer', '30 frames'],
                  ['Detection Skip Frames', '3'],
                  ['Re-ID Model', 'buffalo_l'],
                  ['Tracker', 'ByteTrack'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center py-3 border-b border-surface-border last:border-0">
                    <span className="text-sm text-neutral-400">{label}</span>
                    <span className="text-sm font-mono text-white bg-surface-variant px-3 py-1 rounded-lg border border-surface-border">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* ── Watchlist Page ── */}
        {activePage === 'watchlist' && (
          <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Watchlist</h1>
                <p className="text-xs font-mono text-neutral-500 mt-1">
                  {watchlistEntries.length} {watchlistEntries.length === 1 ? 'person' : 'people'} enrolled
                </p>
              </div>
              <button
                onClick={() => setShowAddPersonModal(true)}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-xl text-sm font-bold hover:bg-neutral-200 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                Add Person
              </button>
            </div>

            {/* Watchlist Grid */}
            {watchlistEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="material-symbols-outlined text-5xl text-neutral-700 mb-4">person_search</span>
                <p className="text-neutral-500 font-mono text-sm">No people on watchlist yet</p>
                <p className="text-neutral-600 font-mono text-xs mt-1">Click "Add Person" to enroll someone</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {watchlistEntries.map(entry => (
                  <div key={entry.id} className="bg-surface-container rounded-xl border border-surface-border overflow-hidden">
                    <div className="aspect-square bg-[#111] flex items-center justify-center overflow-hidden">
                      {entry.photo_b64 ? (
                        <img
                          src={`data:image/jpeg;base64,${entry.photo_b64}`}
                          className="w-full h-full object-cover"
                          alt={entry.name}
                        />
                      ) : (
                        <span className="material-symbols-outlined text-4xl text-neutral-700">person</span>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium text-white truncate">{entry.name}</p>
                      <p className="text-[0.625rem] font-mono text-neutral-500 mt-0.5">
                        {entry.added_at ? new Date(entry.added_at).toLocaleDateString() : '—'}
                      </p>
                      <button
                        onClick={() => handleRemoveWatchlistEntry(entry.id)}
                        className="mt-2 w-full text-[0.625rem] font-mono text-red-500 hover:text-red-400 border border-red-500/30 hover:border-red-400/50 px-2 py-1 rounded-lg transition-colors"
                      >Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Person Modal */}
            {showAddPersonModal && (
              <div
                className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                onClick={handleCloseAddPersonModal}
              >
                <div className="bg-[#111] border border-surface-border rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                  <h2 className="text-lg font-bold text-white mb-4">Add Person to Watchlist</h2>
                  <div className="flex flex-col gap-4">
                    <input
                      type="text"
                      placeholder="Full name"
                      value={addPersonName}
                      onChange={e => setAddPersonName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddPerson()}
                      className="w-full bg-[#1a1a1a] border border-surface-border rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neutral-500 transition-colors placeholder-neutral-600"
                    />
                    <label className="border-2 border-dashed border-surface-border rounded-xl p-6 text-center cursor-pointer hover:border-neutral-500 transition-colors">
                      {addPersonPreview ? (
                        <img src={addPersonPreview} className="w-32 h-32 object-cover rounded-lg mx-auto" alt="preview" />
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-3xl text-neutral-600 block mb-2">upload_file</span>
                          <span className="text-xs font-mono text-neutral-500">Click to upload photo</span>
                        </>
                      )}
                      <input type="file" accept="image/*" className="hidden" onChange={handleAddPersonFileChange} />
                    </label>
                    {addPersonError && (
                      <p className="text-red-400 text-xs font-mono text-center">{addPersonError}</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={handleCloseAddPersonModal}
                        className="flex-1 py-2.5 border border-surface-border rounded-xl text-sm text-neutral-400 hover:text-white transition-colors"
                      >Cancel</button>
                      <button
                        onClick={handleAddPerson}
                        disabled={!addPersonName.trim() || !addPersonFile || addPersonLoading}
                        className="flex-1 py-2.5 bg-white text-black rounded-xl text-sm font-bold hover:bg-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {addPersonLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            Adding...
                          </span>
                        ) : 'Add to Watchlist'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}
