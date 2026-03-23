import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

export function AICursor() {
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
