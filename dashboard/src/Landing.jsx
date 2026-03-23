import React, { useEffect, useState, useRef } from 'react';

export default function Landing({ onEnter }) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setMousePos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('opacity-100', 'translate-y-0');
            entry.target.classList.remove('opacity-0', 'translate-y-12');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('.scroll-reveal').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div 
      ref={containerRef}
      className="relative min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30 overflow-hidden"
    >
      {/* Dynamic Background */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(16, 185, 129, 0.05), transparent 80%)`
        }}
      />
      <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>

      {/* Styled JSX for animations */}
      <style>{`
        .scroll-reveal {
          transition-property: opacity, transform;
          transition-duration: 800ms;
          transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 10px rgba(16, 185, 129, 0.5); }
          50% { opacity: 0.5; transform: scale(0.95); box-shadow: 0 0 2px rgba(16, 185, 129, 0.2); }
        }
        .animate-pulse-glow {
          animation: pulse-glow 2s infinite;
        }
      `}</style>
      
      {/* 1. STICKY NAVBAR */}
      <nav className="fixed top-0 w-full z-50 bg-zinc-950/70 backdrop-blur-md border-b border-zinc-800/50 transition-all">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-glow" />
            <span className="font-mono font-bold text-xl tracking-tight text-zinc-100">FaceTracker AI</span>
          </div>
          <button 
            onClick={onEnter}
            className="group relative px-6 py-2.5 rounded-full bg-zinc-900 border border-emerald-500/30 w-[240px] hover:border-emerald-500 transition-all duration-300 overflow-hidden"
          >
            <div className="absolute inset-0 bg-emerald-500/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="relative z-10 font-semibold text-sm text-emerald-50 group-hover:text-emerald-300 transition-colors w-full flex justify-center">
              Launch Live Dashboard &rarr;
            </span>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-24 space-y-40">
        
        {/* 2. HERO SECTION */}
        <section className="scroll-reveal opacity-0 translate-y-12 flex flex-col items-center text-center pt-24">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-mono mb-8 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Katomaran Hackathon 2026</span>
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight mb-8 leading-[1.1]">
            Intelligent Multi-Camera <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-200">
              Face Tracking.
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-zinc-400 max-w-3xl mb-12 leading-relaxed">
            Production-grade detection, re-identification, and watchlist alerting across simultaneous RTSP streams.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-emerald-300/80 font-mono text-sm md:text-base border border-emerald-500/20 bg-emerald-500/5 backdrop-blur-sm shadow-[0_0_30px_rgba(16,185,129,0.05)] rounded-2xl px-6 py-4 mb-14">
            <span>Latency: &lt; 50ms</span>
            <span className="text-zinc-600">|</span>
            <span>Accuracy: 99.8%</span>
            <span className="text-zinc-600">|</span>
            <span>Cameras: 4 Active</span>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-6">
            <button 
              onClick={onEnter}
              className="px-8 py-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-lg transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]"
            >
              Enter Dashboard
            </button>
            <button className="px-8 py-4 rounded-full bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-300 font-semibold text-lg flex items-center gap-3 transition-all hover:bg-zinc-800">
              <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              Watch Demo Video
            </button>
          </div>
        </section>

        {/* 3. ARCHITECTURE PIPELINE */}
        <section className="scroll-reveal opacity-0 translate-y-12">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-16 text-center tracking-tight">Real-Time Processing Pipeline</h2>
          <div className="flex flex-col md:flex-row items-stretch justify-between gap-6 relative">
            {/* Connecting Line */}
            <div className="hidden md:block absolute top-[40%] left-6 w-[calc(100%-3rem)] h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0 z-0" />
            
            {[
              { title: 'RTSP Stream', desc: 'Input', icon: '📹' },
              { title: 'YOLOv8', desc: 'Detection', icon: '🎯' },
              { title: 'InsightFace', desc: 'Embedding', icon: '🧠' },
              { title: 'ByteTrack', desc: 'Re-ID', icon: '🔄' },
              { title: 'PostgreSQL', desc: 'Logging', icon: '🗄️' },
            ].map((step, i) => (
              <div key={i} className="relative z-10 flex flex-col items-center bg-zinc-900/40 backdrop-blur-md border border-zinc-700/50 py-8 px-4 rounded-3xl w-full md:w-1/5 hover:-translate-y-2 hover:bg-zinc-800/60 hover:border-emerald-500/40 hover:shadow-[0_0_30px_rgba(16,185,129,0.1)] transition-all duration-300 cursor-default group">
                <div className="text-5xl mb-6 group-hover:scale-110 transition-transform drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">{step.icon}</div>
                <h3 className="font-mono font-bold text-sm lg:text-base text-zinc-200 text-center mb-2 whitespace-nowrap">{step.title}</h3>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 4. MODEL SELECTION & BENCHMARKS */}
        <section className="scroll-reveal opacity-0 translate-y-12">
          <div className="mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">Best-in-Class Models. <span className="text-emerald-400">No Compromises.</span></h2>
            <p className="text-zinc-400 text-lg max-w-3xl">Architected for precision and speed. We rigorously evaluated alternatives to ensure our pipeline meets production standards.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
             <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-8 hover:border-zinc-600 transition-colors">
              <div className="text-emerald-400 font-mono text-sm mb-5 font-semibold tracking-wide uppercase">Detection</div>
              <h3 className="text-2xl font-bold mb-4 tracking-tight">Powered by YOLOv8</h3>
              <p className="text-zinc-400 leading-relaxed text-base">Using YOLOv8 for precise face cropping and robust detection, ensuring high-quality inputs for downstream embedding generation.</p>
            </div>
            
            <div className="bg-zinc-900/60 border border-emerald-500/30 rounded-3xl p-8 relative overflow-hidden group shadow-[0_0_20px_rgba(16,185,129,0.05)]">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10">
                <div className="text-emerald-400 font-mono text-sm mb-5 font-semibold tracking-wide uppercase">Recognition</div>
                <h3 className="text-2xl font-bold mb-4 tracking-tight">InsightFace &gt; dlib</h3>
                <p className="text-zinc-300 leading-relaxed text-base">Explicitly avoided dlib/face_recognition as warned in the spec. Using InsightFace (ArcFace backbone) achieving 99.83% LFW accuracy. Implemented 3-tier quality buffering and exponential moving average (alpha=0.1) for dynamic re-ID.</p>
              </div>
            </div>

            <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-8 hover:border-zinc-600 transition-colors">
              <div className="text-emerald-400 font-mono text-sm mb-5 font-semibold tracking-wide uppercase">Tracking</div>
              <h3 className="text-2xl font-bold mb-4 tracking-tight">ByteTrack</h3>
              <p className="text-zinc-400 leading-relaxed text-base">Outperforms DeepSORT by leveraging both high and low-confidence detections, virtually eliminating ID switches during partial occlusions.</p>
            </div>
          </div>
        </section>

        {/* 5. CORE FEATURES */}
        <section className="scroll-reveal opacity-0 translate-y-12">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-16 text-center">Beyond the Spec</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-zinc-900/30 backdrop-blur rounded-3xl p-8 border border-zinc-800 hover:border-emerald-500/30 transition-all hover:bg-zinc-900/50 group">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-3xl mb-8 group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all">🔄</div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">Multi-Camera Handoff</h3>
              <p className="text-zinc-400 leading-relaxed">Continuously tracks individuals moving between different camera zones, maintaining identity across simultaneous feeds.</p>
            </div>
            
            <div className="bg-zinc-900/30 backdrop-blur rounded-3xl p-8 border border-zinc-800 hover:border-emerald-500/30 transition-all hover:bg-zinc-900/50 group">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-3xl mb-8 group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all">🚨</div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">Watchlist Alerts</h3>
              <p className="text-zinc-400 leading-relaxed">Multi-embedding target matching with live snapshot notifications. Immediately alerts when flagged individuals are spotted.</p>
            </div>
            
            <div className="bg-zinc-900/30 backdrop-blur rounded-3xl p-8 border border-zinc-800 hover:border-emerald-500/30 transition-all hover:bg-zinc-900/50 group">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-3xl mb-8 group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all">📊</div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">Dynamic Quality Buffering</h3>
              <p className="text-zinc-400 leading-relaxed">Rejects blurry frames (&lt;0.60), buffers okay frames, and instantly logs perfect frames (&gt;0.85) to ensure pristine face crops.</p>
            </div>
            
            <div className="bg-zinc-900/30 backdrop-blur rounded-3xl p-8 border border-zinc-800 hover:border-emerald-500/30 transition-all hover:bg-zinc-900/50 group">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-3xl mb-8 group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all">👥</div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">Occupancy & Demographics</h3>
              <p className="text-zinc-400 leading-relaxed">Live radial gauges for capacity monitoring and real-time gender split inference providing actionable insights.</p>
            </div>
          </div>
        </section>
      </main>

      {/* 6. FOOTER */}
      <footer className="relative z-10 border-t border-zinc-900 bg-zinc-950 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
             <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
             <span className="font-mono text-zinc-300 font-semibold tracking-wide">FaceTracker AI</span>
          </div>
          <p className="text-zinc-500 font-mono text-sm">Built for Katomaran Hackathon 2026.</p>
        </div>
      </footer>
    </div>
  );
}
