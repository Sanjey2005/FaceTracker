import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useInView, useMotionValue, useSpring, useTransform, animate } from 'framer-motion';
import { 
  Video, 
  Target, 
  Brain, 
  RefreshCcw, 
  Database, 
  ArrowRight, 
  Check, 
  X, 
  RefreshCw, 
  Bell, 
  ShieldAlert, 
  Users, 
  BarChart3, 
  ChevronRight,
  Play
} from 'lucide-react';

// --- AI Cursor Background Component ---
function AICursor() {
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);
  const springConfig = { damping: 25, stiffness: 120, mass: 0.5 };
  const smoothX = useSpring(cursorX, springConfig);
  const smoothY = useSpring(cursorY, springConfig);

  useEffect(() => {
    const moveCursor = (e) => {
      cursorX.set(e.clientX - 64);
      cursorY.set(e.clientY - 64);
    };
    window.addEventListener("mousemove", moveCursor);
    return () => window.removeEventListener("mousemove", moveCursor);
  }, [cursorX, cursorY]);

  return (
    <motion.div
      style={{ x: smoothX, y: smoothY }}
      className="hidden md:block fixed top-0 left-0 w-32 h-32 pointer-events-none z-40 mix-blend-screen"
    >
      <div className="absolute -top-7 left-0 bg-emerald-500/10 text-emerald-400 font-mono text-[10px] px-2 py-0.5 border border-emerald-500/30 backdrop-blur-md whitespace-nowrap">
        TARGET LOCK: 0.99
      </div>
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-emerald-500/80"></div>
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-emerald-500/80"></div>
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-emerald-500/80"></div>
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-emerald-500/80"></div>
      <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-emerald-500/80 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
    </motion.div>
  );
}

// --- Text Scramble Effect ---
const CHARS = "!<>-_\\\\/[]{}—=+*^?#________";
function ScrambleText({ text }) {
  const [displayText, setDisplayText] = useState(text);
  const [isScrambling, setIsScrambling] = useState(false);

  const scramble = () => {
    if (isScrambling) return;
    setIsScrambling(true);
    let iterations = 0;
    const interval = setInterval(() => {
      setDisplayText(
        text
          .split("")
          .map((char, index) => {
            if (index < iterations) return text[index];
            return CHARS[Math.floor(Math.random() * CHARS.length)];
          })
          .join("")
      );
      if (iterations >= text.length) {
        clearInterval(interval);
        setIsScrambling(false);
      }
      iterations += 1/3;
    }, 30);
  };

  useEffect(() => {
    setTimeout(scramble, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span onMouseEnter={scramble} className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 via-emerald-400 to-emerald-200 text-gradient-shimmer inline-block cursor-crosshair relative z-10">{displayText}</span>;
}

// --- Animated Cyber Eye Background ---
function AnimatedCyberEye({ className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] sm:w-[800px] sm:h-[800px]", opacity=0.25 }) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  useEffect(() => {
    const handleMouseMove = (e) => {
      // Calculate normalized mouse position from center of screen (-1 to 1)
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      mouseX.set(x);
      mouseY.set(y);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mouseX, mouseY]);

  // Smooth springs for eye tracking
  const eyeX = useSpring(useTransform(mouseX, [-1, 1], [-20, 20]), { stiffness: 50, damping: 20 });
  const eyeY = useSpring(useTransform(mouseY, [-1, 1], [-20, 20]), { stiffness: 50, damping: 20 });
  
  const innerPupilX = useSpring(useTransform(mouseX, [-1, 1], [-35, 35]), { stiffness: 60, damping: 15 });
  const innerPupilY = useSpring(useTransform(mouseY, [-1, 1], [-35, 35]), { stiffness: 60, damping: 15 });

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.8 }}
      whileInView={{ opacity: opacity, scale: 1 }}
      viewport={{ once: true, margin: "200px" }}
      transition={{ duration: 2, ease: "easeOut" }}
      className={`pointer-events-none z-[0] flex items-center justify-center mix-blend-screen ${className}`}
    >
      <svg viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* Outer Grid Ring - Rotates slowly */}
        <motion.circle 
          cx="250" cy="250" r="220" 
          stroke="url(#emeraldGradient)" strokeWidth="2" strokeDasharray="4 12" opacity="0.4"
          animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          style={{ originX: "50%", originY: "50%" }}
        />
        
        {/* Middle Tech Ring - Counter rotates */}
        <motion.circle 
          cx="250" cy="250" r="180" 
          stroke="#10b981" strokeWidth="1" strokeDasharray="60 20 10 20" opacity="0.6"
          animate={{ rotate: -360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          style={{ originX: "50%", originY: "50%" }}
        />

        {/* The White/Emerald Sclera Outline */}
        <path d="M50 250 C 150 100, 350 100, 450 250 C 350 400, 150 400, 50 250 Z" 
              stroke="#10b981" strokeWidth="3" opacity="0.3" fill="rgba(16, 185, 129, 0.02)"/>
        
        {/* The Moving Iris */}
        <motion.g style={{ x: eyeX, y: eyeY }}>
          {/* Iris Base */}
          <circle cx="250" cy="250" r="80" stroke="#10b981" strokeWidth="2" opacity="0.8" fill="rgba(16, 185, 129, 0.05)" />
          {/* Iris Tech Details */}
          <motion.circle 
            cx="250" cy="250" r="70" 
            stroke="#10b981" strokeWidth="4" strokeDasharray="2 8" opacity="0.9"
            animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            style={{ originX: "50%", originY: "50%" }}
          />
          <circle cx="250" cy="250" r="50" stroke="#34d399" strokeWidth="1" opacity="0.5" />
        </motion.g>

        {/* The Moving Pupil */}
        <motion.g style={{ x: innerPupilX, y: innerPupilY }}>
          <circle cx="250" cy="250" r="25" fill="#34d399" opacity="0.9" />
          <circle cx="250" cy="250" r="10" fill="#000000" />
          {/* Cyber crosshair on pupil */}
          <path d="M 250 210 L 250 290 M 210 250 L 290 250" stroke="#10b981" strokeWidth="1" opacity="0.7"/>
        </motion.g>

        <defs>
          <linearGradient id="emeraldGradient" x1="0" y1="0" x2="500" y2="500">
            <stop offset="0%" stopColor="#10b981" stopOpacity="1" />
            <stop offset="50%" stopColor="#34d399" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="1" />
          </linearGradient>
        </defs>
      </svg>
    </motion.div>
  );
}

