import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import './App.css'

const API = 'http://localhost:8000'

const CAMERAS = [
  { id: 'cam_01', label: 'CAM 01' },
  { id: 'cam_02', label: 'CAM 02' },
  { id: 'cam_03', label: 'CAM 03' },
  { id: 'cam_04', label: 'CAM 04' },
]

export default function App() {
  const [stats, setStats] = useState({ total_visitors: 0, today_visitors: 0, currently_inside: 0, avg_dwell_secs: null })
  const [events, setEvents] = useState([])
  const [hourlyData, setHourlyData] = useState([])
  const [demographics, setDemographics] = useState({ Male: 0, Female: 0 })

  const [activePage, setActivePage] = useState('dashboard')
  const [isStreaming, setIsStreaming] = useState(false)
  const [uploadedPath, setUploadedPath] = useState('')
  const [rtspUrl, setRtspUrl] = useState('')

  // Multi-camera state
  const [activeCam, setActiveCam] = useState('cam_01')

  // Person search state
  const [targetStatus, setTargetStatus] = useState(null)  // null | 'found' | 'searching'
  const [targetFaceId, setTargetFaceId] = useState(null)

  const fetchAll = () =>
    Promise.all([
      fetch(`${API}/stats`).then(r => r.json()),
      fetch(`${API}/events`).then(r => r.json()),
      fetch(`${API}/hourly`).then(r => r.json()),
      fetch(`${API}/demographics`).then(r => r.json()),
    ]).then(([s, e, h, d]) => {
      setStats(s)
      setEvents(e)
      setHourlyData(h)
      setDemographics(d)
    }).catch(console.error)

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 5000)
    return () => clearInterval(id)
  }, [])

  const demoTotal = (demographics.Male || 0) + (demographics.Female || 0)

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API}/stream/upload`, { method: 'POST', body: form })
    const data = await res.json()
    setUploadedPath(data.path)
  }

  const handleStart = async (source) => {
    const body = source === 'video'
      ? { source: 'video', path: uploadedPath, camera_id: activeCam }
      : { source: 'rtsp', url: rtspUrl, camera_id: activeCam }
    await fetch(`${API}/stream/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setIsStreaming(true)
  }

  const handleStop = async () => {
    await fetch(`${API}/stream/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: activeCam }),
    })
    setIsStreaming(false)
  }

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
    } catch (err) {
      console.error('Search target upload failed', err)
    }
  }

  const handleClearTarget = async () => {
    await fetch(`${API}/search/clear`, { method: 'POST' })
    setTargetStatus(null)
    setTargetFaceId(null)
  }

  const handleCamSelect = (camId) => {
    if (camId === activeCam) return
    setActiveCam(camId)
    setIsStreaming(false)  // new camera needs its own stream started
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
            <a className="text-on-surface-variant font-medium hover:text-white transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider" href="#">Analytics</a>
            <a
              className={`${activePage === 'cameras' ? 'text-white border-b border-white pb-1' : 'text-on-surface-variant hover:text-white'} font-medium transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider cursor-pointer`}
              onClick={() => setActivePage('cameras')}
            >Cameras</a>
            <a className="text-on-surface-variant font-medium hover:text-white transition-all duration-300 px-3 py-1 rounded-md text-[0.75rem] uppercase tracking-wider" href="#">Settings</a>
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
            <span className="material-symbols-outlined cursor-pointer hover:text-white transition-colors">refresh</span>
            <span className="material-symbols-outlined cursor-pointer hover:text-white transition-colors">notifications</span>
            <span className="material-symbols-outlined cursor-pointer hover:text-white transition-colors">help</span>
            <div className="h-8 w-8 rounded-full bg-surface-container-highest border border-surface-border overflow-hidden">
              <img alt="User profile"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCY8QjIgA7_z2ByzCw5yVyGJp2H2Ghiy9NOful5RiWKFhtC5vzlWYqVQYh7XyhvW4VVgej3e69KslEOBr8wlEJYtRt6EgOpeptG70phUAVDgv5Ipj3BhDiaD1tR2_6qEu3WWyDUGoKbOLp5TJH0yRNKkhPb1AoYt7sejzBnifPAnCbK_4HPfwbywAvjg_nPxcNMMzq_foGrhpuGu39w2QYJQpOpbeqPIO8RgWqcU4uVXPUcB41vDwnKjRaXcWR-flpLmwrbaZN8D1Ng" />
            </div>
          </div>
        </div>
      </header>

      {/* Side Navigation Rail */}
      <aside className="fixed left-0 top-16 bottom-0 w-20 bg-black border-r border-surface-border flex flex-col items-center py-6 gap-8 z-40">
        <div
          className={`p-3 cursor-pointer rounded-lg transition-all duration-200 ${activePage === 'dashboard' ? 'text-white' : 'text-on-surface-variant hover:bg-surface-variant hover:text-white'}`}
          onClick={() => setActivePage('dashboard')}
        >
          <span className="material-symbols-outlined">dashboard</span>
        </div>
        <div
          className={`p-3 cursor-pointer rounded-lg transition-all duration-200 ${activePage === 'cameras' ? 'text-white' : 'text-on-surface-variant hover:bg-surface-variant hover:text-white'}`}
          onClick={() => setActivePage('cameras')}
        >
          <span className="material-symbols-outlined">videocam</span>
        </div>
        <div className="p-3 text-on-surface-variant hover:bg-surface-variant hover:text-white rounded-lg transition-all duration-200 cursor-pointer">
          <span className="material-symbols-outlined">groups</span>
        </div>
        <div className="p-3 text-on-surface-variant hover:bg-surface-variant hover:text-white rounded-lg transition-all duration-200 cursor-pointer">
          <span className="material-symbols-outlined">map</span>
        </div>
        <div className="p-3 text-on-surface-variant hover:bg-surface-variant hover:text-white rounded-lg transition-all duration-200 cursor-pointer">
          <span className="material-symbols-outlined">assessment</span>
        </div>
        <div className="mt-auto flex flex-col gap-4">
          <span className="material-symbols-outlined text-neutral-600 hover:text-white cursor-pointer">support_agent</span>
          <span className="material-symbols-outlined text-neutral-600 hover:text-white cursor-pointer">terminal</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="mt-20 p-8 max-w-[1440px] mx-auto ml-20">

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

            {/* MIDDLE ROW: Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-8">

              {/* Hourly Foot Traffic */}
              <div className="lg:col-span-3 card-neutral p-8 rounded-xl relative overflow-hidden">
                <div className="flex justify-between items-center mb-10">
                  <h3 className="text-lg font-medium tracking-tight text-white">Hourly Foot Traffic</h3>
                  <div className="flex gap-2">
                    <span className="px-3 py-1 bg-surface-variant text-[0.6875rem] font-medium rounded-md cursor-pointer border border-surface-border">Day</span>
                    <span className="px-3 py-1 hover:bg-surface-variant text-[0.6875rem] font-medium rounded-md cursor-pointer text-neutral-500">Week</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={256}>
                  <BarChart data={hourlyData} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="#262626" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: '#737373', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Bar dataKey="count" fill="#ffffff" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Demographics Donut */}
              <div className="lg:col-span-2 card-neutral p-8 rounded-xl flex flex-col items-center justify-center">
                <h3 className="w-full text-lg font-medium tracking-tight text-white mb-8">Demographics</h3>
                <div className="relative" style={{ width: 240, height: 240 }}>
                  <PieChart width={240} height={240}>
                    <Pie
                      data={[
                        { name: 'Male', value: demographics.Male || 0 },
                        { name: 'Female', value: demographics.Female || 0 },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={112}
                      dataKey="value"
                      strokeWidth={0}
                      labelLine={false}
                    >
                      <Cell fill="#6b7280" />
                      <Cell fill="#ffffff" />
                    </Pie>
                  </PieChart>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-bold text-white">Total</span>
                    <span className="text-sm font-mono text-neutral-500">{demoTotal}</span>
                  </div>
                </div>
                <div className="w-full grid grid-cols-2 gap-4 mt-2">
                  <div className="bg-surface-variant p-3 rounded-lg border border-surface-border flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-white flex-shrink-0"></div>
                    <div className="flex flex-col">
                      <span className="text-[0.6875rem] uppercase text-neutral-500 font-medium">Male</span>
                      <span className="text-lg font-bold">{demographics.Male || 0}</span>
                    </div>
                  </div>
                  <div className="bg-surface-variant p-3 rounded-lg border border-surface-border flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#6b7280] flex-shrink-0"></div>
                    <div className="flex flex-col">
                      <span className="text-[0.6875rem] uppercase text-neutral-500 font-medium">Female</span>
                      <span className="text-lg font-bold">{demographics.Female || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* BOTTOM ROW: Recent Events */}
            <div className="card-neutral rounded-xl overflow-hidden">
              <div className="p-6 border-b border-surface-border flex justify-between items-center">
                <h3 className="text-lg font-medium tracking-tight text-white">Recent Events</h3>
                <button className="text-[0.6875rem] uppercase font-bold tracking-[0.1em] text-white hover:underline transition-all">
                  Export Data
                </button>
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
                    {events.map((event, idx) => (
                      <tr
                        key={idx}
                        className={`${idx % 2 === 0 ? 'bg-[#171717]' : 'bg-black'} hover:bg-[#262626] transition-colors`}
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
            </div>
          </>
        )}

        {/* ── Cameras Page ── */}
        {activePage === 'cameras' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Live Monitoring</h2>

            {/* Top row: input cards */}
            <div className="grid grid-cols-2 gap-6 mb-6">

              {/* Upload Video */}
              <div className="card-neutral p-6 rounded-xl">
                <h3 className="text-lg font-medium text-white mb-4">Upload Video</h3>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-neutral-400 mb-4 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface-variant file:text-white hover:file:bg-neutral-700 cursor-pointer"
                />
                {uploadedPath && (
                  <p className="text-xs font-mono text-neutral-500 mb-4 truncate">{uploadedPath}</p>
                )}
                <button
                  onClick={() => handleStart('video')}
                  disabled={!uploadedPath}
                  className="w-full py-2 px-4 bg-white text-black rounded-lg text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-200 transition-colors"
                >
                  Start Processing
                </button>
              </div>

              {/* RTSP / Live Camera */}
              <div className="card-neutral p-6 rounded-xl">
                <h3 className="text-lg font-medium text-white mb-4">RTSP / Live Camera</h3>
                <input
                  type="text"
                  placeholder="rtsp://192.168.1.x:554/stream"
                  value={rtspUrl}
                  onChange={e => setRtspUrl(e.target.value)}
                  className="w-full bg-surface-variant border border-surface-border rounded-lg px-4 py-2 text-sm text-white placeholder-neutral-500 mb-4 outline-none focus:border-neutral-500 transition-colors"
                />
                <button
                  onClick={() => handleStart('rtsp')}
                  disabled={!rtspUrl}
                  className="w-full py-2 px-4 bg-white text-black rounded-lg text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-200 transition-colors"
                >
                  Connect
                </button>
              </div>
            </div>

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
                </div>
                <div className="flex flex-col items-end gap-3 min-w-[200px]">
                  {targetStatus === 'found' && (
                    <span className="flex items-center gap-2 bg-green-500/10 text-green-400 border border-green-500/20 px-3 py-1.5 rounded-full text-xs font-mono font-bold">
                      <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
                      Found: #FT-{targetFaceId?.slice(0, 5).toUpperCase()}
                    </span>
                  )}
                  {targetStatus === 'searching' && (
                    <span className="flex items-center gap-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-3 py-1.5 rounded-full text-xs font-mono font-bold">
                      <span className="animate-ping w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0"></span>
                      Searching across cameras...
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

            {/* Camera selector row */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-mono text-neutral-500 uppercase tracking-wider">Camera:</span>
              {CAMERAS.map(cam => (
                <button
                  key={cam.id}
                  onClick={() => handleCamSelect(cam.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-colors ${
                    activeCam === cam.id
                      ? 'bg-white text-black'
                      : 'bg-surface-variant text-neutral-400 hover:text-white border border-surface-border'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>

            {/* Bottom row: live feed + stats */}
            <div className="flex gap-6">

              {/* Live Feed (70%) */}
              <div className="flex-[7] card-neutral p-4 rounded-xl">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-white">Live Feed</h3>
                    <span className="text-xs font-mono text-neutral-500 uppercase">{activeCam.replace('_', ' ')}</span>
                  </div>
                  {isStreaming && (
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
                      </span>
                      <span className="text-xs font-mono text-tertiary uppercase">Live</span>
                    </div>
                  )}
                </div>
                {isStreaming ? (
                  <img
                    src={`http://localhost:8000/stream/feed?camera_id=${activeCam}`}
                    className="w-full rounded-lg bg-black"
                    alt="Live camera feed"
                  />
                ) : (
                  <div className="w-full h-64 rounded-lg bg-surface-variant flex items-center justify-center border border-surface-border border-dashed">
                    <div className="text-center">
                      <span className="material-symbols-outlined text-5xl text-neutral-600 block mb-2">videocam_off</span>
                      <p className="text-neutral-500 text-sm font-mono">NO STREAM ACTIVE</p>
                    </div>
                  </div>
                )}

                {/* Legend */}
                {isStreaming && (
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
                )}

                {isStreaming && (
                  <button
                    onClick={handleStop}
                    className="mt-4 w-full py-2 px-4 bg-error/10 text-error border border-error/20 rounded-lg text-sm font-bold hover:bg-error/20 transition-colors"
                  >
                    Stop Stream
                  </button>
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
          </div>
        )}

      </main>
    </div>
  )
}
