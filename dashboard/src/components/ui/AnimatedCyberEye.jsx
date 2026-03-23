import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

export function AnimatedCyberEye({ className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] sm:w-[800px] sm:h-[800px]", opacity=0.25 }) {
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
