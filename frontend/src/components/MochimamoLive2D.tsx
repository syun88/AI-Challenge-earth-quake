"use client";

import React, { useEffect, useRef, useCallback } from "react";

export type MochimamoMood =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "happy"
  | "alert";

interface PartSpec {
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

const SCENE_BOUNDS = { x: 220, y: 175, width: 735, height: 710 };
const BODY_PIVOT = { x: 504.0, y: 670.0 };
const HEAD_PIVOT = { x: 504.0, y: 495.0 };

const PARTS: Record<string, PartSpec> = {
  lanternPropeller: {
    file: "/mascot/mochimamo/lantern_propeller.png",
    x: 743.5,
    y: 206.5,
    width: 188,
    height: 46,
    anchorX: 92.5,
    anchorY: 15.5,
  },
  lanternBody: {
    file: "/mascot/mochimamo/lantern_body.png",
    x: 773.5,
    y: 236.0,
    width: 134,
    height: 176,
    anchorX: 62.5,
    anchorY: 94.0,
  },
  visorPlate: {
    file: "/mascot/mochimamo/visor_plate.png",
    x: 317.5,
    y: 246.0,
    width: 396,
    height: 279,
    anchorX: 193.5,
    anchorY: 141.5,
  },
  eyeL: {
    file: "/mascot/mochimamo/eyeL.png",
    x: 400.0,
    y: 340.0,
    width: 82,
    height: 82,
    anchorX: 41.5,
    anchorY: 43.5,
  },
  eyeR: {
    file: "/mascot/mochimamo/eyeR.png",
    x: 557.5,
    y: 340.0,
    width: 78,
    height: 82,
    anchorX: 39.0,
    anchorY: 42.5,
  },
  mouth: {
    file: "/mascot/mochimamo/mouth.png",
    x: 485.0,
    y: 395.0,
    width: 72,
    height: 45,
    anchorX: 36.0,
    anchorY: 22.0,
  },
  blushL: {
    file: "/mascot/mochimamo/blushL.png",
    x: 370.0,
    y: 407.5,
    width: 78,
    height: 55,
    anchorX: 38.0,
    anchorY: 27.5,
  },
  blushR: {
    file: "/mascot/mochimamo/blushR.png",
    x: 592.5,
    y: 407.5,
    width: 75,
    height: 55,
    anchorX: 36.5,
    anchorY: 26.0,
  },
  mizuhikiBow: {
    file: "/mascot/mochimamo/mizuhiki_bow.png",
    x: 293.5,
    y: 492.5,
    width: 430,
    height: 126,
    anchorX: 219.0,
    anchorY: 62.5,
  },
  headHood: {
    file: "/mascot/mochimamo/head_hood.png",
    x: 262.5,
    y: 195.0,
    width: 482,
    height: 348,
    anchorX: 241.5,
    anchorY: 215.0,
  },
  armLeft: {
    file: "/mascot/mochimamo/arm_left.png",
    x: 700.5,
    y: 473.5,
    width: 132,
    height: 127,
    anchorX: 27.5,
    anchorY: 79.5,
  },
  armRight: {
    file: "/mascot/mochimamo/arm_right.png",
    x: 295.0,
    y: 569.0,
    width: 150,
    height: 114,
    anchorX: 22.5,
    anchorY: 38.5,
  },
  holoMap: {
    file: "/mascot/mochimamo/holo_map.png",
    x: 614.5,
    y: 606.0,
    width: 298,
    height: 150,
    anchorX: 150.5,
    anchorY: 76.5,
  },
  footL: {
    file: "/mascot/mochimamo/footL.png",
    x: 340.0,
    y: 790.0,
    width: 105,
    height: 66,
    anchorX: 55.0,
    anchorY: 12.5,
  },
  footR: {
    file: "/mascot/mochimamo/footR.png",
    x: 565.0,
    y: 790.0,
    width: 108,
    height: 66,
    anchorX: 49.0,
    anchorY: 12.5,
  },
  torso: {
    file: "/mascot/mochimamo/torso.png",
    x: 254.5,
    y: 499.5,
    width: 498,
    height: 322,
    anchorX: 249.5,
    anchorY: 170.5,
  },
};

const THRUSTERS = [
  { x: 408.0, y: 788.0, rx: 19.0, ry: 11.0, rot: 0.35 },
  { x: 507.0, y: 811.0, rx: 14.0, ry: 13.0, rot: 0.0 },
  { x: 603.0, y: 786.0, rx: 19.0, ry: 11.0, rot: -0.35 },
];

type PartKey = keyof typeof PARTS;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
  tint: "cyan" | "gold";
}

