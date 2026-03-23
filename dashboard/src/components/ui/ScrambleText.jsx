import React, { useState, useEffect } from 'react';

const CHARS = "!<>-_\\\\/[]{}—=+*^?#________";
export function ScrambleText({ text }) {
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
