"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";

export function ActionButton({
  children,
  className = "",
  motionEnabled = true,
  ...props
}: ComponentProps<typeof motion.button> & { motionEnabled?: boolean }) {
  const reduced = useReducedMotion();
  const active = motionEnabled && !reduced;
  return (
    <motion.button
      {...props}
      className={`button ${className}`}
      whileHover={active && !props.disabled ? { y: -2 } : undefined}
      whileTap={active && !props.disabled ? { scale: 0.97 } : undefined}
      transition={{ type: "spring", stiffness: 430, damping: 28 }}
    >
      {children}
    </motion.button>
  );
}

export function Reveal({
  children,
  className = "",
  delay = 0,
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  enabled?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      key={enabled && !reduced ? "animated" : "static"}
      className={className}
      initial={enabled && !reduced ? { opacity: 0, y: 16 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{
        duration: enabled && !reduced ? 0.45 : 0,
        delay: enabled && !reduced ? delay : 0,
        ease: [0.2, 0.8, 0.2, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

export function FoxMark({
  className = "",
  small = false,
}: {
  className?: string;
  small?: boolean;
}) {
  return (
    <svg
      className={`fox ${small ? "small" : ""} ${className}`}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path d="M9 10 25 21h14L55 10l-5 31-18 14-18-14Z" fill="currentColor" />
      <path
        d="m17 26 15 8 15-8-8 17-7 6-7-6Z"
        fill="var(--fox-face, #fff2df)"
      />
      <path d="m27 39 5 4 5-4Z" fill="var(--fox-nose, #272a26)" />
    </svg>
  );
}

export function ChromeMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="#f9f7f0" />
      <path
        d="M24 3a21 21 0 0 1 18.2 10.5H24v10.5L9.9 10.2A20.9 20.9 0 0 1 24 3Z"
        fill="#dc7055"
      />
      <path
        d="M42.2 13.5A21 21 0 0 1 24 45l9.1-15.8L24 24V13.5Z"
        fill="#eac36d"
      />
      <path
        d="M24 45A21 21 0 0 1 9.9 10.2L19.5 27 24 24l9.1 5.2Z"
        fill="#80b99c"
      />
      <circle
        cx="24"
        cy="24"
        r="9"
        fill="#7e9eb9"
        stroke="#fff8eb"
        strokeWidth="2.5"
      />
    </svg>
  );
}

export function PackageArt({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "package-art small" : "package-art"}
      viewBox="0 0 240 200"
      aria-hidden="true"
    >
      <ellipse
        cx="120"
        cy="170"
        rx="72"
        ry="14"
        fill="currentColor"
        opacity=".08"
      />
      <path d="m43 64 77-40 77 40-77 42Z" fill="var(--package-top)" />
      <path d="m43 64 77 42v72l-77-43Z" fill="var(--package-left)" />
      <path d="m120 106 77-42v71l-77 43Z" fill="var(--package-right)" />
      <path
        d="m101 34 18-10 77 41-19 11Z"
        fill="var(--package-tape)"
        opacity=".85"
      />
      <path
        d="m101 34 77 42v30l-17 9V85L84 44Z"
        fill="var(--package-tape)"
        opacity=".85"
      />
      <path d="m68 91 15 9 13-2-2 24-12 7-14-21Z" fill="#fff6e7" />
      <path d="m74 105 8 9 8-1-8 9Z" fill="var(--package-left)" />
      <path
        d="m137 127 42-24m-42 34 26-15"
        stroke="#fff8ed"
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".75"
      />
      <path
        d="m36 38 4-10 4 10 10 4-10 4-4 10-4-10-10-4Z"
        fill="var(--accent)"
      />
      <circle cx="200" cy="151" r="4" fill="var(--lavender)" />
      <path
        d="m191 27 4-4m9 13 4-4"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".4"
      />
    </svg>
  );
}