interface RigState {
  t: number;
  angleX: number;
  angleY: number;
  angleZ: number;
  bodyAngleX: number;
  bodyAngleZ: number;
  eyeBallX: number;
  eyeBallY: number;
  eyeOpen: number;
  blinkTimer: number;
  blinkPhase: number;
  doubleBlinkQueued: boolean;
  mouthOpenY: number;
  armWaveL: number;
  armSwingR: number;
  hopY: number;
  hopVel: number;
  bowY: number;
  bowVel: number;
  bowRot: number;
  lanX: number;
  lanY: number;
  lanVx: number;
  lanVy: number;
  propPhase: number;
  tapBoost: number;
  speechTimer: number;
  pointerX: number;
  pointerY: number;
  pointerLastMove: number;
  particles: Particle[];
}

export interface MochimamoLive2DProps {
  mood?: MochimamoMood;
  /** Incrementing number (e.g. streamed char length) that pulses live lip-sync */
  speechPulseKey?: number;
  /** Real-time normalized RMS audio amplitude [0..1] for voice-driven lip-sync */
  audioLevelRef?: React.RefObject<number>;
  /** True while Gemini TTS audio is actively playing */
  isAudioPlaying?: boolean;
  /** Incrementing number to trigger a cheerful wave & hop programmatically */
  waveTrigger?: number;
  className?: string;
  interactive?: boolean;
  trackPointer?: boolean;
  onTap?: () => void;
  ariaLabel?: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function drawPart(
  ctx: CanvasRenderingContext2D,
  images: Partial<Record<PartKey, HTMLImageElement>>,
  key: PartKey,
  dx = 0,
  dy = 0,
  rot = 0,
  sx = 1,
  sy = 1,
  alpha = 1
) {
  const img = images[key];
  const spec = PARTS[key];
  if (!img || !img.complete || img.naturalWidth === 0 || alpha <= 0.01) return;

  const px = spec.x + spec.anchorX + dx;
  const py = spec.y + spec.anchorY + dy;

  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha *= alpha;
  ctx.translate(px, py);
  if (rot !== 0) ctx.rotate(rot);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.drawImage(img, -spec.anchorX, -spec.anchorY, spec.width, spec.height);
  ctx.restore();
}

function drawHappyArcEye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  glowColor: string
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 11;
  ctx.strokeStyle = color;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy + ry * 0.35);
  ctx.quadraticCurveTo(cx, cy - ry * 1.15, cx + rx, cy + ry * 0.35);
  ctx.stroke();
  ctx.restore();
}

function drawBlinkArcEye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  color: string,
  glowColor: string
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 9;
  ctx.strokeStyle = color;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy);
  ctx.quadraticCurveTo(cx, cy + 10, cx + rx, cy);
  ctx.stroke();
  ctx.restore();
}

function drawTalkingMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  openY: number,
  t: number
) {
  const w = 18 + openY * 8 + Math.sin(t * 13.5) * 3.2;
  const h = 3.5 + openY * 18.5;

  ctx.save();
  ctx.shadowColor = "#38e8ff";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#0e172a";
  ctx.strokeStyle = "#b8ffff";
  ctx.lineWidth = 6.5;

  ctx.beginPath();
  ctx.moveTo(cx - w, cy - h * 0.28);
  ctx.quadraticCurveTo(cx, cy - h * 0.5, cx + w, cy - h * 0.28);
  ctx.quadraticCurveTo(cx + w * 0.85, cy + h, cx, cy + h);
  ctx.quadraticCurveTo(cx - w * 0.85, cy + h, cx - w, cy - h * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawConcernedMouth(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 7.5;
  ctx.strokeStyle = "#a8faff";
  ctx.shadowColor = "#38e8ff";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(cx - 18, cy + 3);
  ctx.quadraticCurveTo(cx - 6, cy - 5, cx, cy + 1);
  ctx.quadraticCurveTo(cx + 6, cy + 7, cx + 18, cy - 1);
  ctx.stroke();
  ctx.restore();
}

/**
 * Live2D-style interactive 2D mascot renderer for Mochimamo ("もちまも").
 * Uses a hierarchical bone rig (Body Bone -> Head Bone -> Visor/Face parallax)
 * over high-resolution RGBA parts with 60fps pointer gaze tracking, natural blinking,
 * streaming lip-sync, and spring-damper physics on the mizuhiki bow and lantern drone.
 */
export function MochimamoLive2D({
  mood = "idle",
  speechPulseKey = 0,
  audioLevelRef,
  isAudioPlaying = false,
  waveTrigger = 0,
  className = "",
  interactive = true,
  trackPointer = true,
  onTap,
  ariaLabel = "もちまも Live2D アシスタント",
}: MochimamoLive2DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<Partial<Record<PartKey, HTMLImageElement>>>({});
  const moodRef = useRef<MochimamoMood>(mood);
  const externalAudioLevelRef = useRef<React.RefObject<number> | undefined>(audioLevelRef);
  const isAudioPlayingRef = useRef<boolean>(isAudioPlaying);
  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);
  useEffect(() => {
    externalAudioLevelRef.current = audioLevelRef;
  }, [audioLevelRef]);
  useEffect(() => {
    isAudioPlayingRef.current = isAudioPlaying;
  }, [isAudioPlaying]);

  const rigRef = useRef<RigState>({
    t: 0,
    angleX: 0,
    angleY: 0,
    angleZ: 0,
    bodyAngleX: 0,
    bodyAngleZ: 0,
    eyeBallX: 0,
    eyeBallY: 0,
    eyeOpen: 1,
    blinkTimer: 2.2,
    blinkPhase: 0,
    doubleBlinkQueued: false,
    mouthOpenY: 0,
    armWaveL: 0,
    armSwingR: 0,
    hopY: 0,
    hopVel: 0,
    bowY: 0,
    bowVel: 0,
    bowRot: 0,
    lanX: 0,
    lanY: 0,
    lanVx: 0,
    lanVy: 0,
    propPhase: 0,
    tapBoost: 0,
    speechTimer: 0,
    pointerX: 0,
    pointerY: 0,
    pointerLastMove: -10,
    particles: Array.from({ length: 9 }, (_, idx) => ({
      x: 350 + idx * 38,
      y: 825 + (idx % 3) * 20,
      vx: (idx % 2 === 0 ? 1 : -1) * (4 + idx * 0.5),
      vy: 14 + (idx % 4) * 3,
      radius: 2.8 + (idx % 3) * 1.4,
      alpha: 0.4 + (idx % 3) * 0.2,
      life: idx * 0.35,
      maxLife: 2.4 + (idx % 3) * 0.5,
      tint: "cyan",
    })),
  });

  const prevPulseRef = useRef(speechPulseKey);
  useEffect(() => {
    if (speechPulseKey !== prevPulseRef.current) {
      prevPulseRef.current = speechPulseKey;
      rigRef.current.speechTimer = 0.45;
    }
  }, [speechPulseKey]);

  const triggerJoyImpulse = useCallback(() => {
    const s = rigRef.current;
    s.hopVel = -220;
    s.tapBoost = 1.65;
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
      s.particles.push({
        x: 505 + Math.cos(ang) * 130,
        y: 420 + Math.sin(ang) * 90,
        vx: Math.cos(ang) * 45,
        vy: Math.sin(ang) * 35 - 25,
        radius: 4.5 + Math.random() * 2.5,
        alpha: 0.95,
        life: 0,
        maxLife: 0.9 + Math.random() * 0.3,
        tint: i % 2 === 0 ? "gold" : "cyan",
      });
    }
  }, []);

  const prevWaveRef = useRef(waveTrigger);
  useEffect(() => {
    if (waveTrigger !== prevWaveRef.current) {
      prevWaveRef.current = waveTrigger;
      triggerJoyImpulse();
    }
  }, [waveTrigger, triggerJoyImpulse]);

  useEffect(() => {
    let cancelled = false;
    (Object.keys(PARTS) as PartKey[]).forEach((key) => {
      const img = new Image();
      img.decoding = "async";
      img.src = PARTS[key].file;
      img.onload = () => {
        if (!cancelled) {
          imagesRef.current[key] = img;
        }
      };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!trackPointer) return;
    const onMove = (ev: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const cx = rect.left + rect.width * 0.46;
      const cy = rect.top + rect.height * 0.45;
      const nx = clamp((ev.clientX - cx) / Math.max(260, rect.width * 1.4), -1, 1);
      const ny = clamp((ev.clientY - cy) / Math.max(240, rect.height * 1.4), -1, 1);
      rigRef.current.pointerX = nx;
      rigRef.current.pointerY = ny;
      rigRef.current.pointerLastMove = rigRef.current.t;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [trackPointer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let lastTs = performance.now();

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cssW = canvas.clientWidth || 160;
      const cssH = canvas.clientHeight || 160;
      const targetW = Math.max(1, Math.round(cssW * dpr));
      const targetH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas);
    resizeCanvas();

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const s = rigRef.current;
      const curMood = moodRef.current;
      s.t += dt;
      if (s.tapBoost > 0) s.tapBoost = Math.max(0, s.tapBoost - dt);
      if (s.speechTimer > 0) s.speechTimer = Math.max(0, s.speechTimer - dt);

      // 1. Target Gaze & Posture by Mood + Pointer
      const pointerActive = s.t - s.pointerLastMove < 3.6;
      const idleGazeX = Math.sin(s.t * 0.58) * 0.24;
      const idleGazeY = Math.sin(s.t * 0.41) * 0.14;

      let targetGazeX = pointerActive ? s.pointerX : idleGazeX;
      let targetGazeY = pointerActive ? s.pointerY : idleGazeY;
      let targetAngleZ = Math.sin(s.t * 1.15) * 2.2;
      let targetWaveL = Math.sin(s.t * 2.0) * 0.045;
      let targetSwingR = Math.sin(s.t * 2.0 + 1.2) * 0.025;
      let targetEyeOpen = 1.0;

      if (curMood === "listening") {
        targetAngleZ = 8.5 + Math.sin(s.t * 1.8) * 1.5;
        if (!pointerActive) {
          targetGazeX = 0.22;
          targetGazeY = 0.35;
        }
        targetWaveL = 0.08 + Math.sin(s.t * 2.6) * 0.03;
      } else if (curMood === "thinking") {
        targetGazeX = Math.sin(s.t * 3.1) * 0.68;
        targetGazeY = -0.22 + Math.cos(s.t * 2.3) * 0.12;
        targetAngleZ = Math.sin(s.t * 1.9) * 5.0 - 4.0;
        targetEyeOpen = 0.86;
        targetWaveL = -0.1 + Math.sin(s.t * 3.4) * 0.05;
      } else if (curMood === "speaking") {
        targetGazeX = pointerActive ? s.pointerX * 0.85 : Math.sin(s.t * 1.9) * 0.28;
        targetGazeY = Math.sin(s.t * 4.2) * 0.14;
        targetAngleZ = Math.sin(s.t * 2.7) * 4.2;
        targetWaveL = -0.14 + Math.sin(s.t * 6.5) * 0.14;
        targetSwingR = Math.sin(s.t * 5.2 + 0.8) * 0.07;
      } else if (curMood === "happy") {
        targetAngleZ = Math.sin(s.t * 3.2) * 6.5;
        targetWaveL = -0.22 + Math.sin(s.t * 8.2) * 0.24;
        targetSwingR = -0.06 + Math.sin(s.t * 6.0) * 0.06;
      } else if (curMood === "alert") {
        targetGazeX = pointerActive ? s.pointerX : Math.sin(s.t * 2.4) * 0.3;
        targetGazeY = 0.08;
        targetAngleZ = -3.5 + Math.sin(s.t * 3.5) * 2.0;
        targetEyeOpen = 0.92;
        targetWaveL = 0.1;
      }

      if (s.tapBoost > 0.15) {
        targetWaveL = -0.24 + Math.sin(s.t * 12.0) * 0.28;
        targetAngleZ = Math.sin(s.t * 8.0) * 7.5;
      }

      const smooth = 1 - Math.exp(-9.0 * dt);
      const bodySmooth = 1 - Math.exp(-5.0 * dt);
      s.eyeBallX = lerp(s.eyeBallX, targetGazeX, smooth);
      s.eyeBallY = lerp(s.eyeBallY, targetGazeY, smooth);
      s.angleX = lerp(s.angleX, targetGazeX * 26, smooth);
      s.angleY = lerp(s.angleY, targetGazeY * 22, smooth);
      s.angleZ = lerp(s.angleZ, targetAngleZ, smooth);
      s.bodyAngleX = lerp(s.bodyAngleX, s.angleX * 0.45, bodySmooth);
      s.bodyAngleZ = lerp(s.bodyAngleZ, s.angleZ * 0.35, bodySmooth);
      s.armWaveL = lerp(s.armWaveL, targetWaveL, 1 - Math.exp(-12 * dt));
      s.armSwingR = lerp(s.armSwingR, targetSwingR, 1 - Math.exp(-10 * dt));

      // 2. Natural Blinking State Machine
      s.blinkTimer -= dt;
      if (s.blinkTimer <= 0 && s.blinkPhase === 0) {
        s.blinkPhase = 0.001;
        s.doubleBlinkQueued = !s.doubleBlinkQueued && Math.random() < 0.24;
      }
      let blinkFactor = 1.0;
      if (s.blinkPhase > 0) {
        s.blinkPhase += dt * 6.4;
        if (s.blinkPhase >= 1.0) {
          s.blinkPhase = 0;
          s.blinkTimer = s.doubleBlinkQueued ? 0.14 : 2.6 + Math.random() * 3.2;
        } else {
          blinkFactor = Math.abs(1.0 - s.blinkPhase * 2.0);
        }
      }
      s.eyeOpen = lerp(s.eyeOpen, targetEyeOpen * blinkFactor, 1 - Math.exp(-26 * dt));

      // 3. Real-Time Lip-Sync Modulation (Audio RMS takes priority over text stream fallback)
      const liveAudioLevel = clamp(externalAudioLevelRef.current?.current ?? 0, 0, 1);
      const audioActive = isAudioPlayingRef.current || liveAudioLevel > 0.02;
      const speakingActive = audioActive || curMood === "speaking" || s.speechTimer > 0;
      const targetMouth = audioActive
        ? liveAudioLevel > 0.018
          ? clamp(liveAudioLevel * (0.85 + 0.15 * Math.abs(Math.sin(s.t * 16.0))), 0.08, 1.0)
          : 0
        : speakingActive
          ? clamp(
              0.22 +
                Math.abs(Math.sin(s.t * 14.2)) * 0.5 +
                Math.abs(Math.sin(s.t * 23.7 + 0.7)) * 0.32,
              0.12,
              1.0
            )
          : 0;
      s.mouthOpenY = lerp(s.mouthOpenY, targetMouth, 1 - Math.exp((audioActive ? -30 : -20) * dt));

      // 4. Breathing & Levitation
      const breath = Math.sin(s.t * 2.15);
      const hoverY = Math.sin(s.t * 1.85) * 9.5;

      s.hopVel += (-190 * s.hopY - 15 * s.hopVel) * dt;
      s.hopY += s.hopVel * dt;

      const totalBodyY = hoverY + s.hopY + breath * 2.5;
      const totalBodyX = s.bodyAngleX * 0.45;
      const bodyRot = s.bodyAngleZ * 0.0075;

      // 5. Mizuhiki Bow Secondary Spring Physics (local to Body Bone)
      const bowTargetY = breath * 1.8 + (s.hopVel * 0.015);
      s.bowVel += (120 * (bowTargetY - s.bowY) - 12 * s.bowVel) * dt;
      s.bowY += s.bowVel * dt;
      s.bowRot = lerp(s.bowRot, s.angleZ * 0.003 + (s.bowY - bowTargetY) * 0.006, 1 - Math.exp(-14 * dt));

      // 6. Lantern Drone Spring-Damper Follower & 2.5D Propeller Spin
      const lanTargetX =
        totalBodyX * 0.55 +
        Math.cos(s.t * 1.1) * 10 +
        (curMood === "thinking" ? -28 : curMood === "alert" ? -18 : 0);
      const lanTargetY =
        hoverY * 0.65 +
        Math.sin(s.t * 2.3 + 1.0) * 14 +
        (curMood === "listening" ? 14 : curMood === "thinking" ? -10 : 0);
      s.lanVx += (32 * (lanTargetX - s.lanX) - 6.4 * s.lanVx) * dt;
      s.lanVy += (32 * (lanTargetY - s.lanY) - 6.4 * s.lanVy) * dt;
      s.lanX += s.lanVx * dt;
      s.lanY += s.lanVy * dt;
      const propSpeed =
        curMood === "thinking" ? 26 : curMood === "alert" ? 22 : speakingActive ? 17 : 11.5;
      s.propPhase = (s.propPhase + dt * propSpeed) % (Math.PI * 2);

      // 7. Thruster Rising Particles Update
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.life += dt;
        p.x += p.vx * dt + Math.sin(s.t * 3 + i) * 6 * dt;
        p.y += p.vy * dt;
        if (p.life >= p.maxLife) {
          if (i < 9) {
            const slot = i % 3;
            const thr = THRUSTERS[slot];
            p.x = thr.x + totalBodyX + (Math.random() - 0.5) * 34;
            p.y = thr.y + totalBodyY + 32 + Math.random() * 24;
            p.vx = (Math.random() - 0.5) * 16;
            p.vy = 14 + Math.random() * 14;
            p.life = 0;
            p.maxLife = 1.6 + Math.random() * 1.1;
            p.radius = 2.6 + Math.random() * 2.4;
            p.tint = "cyan";
          } else {
            s.particles.splice(i, 1);
          }
        }
      }

      // =========================================================
      // RENDER PIPELINE
      // =========================================================
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      const scale = Math.min(cw / SCENE_BOUNDS.width, ch / SCENE_BOUNDS.height) * 0.94;
      const offsetX = (cw - SCENE_BOUNDS.width * scale) / 2 - SCENE_BOUNDS.x * scale;
      const offsetY = (ch - SCENE_BOUNDS.height * scale) / 2 - SCENE_BOUNDS.y * scale;

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      const imgs = imagesRef.current;

      // A. Ground Hover Shadow
      const shadowScale = clamp(1.0 - (hoverY + s.hopY) * -0.008, 0.78, 1.12);
      ctx.save();
      ctx.translate(504 + totalBodyX * 0.4, 868);
      ctx.scale(shadowScale, shadowScale * 0.22);
      const shadowGrad = ctx.createRadialGradient(0, 0, 12, 0, 0, 195);
      shadowGrad.addColorStop(0, "rgba(2, 6, 23, 0.55)");
      shadowGrad.addColorStop(0.55, "rgba(15, 23, 42, 0.25)");
      shadowGrad.addColorStop(1, "rgba(15, 23, 42, 0)");
      ctx.fillStyle = shadowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 195, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // B. Floating Thruster Particles
      for (const p of s.particles) {
        const lifeFrac = p.life / p.maxLife;
        const pAlpha = Math.sin(lifeFrac * Math.PI) * p.alpha;
        if (pAlpha <= 0.02) continue;
        ctx.save();
        ctx.globalAlpha = pAlpha;
        ctx.fillStyle = p.tint === "gold" ? "#fde047" : "#7dd3fc";
        ctx.shadowColor = p.tint === "gold" ? "#f59e0b" : "#38bdf8";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // =========================================================
      // C. BODY BONE HIERARCHY
      // =========================================================
      ctx.save();
      ctx.translate(BODY_PIVOT.x + totalBodyX, BODY_PIVOT.y + totalBodyY);
      ctx.rotate(bodyRot);
      ctx.translate(-BODY_PIVOT.x, -BODY_PIVOT.y);

      // Back Waving Left Arm (viewer's right)
      drawPart(ctx, imgs, "armLeft", s.angleX * 0.14, breath * 1.4, s.armWaveL, 1, 1);

      // Feet (gentle hover dangle)
      const footKick = Math.sin(s.t * 3.1) * 0.055;
      drawPart(ctx, imgs, "footL", 0, Math.sin(s.t * 3.1) * 3.5, footKick, 1, 1);
      drawPart(ctx, imgs, "footR", 0, -Math.sin(s.t * 3.1) * 3.5, -footKick, 1, 1);

      // Torso (breathing squash & stretch)
      const breathSy = 1 + breath * 0.013;
      const breathSx = 1 - breath * 0.008;
      drawPart(ctx, imgs, "torso", 0, 0, 0, breathSx, breathSy);

      // Thruster Glow Pulse on Blue Hull
      const thrustPulse = 0.45 + 0.35 * Math.sin(s.t * 4.0) + (curMood === "thinking" ? 0.2 : 0);
      for (const thr of THRUSTERS) {
        ctx.save();
        ctx.translate(thr.x, thr.y);
        ctx.rotate(thr.rot);
        const tGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, thr.rx * 1.45);
        tGrad.addColorStop(0, `rgba(186, 255, 255, ${0.65 * thrustPulse})`);
        tGrad.addColorStop(0.55, `rgba(56, 232, 255, ${0.32 * thrustPulse})`);
        tGrad.addColorStop(1, "rgba(56, 232, 255, 0)");
        ctx.fillStyle = tGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, thr.rx * 1.5, thr.ry * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // =========================================================
      // D. HEAD BONE HIERARCHY (child of Body Bone)
      // =========================================================
      const headLocalDx = s.angleX * 0.36;
      const headLocalDy = s.angleY * 0.32 - breath * 2.2;
      const headLocalRot = s.angleZ * 0.011;
      const headSx = 1 - Math.abs(s.angleX) * 0.0011;
      const headSy = 1 - Math.abs(s.angleY) * 0.0009;

      ctx.save();
      ctx.translate(HEAD_PIVOT.x + headLocalDx, HEAD_PIVOT.y + headLocalDy);
      ctx.rotate(headLocalRot);
      ctx.scale(headSx, headSy);
      ctx.translate(-HEAD_PIVOT.x, -HEAD_PIVOT.y);

      // Visor Plate (deeper parallax behind hood rim)
      const visorDx = s.angleX * 0.32;
      const visorDy = s.angleY * 0.28;
      drawPart(ctx, imgs, "visorPlate", visorDx, visorDy, 0, 1, 1);

      // Face elements (full gaze + parallax shift inside visor)
      const faceDx = s.angleX * 0.66 + s.eyeBallX * 11;
      const faceDy = s.angleY * 0.54 + s.eyeBallY * 8.5;
      const yawNorm = s.angleX / 30;
      const blushScale = curMood === "happy" || s.tapBoost > 0.2 ? 1.12 : 1.0;

      drawPart(ctx, imgs, "blushL", faceDx, faceDy, 0, blushScale, blushScale, curMood === "happy" ? 1 : 0.92);
      drawPart(ctx, imgs, "blushR", faceDx, faceDy, 0, blushScale, blushScale, curMood === "happy" ? 1 : 0.92);

      const eyeLCx = PARTS.eyeL.x + PARTS.eyeL.anchorX + faceDx;
      const eyeLCy = PARTS.eyeL.y + PARTS.eyeL.anchorY + faceDy;
      const eyeRCx = PARTS.eyeR.x + PARTS.eyeR.anchorX + faceDx;
      const eyeRCy = PARTS.eyeR.y + PARTS.eyeR.anchorY + faceDy;
      const perspL = 1 - yawNorm * 0.055;
      const perspR = 1 + yawNorm * 0.055;
      const eyeTint = curMood === "alert" ? "#fde68a" : "#b8ffff";
      const eyeGlow = curMood === "alert" ? "#f59e0b" : "#38e8ff";

      if (curMood === "happy" || s.tapBoost > 0.25) {
        drawHappyArcEye(ctx, eyeLCx, eyeLCy + 4, 30 * perspL, 26, eyeTint, eyeGlow);
        drawHappyArcEye(ctx, eyeRCx, eyeRCy + 4, 28 * perspR, 26, eyeTint, eyeGlow);
      } else if (s.eyeOpen < 0.22) {
        drawBlinkArcEye(ctx, eyeLCx, eyeLCy + 8, 28 * perspL, eyeTint, eyeGlow);
        drawBlinkArcEye(ctx, eyeRCx, eyeRCy + 8, 26 * perspR, eyeTint, eyeGlow);
      } else {
        drawPart(ctx, imgs, "eyeL", faceDx, faceDy + (1 - s.eyeOpen) * 14, 0, perspL, s.eyeOpen);
        drawPart(ctx, imgs, "eyeR", faceDx, faceDy + (1 - s.eyeOpen) * 14, 0, perspR, s.eyeOpen);

        if (curMood === "thinking") {
          const scanX = Math.sin(s.t * 4.5) * 26;
          ctx.save();
          ctx.globalAlpha = 0.28 + 0.16 * Math.sin(s.t * 8);
          ctx.strokeStyle = "#67e8f9";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(eyeLCx - 24 + scanX * 0.4, eyeLCy - 34);
          ctx.lineTo(eyeLCx + 24 + scanX * 0.4, eyeLCy - 34);
          ctx.moveTo(eyeRCx - 22 + scanX * 0.4, eyeRCy - 34);
          ctx.lineTo(eyeRCx + 22 + scanX * 0.4, eyeRCy - 34);
          ctx.stroke();
          ctx.restore();
        }

        if (curMood === "alert") {
          ctx.save();
          ctx.lineCap = "round";
          ctx.lineWidth = 7.5;
          ctx.strokeStyle = "#fbbf24";
          ctx.shadowColor = "#f59e0b";
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(eyeLCx - 28, eyeLCy - 44);
          ctx.lineTo(eyeLCx + 26, eyeLCy - 30);
          ctx.moveTo(eyeRCx + 26, eyeRCy - 44);
          ctx.lineTo(eyeRCx - 24, eyeRCy - 30);
          ctx.stroke();
          ctx.restore();
        }
      }

      const mouthCx = PARTS.mouth.x + PARTS.mouth.anchorX + faceDx;
      const mouthCy = PARTS.mouth.y + PARTS.mouth.anchorY + faceDy;
      if (s.mouthOpenY >= 0.08) {
        drawTalkingMouth(ctx, mouthCx, mouthCy, s.mouthOpenY, s.t);
      } else if (curMood === "alert") {
        drawConcernedMouth(ctx, mouthCx, mouthCy);
      } else {
        drawPart(ctx, imgs, "mouth", faceDx, faceDy, 0, 1, 1);
      }

      // Outer Head Hood (cleanly masks visor edges)
      drawPart(ctx, imgs, "headHood", 0, 0, 0, 1, 1);
      ctx.restore(); // end Head Bone

      // Mizuhiki Neck Cord & Bow (masks head/torso neck joint)
      drawPart(ctx, imgs, "mizuhikiBow", s.angleX * 0.14, s.bowY, s.bowRot, 1, 1);

      // Front Right Arm
      drawPart(ctx, imgs, "armRight", s.angleX * 0.06, breath * 1.4, s.armSwingR, 1, 1);

      // Holographic Kyoto Map
      const mapFloatY = Math.sin(s.t * 2.0 + 1.5) * 8.5 - breath * 1.5;
      const mapFloatX = s.angleX * 0.2;
      const mapRot = Math.sin(s.t * 1.35) * 0.038;
      const mapScale = curMood === "thinking" ? 1.03 + Math.sin(s.t * 6) * 0.015 : 1.0;

      ctx.save();
      ctx.shadowColor = curMood === "alert" ? "rgba(251, 191, 36, 0.35)" : "rgba(45, 212, 191, 0.45)";
      ctx.shadowBlur = curMood === "thinking" ? 22 : 14;
      drawPart(ctx, imgs, "holoMap", mapFloatX, mapFloatY, mapRot, mapScale, mapScale);
      ctx.restore();

      ctx.restore(); // end Body Bone

      // =========================================================
      // E. FLYING PAPER LANTERN DRONE (independent spring-damper follower)
      // =========================================================
      const lanRot = clamp(s.lanVx * 0.0028, -0.22, 0.22) + Math.sin(s.t * 1.6) * 0.035;
      const lanCenterX = PARTS.lanternBody.x + PARTS.lanternBody.anchorX + s.lanX;
      const lanCenterY = PARTS.lanternBody.y + PARTS.lanternBody.anchorY + s.lanY;

      ctx.save();
      const lanGlowPulse = 0.52 + 0.18 * Math.sin(s.t * 3.8);
      const lanGrad = ctx.createRadialGradient(lanCenterX, lanCenterY, 10, lanCenterX, lanCenterY, 115);
      if (curMood === "alert") {
        lanGrad.addColorStop(0, `rgba(251, 146, 60, ${0.42 * lanGlowPulse})`);
        lanGrad.addColorStop(1, "rgba(251, 146, 60, 0)");
      } else if (curMood === "thinking") {
        lanGrad.addColorStop(0, `rgba(103, 232, 249, ${0.38 * lanGlowPulse})`);
        lanGrad.addColorStop(1, "rgba(103, 232, 249, 0)");
      } else {
        lanGrad.addColorStop(0, `rgba(253, 186, 116, ${0.28 * lanGlowPulse})`);
        lanGrad.addColorStop(1, "rgba(253, 186, 116, 0)");
      }
      ctx.fillStyle = lanGrad;
      ctx.beginPath();
      ctx.arc(lanCenterX, lanCenterY, 115, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawPart(ctx, imgs, "lanternBody", s.lanX, s.lanY, lanRot, 1, 1);

      // 2.5D Spinning Propeller attached to top of lantern
      const propSpec = PARTS.lanternPropeller;
      const hubLocalX = propSpec.x + propSpec.anchorX - (PARTS.lanternBody.x + PARTS.lanternBody.anchorX);
      const hubLocalY = propSpec.y + propSpec.anchorY - (PARTS.lanternBody.y + PARTS.lanternBody.anchorY);
      const cosSpin = Math.cos(s.propPhase);
      const bladeScaleX = (cosSpin >= 0 ? 1 : -1) * Math.max(0.16, Math.abs(cosSpin));

      ctx.save();
      ctx.translate(lanCenterX, lanCenterY);
      ctx.rotate(lanRot);
      ctx.translate(hubLocalX, hubLocalY);

      ctx.save();
      ctx.fillStyle = "rgba(125, 225, 235, 0.16)";
      ctx.beginPath();
      ctx.ellipse(0, 5, 92, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const propImg = imgs.lanternPropeller;
      if (propImg && propImg.complete && propImg.naturalWidth > 0) {
        ctx.save();
        ctx.scale(bladeScaleX, 1);
        ctx.drawImage(propImg, -propSpec.anchorX, -propSpec.anchorY, propSpec.width, propSpec.height);
        ctx.restore();
      }

      // Spherical gold nose dome stays un-squished while blades spin
      ctx.save();
      const domeGrad = ctx.createRadialGradient(-3, -3, 1.5, 0, 0, 12);
      domeGrad.addColorStop(0, "#fef3c7");
      domeGrad.addColorStop(0.55, "#eab308");
      domeGrad.addColorStop(1, "#a16207");
      ctx.fillStyle = domeGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 10.5, Math.PI, 0);
      ctx.lineTo(10.5, 4);
      ctx.quadraticCurveTo(0, 8, -10.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.restore();

      ctx.restore(); // end scene transform
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const handleClick = () => {
    if (!interactive) return;
    triggerJoyImpulse();
    onTap?.();
  };

  return (
    <canvas
      ref={canvasRef}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`block select-none ${interactive ? "cursor-pointer focus:outline-none" : ""} ${className}`}
    />
  );
}