// --- Helper for Number Count Up Animation ---
function Counter({ from, to, duration = 2, delay = 0, suffix = "", prefix = "", decimals = 0 }) {
  const nodeRef = useRef(null);
  const inView = useInView(nodeRef, { once: true, margin: "-50px" });

  useEffect(() => {
    if (inView && nodeRef.current) {
      const controls = animate(from, to, {
        duration,
        delay,
        ease: "easeOut",
        onUpdate(value) {
          if (nodeRef.current) {
            nodeRef.current.textContent = `${prefix}${value.toFixed(decimals)}${suffix}`;
          }
        },
      });
      return () => controls.stop();
    }
  }, [from, to, duration, delay, inView, prefix, suffix, decimals]);

  return <span ref={nodeRef}>{prefix}{from.toFixed(decimals)}{suffix}</span>;
}

// --- Magnetic Button Helper ---
function MagneticButton({ children, className, onClick, ...props }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.2, y: middleY * 0.2 });
  };

  const reset = () => {
    setPosition({ x: 0, y: 0 });
  };

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      className={className}
      onClick={onClick}
      {...props}
    >
      {children}
    </motion.button>
  );
}

// --- Internal Hover Spotlight Card ---
function SpotlightCard({ children, className = "" }) {
  const divRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e) => {
    if (!divRef.current || isFocused) return;
    const div = divRef.current;
    const rect = div.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleFocus = () => { setIsFocused(true); setOpacity(1); };
  const handleBlur = () => { setIsFocused(false); setOpacity(0); };
  const handleMouseEnter = () => { setOpacity(1); };
  const handleMouseLeave = () => { setOpacity(0); };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative overflow-hidden rounded-3xl border border-zinc-800/50 bg-zinc-950 p-8 ${className}`}
    >
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition duration-300"
        style={{
          opacity,
          background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(16, 185, 129, 0.1), transparent 40%)`,
        }}
      />
      {children}
    </div>
  );
}

