"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Code2,
  FolderOpen,
  Globe,
  ShieldCheck,
} from "lucide-react";
import { ChromeMark, FoxMark } from "./motion-ui";

export default function BrowserHandoff({ enabled }: { enabled: boolean }) {
  const reduced = useReducedMotion();
  const active = enabled && !reduced;
  const x = useMotionValue(0),
    y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 100, damping: 22 }),
    sy = useSpring(y, { stiffness: 100, damping: 22 });
  const rotateX = useTransform(sy, [-1, 1], [4, -4]);
  const rotateY = useTransform(sx, [-1, 1], [-5, 5]);
  return (
    <motion.div
      className="handoff-scene"
      aria-hidden="true"
      style={
        active ? { rotateX, rotateY, transformPerspective: 1000 } : undefined
      }
      onPointerMove={(event) => {
        if (!active || event.pointerType !== "mouse") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        x.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1);
        y.set(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <div className="scene-orbit orbit-one" />
      <div className="scene-orbit orbit-two" />
      <span className="scene-spark spark-one">✳</span>
      <span className="scene-spark spark-two">+</span>
      <motion.div
        className="browser-card chrome-card"
        animate={
          active
            ? { y: [0, -7, 0], rotate: [-10, -9, -10] }
            : { y: 0, rotate: -10 }
        }
        transition={
          active
            ? { duration: 6, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0 }
        }
      >
        <div className="browser-chrome">
          <span />
          <span />
          <span />
          <div>
            <Globe size={9} />
            your-extension
          </div>
        </div>
        <div className="browser-card-body">
          <div className="browser-identity">
            <ChromeMark size={31} />
            <div>
              <strong>Chrome</strong>
              <small>Where it begins</small>
            </div>
          </div>
          <div className="mock-extension">
            <div className="mock-extension-icon">
              <FolderOpen size={24} />
            </div>
            <div>
              <span className="mock-line long" />
              <span className="mock-line short" />
            </div>
            <Code2 size={13} />
          </div>
          <div className="mock-file-row">
            <span>manifest.json</span>
            <span>MV3</span>
          </div>
          <div className="mock-progress">
            <span />
            <span />
            <span />
          </div>
        </div>
      </motion.div>
      <svg className="handoff-path" viewBox="0 0 460 330">
        <path
          className="route-shadow"
          d="M103 203C116 268 170 280 232 224S300 75 365 143"
        />
        <motion.path
          className="route-line"
          d="M103 203C116 268 170 280 232 224S300 75 365 143"
          initial={active ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{
            duration: active ? 1.7 : 0,
            delay: active ? 0.3 : 0,
            ease: "easeInOut",
          }}
        />
        <motion.g
          animate={
            active
              ? {
                  x: [0, 48, 105, 160, 195, 240, 262],
                  y: [0, 49, 47, -10, -66, -93, -60],
                  opacity: [0, 1, 1, 1, 1, 1, 0],
                }
              : { x: 125, y: 23, opacity: 1 }
          }
          transition={
            active
              ? {
                  duration: 5,
                  repeat: Infinity,
                  repeatDelay: 1,
                  ease: "easeInOut",
                }
              : { duration: 0 }
          }
        >
          <circle cx="103" cy="203" r="17" fill="var(--accent)" />
          <path d="m96 199 7-4 7 4-7 4Z" fill="#fff3e8" />
          <path d="m96 199 7 4v8l-7-4Z" fill="#ffe3d2" />
          <path d="m103 203 7-4v8l-7 4Z" fill="#fff8f0" />
        </motion.g>
      </svg>
      <motion.div
        className="browser-card firefox-card"
        animate={
          active ? { y: [0, 6, 0], rotate: [7, 8, 7] } : { y: 0, rotate: 7 }
        }
        transition={
          active
            ? { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.5 }
            : { duration: 0 }
        }
      >
        <div className="browser-chrome">
          <span />
          <span />
          <span />
          <div>
            <ShieldCheck size={9} />
            a-new-home
          </div>
        </div>
        <div className="browser-card-body">
          <div className="browser-identity">
            <span className="browser-fox">
              <FoxMark />
            </span>
            <div>
              <strong>Firefox</strong>
              <small>Where you choose to go</small>
            </div>
          </div>
          <div className="mock-extension">
            <div className="mock-extension-icon">
              <FolderOpen size={24} />
            </div>
            <div>
              <span className="mock-line long" />
              <span className="mock-line short" />
            </div>
            <span className="mini-check">
              <Check size={13} />
            </span>
          </div>
          <div className="mock-file-row">
            <span>manifest.json</span>
            <span>
              <Check size={9} /> reviewed
            </span>
          </div>
          <div className="mock-ready">
            <span />
            More possibilities.
            <ArrowUpRight size={13} />
          </div>
        </div>
      </motion.div>
      <motion.div
        className="scene-sticker"
        initial={active ? { opacity: 0, rotate: -15, scale: 0.8 } : false}
        animate={{ opacity: 1, rotate: -8, scale: 1 }}
        transition={
          active
            ? { type: "spring", stiffness: 170, damping: 14, delay: 0.65 }
            : { duration: 0 }
        }
      >
        <ArrowUpRight size={20} />
        <span>
          MAKE
          <br />
          THE MOVE.
        </span>
      </motion.div>
      <span className="scene-caption">
        Same good idea. A little more freedom.
      </span>
    </motion.div>
  );
}