// --- Main Landing Page ---
export default function Landing() {
  const navigate = useNavigate();
  
  // 1. Background Spotlight with throttle
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const requestRef = useRef();

  const updateMousePosition = useCallback((e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!requestRef.current) {
        requestRef.current = requestAnimationFrame(() => {
          updateMousePosition(e);
          requestRef.current = null;
        });
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [updateMousePosition]);

  // Navbar Scroll Logic
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="relative min-h-screen bg-black text-zinc-50 font-sans selection:bg-emerald-500/30 overflow-hidden">
      
      {/* Dynamic Animated Background */}
      {/* 1. Spotlight */}
      <div 
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300 mix-blend-screen"
        style={{
          background: `radial-gradient(800px circle at ${mousePos.x}px ${mousePos.y}px, rgba(16,185,129,0.06), transparent 80%)`
        }}
      />
      <AICursor />
      
      {/* 2. Grid */}
      <div className="fixed inset-0 z-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:32px_32px]"></div>
      
      {/* 3. Subtle animated noise/grain overlay */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none mix-blend-overlay" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cfilter id=\"noiseFilter\"%3E%3CfeTurbulence type=\"fractalNoise\" baseFrequency=\"0.85\" numOctaves=\"3\" stitchTiles=\"stitch\"/%3E%3C/filter%3E%3Crect width=\"100%25\" height=\"100%25\" filter=\"url(%23noiseFilter)\"/%3E%3C/svg%3E')" }}></div>

      {/* Styled JSX for keyframes */}
      <style>{`
        @keyframes flow {
          0% { stroke-dashoffset: 24; }
          100% { stroke-dashoffset: 0; }
        }
        .animate-flow {
          animation: flow 1s linear infinite;
        }
        @keyframes text-shimmer {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .text-gradient-shimmer {
          background-size: 200% auto;
          animation: text-shimmer 4s ease infinite;
        }
      `}</style>
      
      {/* --- NAVBAR --- */}
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="fixed top-0 w-full z-50 flex justify-center py-6 pointer-events-none"
      >
        <div 
          className={`pointer-events-auto flex items-center justify-between px-6 transition-all duration-500 ease-out border border-zinc-800/50 ${
            scrolled 
              ? "w-[90%] md:w-[700px] bg-zinc-900/80 backdrop-blur-xl rounded-full h-16 shadow-[0_4px_30px_rgba(0,0,0,0.5)]" 
              : "w-full max-w-7xl bg-transparent border-transparent h-20"
          }`}
        >
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="relative flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 relative z-10" />
              <div className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
            </div>
            <span className="font-sans font-bold text-lg tracking-tight text-zinc-100 group-hover:text-emerald-400 transition-colors">FaceTracker</span>
          </div>
          
          <MagneticButton 
            onClick={() => navigate('/dashboard')}
            className={`group relative flex items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 font-semibold text-sm transition-all duration-300 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] ${
              scrolled ? "h-10 px-5" : "h-12 px-6"
            }`}
            aria-label="Launch Live Dashboard"
          >
            <div className="absolute inset-0 bg-emerald-500/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <span className="relative z-10 text-zinc-300 group-hover:text-emerald-300 flex items-center gap-2">
              Launch <ArrowRight className="w-4 h-4" />
            </span>
          </MagneticButton>
        </div>
      </motion.nav>

      {/* --- MAIN CONTENT --- */}
      <main className="relative z-10 flex flex-col items-center">
        
        {/* HERO SECTION */}
        <section className="relative w-full max-w-7xl mx-auto px-6 pt-40 pb-32 flex flex-col items-center text-center">
          <AnimatedCyberEye />
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-medium mb-8 uppercase tracking-widest backdrop-blur-md"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Katomaran Hackathon 2026
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-balance text-6xl md:text-8xl lg:text-9xl font-extrabold tracking-[-0.04em] mb-8 leading-[1.05]"
          >
            Intelligent <br className="hidden md:block" />
            Multi-Camera <br className="hidden md:block"/>
            <ScrambleText text="Face Tracking." />
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="text-balance text-lg md:text-xl md:text-2xl text-zinc-400 max-w-3xl mb-14 leading-relaxed font-medium"
          >
            Production-grade detection, re-identification, and watchlist alerting across simultaneous RTSP streams.
          </motion.p>

          {/* Glass Chips Stats */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-4 mb-16 w-full px-4"
          >
            <div className="flex bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-2xl px-6 py-4 items-center gap-4 shadow-xl">
              <span className="text-zinc-500 font-mono text-sm uppercase tracking-wider">Latency</span>
              <span className="text-emerald-400 font-mono font-bold text-xl">
                &lt;<Counter from={200} to={48} duration={2} suffix="ms" />
              </span>
            </div>
            <div className="flex bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-2xl px-6 py-4 items-center gap-4 shadow-xl">
              <span className="text-zinc-500 font-mono text-sm uppercase tracking-wider">Accuracy</span>
              <span className="text-emerald-400 font-mono font-bold text-xl">
                <Counter from={0} to={99.8} decimals={1} duration={2.5} suffix="%" />
              </span>
            </div>
            <div className="flex bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-2xl px-6 py-4 items-center gap-4 shadow-xl">
              <span className="text-zinc-500 font-mono text-sm uppercase tracking-wider">Active Cams</span>
              <span className="text-emerald-400 font-mono font-bold text-xl">
                <Counter from={0} to={4} duration={1.5} />
              </span>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="flex flex-col sm:flex-row gap-6"
          >
            <MagneticButton 
              onClick={() => navigate('/dashboard')}
              className="px-8 py-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-lg transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] flex items-center justify-center gap-2 group"
            >
              Enter Dashboard
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </MagneticButton>
            <a 
              href="https://drive.google.com/file/d/1uHeVcUi3DYOPHCzVDEId8f6xvSzfIbey/view?usp=sharing"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Watch Demo Video"
              className="px-8 py-4 rounded-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-medium text-lg flex items-center justify-center gap-3 transition-colors hover:bg-zinc-800/80 group"
            >
              <div className="bg-zinc-800 group-hover:bg-zinc-700 p-1.5 rounded-full transition-colors flex items-center justify-center">
                <Play className="w-4 h-4 fill-zinc-300" />
              </div>
              Watch Demo Video
            </a>
          </motion.div>
        </section>

        {/* ARCHITECTURE PIPELINE */}
        <section className="w-full max-w-6xl mx-auto px-6 py-32 relative overflow-visible">
          <AnimatedCyberEye className="hidden md:flex absolute top-[50%] right-[-10%] -translate-y-1/2 w-[400px] h-[400px] sm:w-[600px] sm:h-[600px]" opacity={0.25} />
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
            className="text-center mb-24"
          >
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 text-balance">Real-Time Processing Pipeline</h2>
            <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto">From raw pixels to actionable intelligence in milliseconds.</p>
          </motion.div>

          <div className="relative flex flex-col md:flex-row items-center md:items-stretch justify-between gap-8 md:gap-4 w-full">
            {/* Animated SVG Line (Desktop only) */}
            <div className="hidden md:block absolute top-[50%] left-0 w-full h-[2px] -translate-y-1/2 z-0 pointer-events-none px-12">
              <svg width="100%" height="2" className="overflow-visible">
                <path 
                  d="M 0 1 L 10000 1" 
                  stroke="rgba(16, 185, 129, 0.3)" 
                  strokeWidth="2" 
                  strokeDasharray="8 8" 
                  className="animate-flow"
                />
              </svg>
            </div>

            {[
              { title: 'RTSP Stream', desc: 'Input', icon: Video, id: '01' },
              { title: 'YOLOv8', desc: 'Detection', icon: Target, id: '02' },
              { title: 'InsightFace', desc: 'Embedding', icon: Brain, id: '03' },
              { title: 'ByteTrack', desc: 'Re-ID', icon: RefreshCcw, id: '04' },
              { title: 'PostgreSQL', desc: 'Logging', icon: Database, id: '05' },
            ].map((step, i) => (
              <motion.div 
                key={step.id}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="relative z-10 flex flex-col items-center bg-zinc-950 border border-zinc-800/60 p-6 md:p-8 rounded-3xl w-full max-w-sm md:w-[19%] hover:border-emerald-500/50 hover:bg-zinc-900/80 transition-all duration-500 group shadow-2xl"
              >
                <div className="absolute top-4 left-5 text-[10px] font-mono font-bold text-zinc-700 tracking-wider">
                  {step.id}
                </div>
                <div className="bg-zinc-900 border border-zinc-800 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 transition-all duration-500">
                  <step.icon className="w-8 h-8 text-zinc-300 group-hover:text-emerald-400 transition-colors" />
                </div>
                <h3 className="font-mono font-bold text-sm lg:text-base text-zinc-100 text-center mb-2 whitespace-nowrap">{step.title}</h3>
                <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* MODEL BENCHMARKS */}
        <section className="w-full max-w-7xl mx-auto px-6 py-32 relative overflow-visible">
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
            className="mb-16 text-center"
          >
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 text-balance">Best-in-Class Models. <br/> <span className="text-emerald-400">No Compromises.</span></h2>
            <p className="text-zinc-400 text-lg md:text-xl max-w-3xl mx-auto text-balance">Evaluating architectural choices ensuring sub-50ms inference times under extreme load.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Detection Card */}
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="bg-zinc-950 border border-zinc-800/60 rounded-3xl p-8 hover:border-emerald-500/30 transition-colors shadow-2xl relative overflow-hidden group flex flex-col"
            >
               <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
               <div className="relative z-10 flex flex-col h-full">
                 <div className="flex items-center gap-3 mb-8">
                   <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl"><Target className="w-5 h-5 text-emerald-400" /></div>
                   <h3 className="text-xl font-bold text-zinc-100">Detection Engine</h3>
                 </div>
                 
                 <div className="space-y-4 mb-8 flex-grow">
                   <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-3"><Check className="w-5 h-5 text-emerald-400" /></div>
                     <p className="text-[10px] text-emerald-500 font-mono font-bold uppercase tracking-wider mb-2">Selected</p>
                     <p className="text-2xl font-bold text-zinc-100 font-sans tracking-tight">YOLOv8-Face</p>
                   </div>
                   
                   <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-5 relative grayscale opacity-75">
                     <div className="absolute top-0 right-0 p-3"><X className="w-5 h-5 text-zinc-500" /></div>
                     <p className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-wider mb-2">Rejected</p>
                     <p className="text-xl font-medium text-zinc-400 font-sans tracking-tight">MTCNN</p>
                   </div>
                 </div>

                 <div className="bg-zinc-900/40 rounded-xl p-5 border border-zinc-800/50 mt-auto">
                    <p className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest mb-2">Deciding Factor</p>
                    <p className="text-sm text-zinc-300 leading-relaxed font-medium">Unmatched inference speed & extreme angle robustness under dynamic lighting conditions.</p>
                 </div>
               </div>
            </motion.div>

            {/* Recognition Card */}
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-zinc-950 border border-emerald-500/30 rounded-3xl p-8 shadow-[0_0_30px_rgba(16,185,129,0.05)] relative overflow-hidden group flex flex-col"
            >
               <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
               <div className="relative z-10 flex flex-col h-full">
                 <div className="flex items-center gap-3 mb-8">
                   <div className="bg-zinc-900 border border-emerald-500/30 p-2.5 rounded-xl"><Brain className="w-5 h-5 text-emerald-400" /></div>
                   <h3 className="text-xl font-bold text-zinc-100">Quality & Embeddings</h3>
                 </div>
                 
                 <div className="space-y-4 mb-8 flex-grow">
                   <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 relative overflow-hidden shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                     <div className="absolute top-0 right-0 p-3"><Check className="w-5 h-5 text-emerald-400" /></div>
                     <p className="text-[10px] text-emerald-500 font-mono font-bold uppercase tracking-wider mb-2">Selected</p>
                     <p className="text-2xl font-bold text-zinc-100 font-sans tracking-tight">InsightFace</p>
                     <div className="mt-4 flex items-center justify-between text-[11px] font-mono font-bold">
                       <span className="text-zinc-400">LFW Accuracy</span>
                       <span className="text-emerald-400">99.83%</span>
                     </div>
                     <div className="w-full bg-zinc-900 h-1.5 rounded-full mt-2 overflow-hidden border border-zinc-800/80">
                       <motion.div initial={{ width: 0 }} whileInView={{ width: "99.83%" }} transition={{ duration: 1.5, delay: 0.5 }} className="h-full bg-emerald-400 rounded-full" />
                     </div>
                   </div>
                   
                   <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-5 relative grayscale opacity-75">
                     <div className="absolute top-0 right-0 p-3"><X className="w-5 h-5 text-zinc-500" /></div>
                     <p className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-wider mb-2">Rejected</p>
                     <p className="text-xl font-medium text-zinc-400 font-sans tracking-tight">dlib</p>
                     <div className="mt-4 flex items-center justify-between text-[11px] font-mono font-bold">
                       <span className="text-zinc-500">LFW Accuracy</span>
                       <span className="text-zinc-500">99.38%</span>
                     </div>
                     <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
                       <div className="h-full w-[99.38%] bg-zinc-600 rounded-full" />
                     </div>
                   </div>
                 </div>

                 <div className="bg-zinc-900/40 rounded-xl p-5 border border-zinc-800/50 mt-auto">
                    <p className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest mb-2">Deciding Factor</p>
                    <p className="text-sm text-zinc-300 leading-relaxed font-medium">ArcFace / ResNet architecture significantly eclipsed dlib on diverse facial orientations.</p>
                 </div>
               </div>
            </motion.div>

            {/* Tracking Card */}
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="bg-zinc-950 border border-zinc-800/60 rounded-3xl p-8 hover:border-emerald-500/30 transition-colors shadow-2xl relative overflow-hidden group flex flex-col"
            >
               <div className="absolute inset-0 bg-gradient-to-bl from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
               <div className="relative z-10 flex flex-col h-full">
                 <div className="flex items-center gap-3 mb-8">
                   <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl"><RefreshCcw className="w-5 h-5 text-emerald-400" /></div>
                   <h3 className="text-xl font-bold text-zinc-100">Tracking (Re-ID)</h3>
                 </div>
                 
                 <div className="space-y-4 mb-8 flex-grow">
                   <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-3"><Check className="w-5 h-5 text-emerald-400" /></div>
                     <p className="text-[10px] text-emerald-500 font-mono font-bold uppercase tracking-wider mb-2">Selected</p>
                     <p className="text-2xl font-bold text-zinc-100 font-sans tracking-tight">ByteTrack</p>
                   </div>
                   
                   <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-5 relative grayscale opacity-75">
                     <div className="absolute top-0 right-0 p-3"><X className="w-5 h-5 text-zinc-500" /></div>
                     <p className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-wider mb-2">Rejected</p>
                     <p className="text-xl font-medium text-zinc-400 font-sans tracking-tight">DeepSORT</p>
                   </div>
                 </div>

                 <div className="bg-zinc-900/40 rounded-xl p-5 border border-zinc-800/50 mt-auto">
                    <p className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest mb-2">Deciding Factor</p>
                    <p className="text-sm text-zinc-300 leading-relaxed font-medium">By matching both high & low confidence detections, ByteTrack virtually eliminates ID switches.</p>
                 </div>
               </div>
            </motion.div>
          </div>
        </section>

        {/* CORE FEATURES (Bento Grid) */}
        <section className="w-full max-w-7xl mx-auto px-6 py-32 mb-10 relative overflow-visible">
          <AnimatedCyberEye className="hidden md:flex absolute -top-[15%] left-[-10%] w-[400px] h-[400px] sm:w-[600px] sm:h-[600px]" opacity={0.25} />
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">Beyond the Spec</h2>
            <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto text-balance">Advanced capabilities built natively into the pipeline.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="md:col-span-2"
            >
              <SpotlightCard className="h-full min-h-[300px] flex flex-col justify-end">
                <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-8 relative z-10">
                  <RefreshCw className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold mb-3 tracking-tight text-zinc-100 relative z-10">Multi-Camera Handoff</h3>
                <p className="text-zinc-400 leading-relaxed text-balance relative z-10 max-w-md">
                  Continuously tracks individuals moving across different camera zones. Maintains identity state universally instead of per-stream, enabling global facility tracking.
                </p>
              </SpotlightCard>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <SpotlightCard className="h-full min-h-[300px] flex flex-col justify-end">
                <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-8 relative z-10">
                  <ShieldAlert className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold mb-3 tracking-tight text-zinc-100 relative z-10">Watchlist Alerts</h3>
                <p className="text-zinc-400 leading-relaxed text-balance relative z-10">
                  Multi-embedding target matching triggers instantaneous alerts when flagged individuals appear.
                </p>
              </SpotlightCard>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <SpotlightCard className="h-full min-h-[300px] flex flex-col justify-end">
                <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-8 relative z-10">
                  <BarChart3 className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold mb-3 tracking-tight text-zinc-100 relative z-10">Quality Buffering</h3>
                <p className="text-zinc-400 leading-relaxed text-balance relative z-10">
                  Smart rejection of blurry frames. Instantly logs pristine frames (&gt;0.85 confidence) to the database.
                </p>
              </SpotlightCard>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="md:col-span-2"
            >
              <SpotlightCard className="h-full min-h-[300px] flex flex-col justify-end">
                <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-8 relative z-10">
                  <Users className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold mb-3 tracking-tight text-zinc-100 relative z-10">Occupancy & Demographics</h3>
                <p className="text-zinc-400 leading-relaxed text-balance relative z-10 max-w-lg">
                  Integrates with live dashboard components. Real-time capacity gauge and gender split estimation directly inferred from the ArcFace embeddings.
                </p>
              </SpotlightCard>
            </motion.div>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-zinc-900/50 bg-black mt-10">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
             <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
             <span className="font-sans font-bold text-lg text-zinc-200 tracking-tight">FaceTracker</span>
          </div>
          <p className="text-zinc-500 font-mono text-xs uppercase tracking-wider">Built for Katomaran Hackathon 2026.</p>
        </div>
      </footer>
    </div>
  );
}
