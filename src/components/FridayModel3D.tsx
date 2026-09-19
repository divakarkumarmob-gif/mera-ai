import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { motion } from 'motion/react';
import FridayAvatar from './FridayAvatar';
import type { AgentFaceReaction } from './AgentFace';

export type AvatarAction =
  | 'dance'
  | 'dance_hiphop2'
  | 'dance_salsa'
  | 'dance_swing'
  | 'dance_silly'
  | 'dance_silly2'
  | 'dance_robot'
  | 'dance_samba'
  | 'dance_breakfreeze'
  | 'rap'
  | 'jump'
  | 'big_jump'
  | 'jumping_jacks'
  | 'pushup'
  | 'situps'
  | 'bicycle_crunch'
  | 'arm_stretch'
  | 'warming_up'
  | 'flip'
  | 'flip_uppercut'
  | 'flip_front'
  | 'flip_twist'
  | 'flip_kick'
  | 'flip_kick2'
  | 'run_flip'
  | 'walk'
  | 'namaste'
  | 'salute'
  | 'blow_kiss'
  | 'victory'
  | 'excited'
  | 'flair'
  | 'angry'
  | 'sad'
  | 'sad2'
  | 'dying'
  | 'fighting_idle'
  | 'fight_to_idle'
  | 'fist_fight'
  | 'kicking'
  | 'punching'
  | 'idle_situp'
  | 'think'
  | 'wave'
  | 'bow'
  | 'nod-yes'
  | 'nod-no'
  | 'phone'
  | 'stop'
  | null;

export const AVATAR_ACTION_LIST: string[] = [
  'dance', 'dance_hiphop2', 'dance_salsa', 'dance_swing', 'dance_silly', 'dance_silly2',
  'dance_robot', 'dance_samba', 'dance_breakfreeze',
  'rap',
  'jump', 'big_jump', 'jumping_jacks',
  'pushup', 'situps', 'bicycle_crunch', 'arm_stretch', 'warming_up',
  'flip', 'flip_uppercut', 'flip_front', 'flip_twist', 'flip_kick', 'flip_kick2', 'run_flip',
  'walk',
  'namaste', 'salute', 'blow_kiss', 'victory', 'excited', 'flair',
  'angry', 'sad', 'sad2', 'dying',
  'fighting_idle', 'fight_to_idle', 'fist_fight', 'kicking', 'punching', 'idle_situp',
  'think', 'wave', 'bow', 'nod-yes', 'nod-no', 'phone',
  'stop',
];

// ── Multi-variant random pool ──
// Jab bhi ek action ke multiple animations hain, play time pe random ek select hoga
export const ACTION_VARIANTS: Record<string, string[]> = {
  flip:        ['flip', 'flip_uppercut'],
  backflip:    ['flip', 'flip_uppercut'],
  flip_kick:   ['flip_kick', 'flip_kick2'],
  dance:       ['dance', 'dance_hiphop2'],
  dance_silly: ['dance_silly', 'dance_silly2'],
  sad:         ['sad', 'sad2'],
  warmup:      ['arm_stretch', 'jumping_jacks', 'situps', 'bicycle_crunch', 'pushup', 'warming_up'],
  workout:     ['arm_stretch', 'jumping_jacks', 'situps', 'bicycle_crunch', 'pushup', 'situps', 'warming_up'],
  fight:       ['fist_fight', 'kicking', 'punching'],
  jump:        ['jump', 'big_jump'],
};

// Helper — pick a random variant from the pool, or return the name unchanged
export const resolveVariant = (name: string): string => {
  const pool = ACTION_VARIANTS[name];
  if (pool && pool.length > 1) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return name;
};

export const ACTION_ALIASES: Record<string, string> = {
  // ── Flips ──
  backflip: 'flip', 'back flip': 'flip', back_flip: 'flip', 'back-flip': 'flip',
  frontflip: 'flip_front', 'front flip': 'flip_front', front_flip: 'flip_front', 'front-flip': 'flip_front',
  flipkick: 'flip_kick', 'flip kick': 'flip_kick',
  twistflip: 'flip_twist', 'twist flip': 'flip_twist',
  uppercut: 'flip_uppercut',
  palti: 'flip', 'front palti': 'flip_front', 'back palti': 'flip',
  // ── Dance ──
  dancing: 'dance', nacho: 'dance', naach: 'dance', thumka: 'dance',
  salsa: 'dance_salsa', swing: 'dance_swing', silly: 'dance_silly',
  robot: 'dance_robot', samba: 'dance_samba', breakdance: 'dance_breakfreeze',
  'robot dance': 'dance_robot', 'samba dance': 'dance_samba',
  bhangra: 'dance', garba: 'dance_salsa',
  // ── Warm-up / Exercise ──
  warmup: 'warmup', garam_karo: 'warmup', 'warm-up': 'warmup',
  exercise: 'workout', workout: 'workout', vyayam: 'warmup',
  pushups: 'pushup', 'push up': 'pushup', push_up: 'pushup', 'push-up': 'pushup',
  situp: 'situps', 'sit up': 'situps', 'sit-up': 'situps',
  'jumping jack': 'jumping_jacks', 'jumping jacks': 'jumping_jacks',
  stretch: 'arm_stretch', stretching: 'arm_stretch', 'arm stretch': 'arm_stretch',
  'warm up': 'warmup', 'warming up': 'warming_up',
  // ── Jumps ──
  jumping: 'jump', kudo: 'jump', koodo: 'jump', 'big jump': 'big_jump', bigjump: 'big_jump',
  // ── Expressions / Gestures ──
  praying: 'namaste', pray: 'namaste', pranam: 'namaste', namaskar: 'namaste',
  jhuko: 'bow', sir_jhukao: 'bow',
  tata: 'wave', bye: 'wave', hello: 'wave',
  gussa: 'angry',
  khush: 'excited',
  jeet: 'victory', win: 'victory', winner: 'victory',
  'blow kiss': 'blow_kiss', kiss: 'blow_kiss', muhchuma: 'blow_kiss',
  udas: 'sad', dukhi: 'sad',
  mar_gaya: 'dying', gir_gaya: 'dying',
  // ── Fight / Combat ──
  fight: 'fist_fight', lad_jao: 'fist_fight', 'fist fight': 'fist_fight', boxing: 'fist_fight',
  kick: 'kicking', maaro: 'kicking', maar: 'kicking',
  punch: 'punching', ghusa: 'punching',
  'fighting idle': 'fighting_idle', fighter: 'fighting_idle',
  // ── Misc ──
  rapping: 'rap', walking: 'walk', chalo: 'walk',
};


export const normalizeAvatarAction = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const clean = raw
    .toLowerCase()
    .trim()
    .replace(/^(pehle|phir|then|aur)\s+/i, '')
    .replace(/\s+(karo|lagao|maro|dikhao|do|hoga|karegi|kijiye)$/i, '')
    .trim();
  if (clean === 'stop' || clean === 'ruk jao' || clean === 'bas' || clean === 'bas karo' || clean === '') return 'stop';
  return ACTION_ALIASES[clean] || ACTION_ALIASES[raw.toLowerCase().trim()] || clean;
};

export const parseActionSequence = (input: string | string[] | null | undefined): string[] => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(s => normalizeAvatarAction(s)).filter((s): s is string => !!s && s !== 'stop');
  }
  const parts = input
    .split(/[,|\n]|->|\b(?:then|phir|aur|and|after that)\b/i)
    .map(s => normalizeAvatarAction(s.trim()))
    .filter((s): s is string => !!s && s !== 'stop');
  return parts;
};

interface FridayModel3DProps {
  status: string;
  volume: number;
  reaction?: AgentFaceReaction;
  height?: number;
  onTap?: () => void;
  action?: AvatarAction;
  onActionDone?: () => void;
  fluid?: boolean;
}

const MODEL_URLS = ['/friday.fbx'];
const LOCKED_ZOOM = 0.91;
const LOCKED_POS = { x: -0.03, y: 0 };

const FridayModel3D: React.FC<FridayModel3DProps> = ({
  status,
  volume,
  reaction,
  height = 340,
  onTap,
  action,
  onActionDone,
  fluid,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ status, volume, reaction, action });
  stateRef.current = { status, volume, reaction, action };
  const doneRef = useRef(onActionDone);
  doneRef.current = onActionDone;
  const mouseRef = useRef({ x: 0, y: 0 });
  const [modelMissing, setModelMissing] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [localAction, setLocalAction] = useState<AvatarAction>(null);
  const localRef = useRef<AvatarAction>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const raw = (e as CustomEvent).detail as any;
      if (!raw) {
        localRef.current = null;
        setLocalAction(null);
        return;
      }
      if (typeof raw === 'object' && Array.isArray(raw.sequence) && raw.sequence.length > 0) {
        window.dispatchEvent(new CustomEvent('friday-action-sequence', { detail: { sequence: raw.sequence } }));
        return;
      }
      const rawStr = typeof raw === 'string' ? raw : String(raw.action || '');
      const parsed = parseActionSequence(rawStr);
      if (parsed.length > 1) {
        window.dispatchEvent(new CustomEvent('friday-action-sequence', { detail: { sequence: parsed } }));
        return;
      }
      const normalized = normalizeAvatarAction(rawStr);
      if (!normalized || normalized === 'stop') {
        localRef.current = null;
        setLocalAction(null);
        return;
      }
      localRef.current = normalized as AvatarAction;
      setLocalAction(normalized as AvatarAction);
    };
    window.addEventListener('friday-action', h);
    return () => window.removeEventListener('friday-action', h);
  }, []);

  const isSpeaking = status === 'Speaking...';

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let raf = 0;
    let mixer: THREE.AnimationMixer | null = null;
    const actions: Record<string, THREE.AnimationAction> = {};

    // Random variant resolver — picks a random pool member if one exists
    const resolveActionName = (name: string): string => {
      const pool = ACTION_VARIANTS[name];
      if (pool && pool.length > 1) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
      return name;
    };
    let currentActionName = '';
    let jawBone: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;

    let spine: THREE.Object3D | null = null;
    let eyeL: THREE.Object3D | null = null;
    let eyeR: THREE.Object3D | null = null;
    let sacT = 2;
    let sacX = 0,
      sacY = 0,
      sacTX = 0,
      sacTY = 0;
    let glanceT = 4;
    let glanceX = 0,
      glanceY = 0,
      glanceTX = 0,
      glanceTY = 0;

    let mouthMorph: { mesh: THREE.Mesh; index: number } | null = null;
    const mouthOpenMorphs: { mesh: THREE.Mesh; index: number }[] = [];
    const blinkMorphs: { mesh: THREE.Mesh; index: number }[] = [];
    const visemes: Record<string, { mesh: THREE.Mesh; index: number }> = {};
    let visemePhase = 0;
    let lastVolPeak = 0;

    const W = mount.clientWidth || 300;
    const H = mount.clientHeight || height;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 100);
    let baseCamZ = 3.4;
    let baseCamY = 1.35;
    let baseLookY = 1.0;
    camera.position.set(0, baseCamY, baseCamZ);
    camera.lookAt(0, baseLookY, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.0);
    key.position.set(2, 4, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9db8ff, 0.7);
    fill.position.set(-3, 1.5, 2.5);
    scene.add(fill);
    const rim = new THREE.PointLight(0x3b82f6, 20, 20);
    rim.position.set(0, 2.5, -3);
    scene.add(rim);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 48),
      new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.4 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    modelRoot.add(disc);

    const clock = new THREE.Clock();
    let blinkTimer = 2;
    let blinkT = -1;

    // ── Choreography Engine ──
    // Non-repeating variety: Dance clips are capped to ~4s (1 phrase) so no clip repeats the same step 3-4 times.
    // Stunts (flips, uppercuts, pushups, salute) are one-shot (LoopOnce) and play fully once.
    interface ChoreoStep {
      clip: string;
      maxDuration?: number; // Cap for dance clips so they play 1 clean phrase without repeating 3-4 times
    }
    const CHOREO_SEQUENCE: ChoreoStep[] = [
      { clip: 'dance',              maxDuration: 4.2 }, // Hip Hop: 1 phrase
      { clip: 'flip' },                                 // BACKFLIP 💥
      { clip: 'dance_salsa',        maxDuration: 4.0 }, // Salsa: 1 phrase
      { clip: 'flip_uppercut' },                        // UPPERCUT FLIP 💥
      { clip: 'dance_robot',        maxDuration: 4.0 }, // Robot Hip Hop
      { clip: 'flip_front' },                           // FRONT FLIP 💥
      { clip: 'dance_swing',        maxDuration: 4.0 }, // Swing: 1 phrase
      { clip: 'big_jump' },                             // BIG JUMP ⬆️
      { clip: 'dance_samba',        maxDuration: 4.0 }, // Samba: 1 phrase
      { clip: 'flip_kick' },                            // FLIP KICK 🦵
      { clip: 'dance_silly',        maxDuration: 3.8 }, // Silly Alt
      { clip: 'dance_hiphop2',      maxDuration: 4.0 }, // Hip Hop Alt
      { clip: 'dance_breakfreeze',  maxDuration: 4.0 }, // Breakdance Freeze
      { clip: 'flip' },                                 // BACKFLIP again 💥
      { clip: 'victory' },                              // VICTORY 🏆
      { clip: 'salute' },                               // SALUTE 🫡 — finale
    ];

    let choreoActive = false;
    let choreoIndex = 0;
    let choreoTimer: ReturnType<typeof setTimeout> | null = null;

    const clearChoreoTimer = () => {
      if (choreoTimer) { clearTimeout(choreoTimer); choreoTimer = null; }
    };

    // Play a specific step in the choreography
    const playChoreoStep = (idx: number) => {
      if (!choreoActive || !mixer) return;
      clearChoreoTimer();

      if (idx >= CHOREO_SEQUENCE.length) {
        // Show finished → return to idle
        choreoActive = false;
        const cur = actions[currentActionName];
        const idle = actions['idle'];
        if (idle && cur) { cur.crossFadeTo(idle, 0.5, true); idle.play(); currentActionName = 'idle'; }
        if (mixer) mixer.timeScale = 1.0;
        try { doneRef.current?.(); } catch { /* noop */ }
        console.log('[Choreo] 🏁 Routine complete → returned to idle');
        return;
      }

      choreoIndex = idx;
      const step = CHOREO_SEQUENCE[idx];
      const curAction = actions[currentActionName];
      const nextAction = actions[step.clip];

      if (!nextAction) {
        console.warn(`[Choreo] Clip "${step.clip}" not ready, advancing to next step`);
        playChoreoStep(idx + 1);
        return;
      }

      nextAction.reset();
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);

      if (step.maxDuration) {
        // Dance move: loop for 1 musical phrase, then advance smoothly via timer
        nextAction.setLoop(THREE.LoopRepeat, Infinity);
        if (curAction && curAction !== nextAction) curAction.crossFadeTo(nextAction, 0.35, true);
        nextAction.play();
        currentActionName = step.clip;
        console.log(`[Choreo] Step ${idx + 1}/${CHOREO_SEQUENCE.length}: ${step.clip} (capped at ${step.maxDuration}s)`);
        choreoTimer = setTimeout(() => {
          if (choreoActive && choreoIndex === idx) {
            playChoreoStep(idx + 1);
          }
        }, step.maxDuration * 1000);
      } else {
        // Stunt / flip / pushup / salute: one-shot, advance when finished
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;
        if (curAction && curAction !== nextAction) curAction.crossFadeTo(nextAction, 0.3, true);
        nextAction.play();
        currentActionName = step.clip;
        console.log(`[Choreo] Step ${idx + 1}/${CHOREO_SEQUENCE.length}: ${step.clip} (one-shot stunt)`);
      }
    };

    // mixer 'finished' handler for choreo steps
    const onChoreoFinished = (e: any) => {
      if (!choreoActive) return;
      const finishedName = e.action?.getClip()?.name as string;
      const step = CHOREO_SEQUENCE[choreoIndex];
      if (!step || step.maxDuration) return; // Timed steps advance via choreoTimer
      if (finishedName !== step.clip) return;
      clearChoreoTimer();
      playChoreoStep(choreoIndex + 1);
    };

    const startChoreo = () => {
      if (choreoActive) return;
      choreoActive = true;
      choreoIndex = 0;
      clearChoreoTimer();
      mixer?.addEventListener('finished', onChoreoFinished);
      console.log('[Choreo] 🎬 Mega Dance Routine starting!');
      playChoreoStep(0);
    };

    const stopChoreo = () => {
      if (!choreoActive) return;
      choreoActive = false;
      clearChoreoTimer();
      if (mixer) mixer.timeScale = 1.0;
    };

    // ── Custom User Sequence Engine ──
    // Allows Boss to specify ANY arbitrary sequence of actions in ANY order!
    // (e.g. "pehle namaste karo, phir dance karo, phir front flip maro, phir salute karo")
    let userSequence: string[] = [];
    let userSeqIndex = 0;
    let userSeqActive = false;
    let userSeqTimer: ReturnType<typeof setTimeout> | null = null;

    const clearUserSeqTimer = () => {
      if (userSeqTimer) {
        clearTimeout(userSeqTimer);
        userSeqTimer = null;
      }
    };

    const stopUserSequence = () => {
      if (!userSeqActive) return;
      userSeqActive = false;
      userSequence = [];
      userSeqIndex = 0;
      clearUserSeqTimer();
      if (mixer) mixer.timeScale = 1.0;
    };

    const playUserSeqStep = (idx: number) => {
      if (!userSeqActive || !mixer) return;
      clearUserSeqTimer();

      if (idx >= userSequence.length) {
        // Complete sequence finished → return to idle
        userSeqActive = false;
        userSequence = [];
        localRef.current = null;
        setLocalAction(null);
        if (mixer) mixer.timeScale = 1.0;
        const cur = actions[currentActionName];
        const isSpk = stateRef.current.status === 'Speaking...';
        const targetNext = isSpk ? (actions['talking'] ? 'talking' : 'talking_alt') : actions['idle'] ? 'idle' : '';
        if (targetNext && actions[targetNext] && cur && cur !== actions[targetNext]) {
          cur.crossFadeTo(actions[targetNext], 0.45, true);
          actions[targetNext].play();
          currentActionName = targetNext;
        }
        try {
          doneRef.current?.();
        } catch {
          /* noop */
        }
        console.log('[UserSeq] 🏁 Custom action sequence complete → returned to idle');
        return;
      }

      userSeqIndex = idx;
      // Resolve random variant at play time
      const stepClipName = resolveActionName(userSequence[idx]);
      userSequence[idx] = stepClipName; // Update so finished event matches
      const curAction = actions[currentActionName];
      const nextAction = actions[stepClipName];

      if (!nextAction) {
        // If clip is currently loading, wait up to 1.5s
        let waited = 0;
        const checkInt = setInterval(() => {
          waited += 100;
          if (actions[stepClipName] || waited >= 1500) {
            clearInterval(checkInt);
            if (actions[stepClipName]) {
              playUserSeqStep(idx);
            } else {
              console.warn(`[UserSeq] Clip "${stepClipName}" not available, skipping to next`);
              playUserSeqStep(idx + 1);
            }
          }
        }, 100);
        return;
      }

      nextAction.reset();
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);

      const LOOPABLE_ACTIONS = new Set([
        'dance', 'dance_hiphop2', 'dance_salsa', 'dance_swing', 'dance_silly', 'dance_silly2',
        'dance_robot', 'dance_samba', 'dance_breakfreeze',
        'rap', 'walk', 'fighting_idle',
      ]);
      const isLoopable = LOOPABLE_ACTIONS.has(stepClipName);

      if (isLoopable) {
        nextAction.setLoop(THREE.LoopRepeat, Infinity);
        if (curAction && curAction !== nextAction) curAction.crossFadeTo(nextAction, 0.35, true);
        nextAction.play();
        currentActionName = stepClipName;

        // If there are more actions waiting after this in the sequence, play dance/loop for 4.0s then advance
        if (idx + 1 < userSequence.length) {
          console.log(
            `[UserSeq] Step ${idx + 1}/${userSequence.length}: "${stepClipName}" (playing for 4s, then advancing)`
          );
          userSeqTimer = setTimeout(() => {
            if (userSeqActive && userSeqIndex === idx) {
              playUserSeqStep(idx + 1);
            }
          }, 4000);
        } else {
          console.log(`[UserSeq] Final step in sequence: "${stepClipName}" (will stay playing)`);
          userSeqActive = false; // Finished sequencing, let it loop
        }
      } else {
        // One-shot stunt or gesture (flip, front flip, jump, pushup, salute, namaste, bow, wave, etc.)
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;
        if (curAction && curAction !== nextAction) curAction.crossFadeTo(nextAction, 0.3, true);
        nextAction.play();
        currentActionName = stepClipName;
        console.log(
          `[UserSeq] Step ${idx + 1}/${userSequence.length}: "${stepClipName}" (one-shot, advances on finished)`
        );
      }
    };

    const onUserSeqFinished = (e: any) => {
      if (!userSeqActive) return;
      const finishedName = e.action?.getClip()?.name as string;
      const currentStepClip = userSequence[userSeqIndex];
      const LOOPABLE_ACTIONS = new Set([
        'dance', 'dance_hiphop2', 'dance_salsa', 'dance_swing', 'dance_silly', 'dance_silly2',
        'dance_robot', 'dance_samba', 'dance_breakfreeze',
        'rap', 'walk', 'fighting_idle',
      ]);
      const isLoopable = LOOPABLE_ACTIONS.has(currentStepClip);
      if (isLoopable) return; // loop steps advance via timer
      if (finishedName !== currentStepClip) return;
      clearUserSeqTimer();
      playUserSeqStep(userSeqIndex + 1);
    };

    const startUserSequence = (seq: string[]) => {
      if (!seq || seq.length === 0) return;
      if (choreoActive) stopChoreo();
      stopUserSequence();

      const validList = seq
        .map((s) => normalizeAvatarAction(s))
        .filter((s): s is string => !!s && s !== 'stop');

      if (validList.length === 0) return;

      console.log('[UserSeq] 🎬 Starting user ordered sequence:', validList);
      userSequence = validList;
      userSeqIndex = 0;
      userSeqActive = true;
      clearUserSeqTimer();
      mixer?.addEventListener('finished', onUserSeqFinished);
      playUserSeqStep(0);
    };

    const fadeToAction = (targetNameRaw: string, dur = 0.35) => {
      const targetName = resolveActionName(targetNameRaw);
      if (!mixer || currentActionName === targetName) return;
      const current = actions[currentActionName];
      const next = actions[targetName];
      if (!next) return;

      next.reset();
      next.setEffectiveTimeScale(1);
      next.setEffectiveWeight(1);
      if (current) {
        current.crossFadeTo(next, dur, true);
      }
      next.play();
      currentActionName = targetName;
    };

    const sanitizeClip = (clip: THREE.AnimationClip, targetModel: THREE.Object3D, clipName?: string) => {
      const normalizeKey = (str: string) =>
        str
          .replace(/^(mixamorig\d*|armature|root|_)+/i, '')
          .replace(/[:._\-\s]/g, '')
          .toLowerCase();

      const boneMap = new Map<string, string>();
      targetModel.traverse((o) => {
        if ((o as THREE.Bone).isBone) {
          const k = normalizeKey(o.name);
          boneMap.set(k, o.name);
          boneMap.set(o.name.toLowerCase(), o.name);
        }
      });

      const isStuntOrFlip = !!(clipName && /flip|jump|kick/i.test(clipName));
      const isLocomotion = !!(clipName && /walk|run/i.test(clipName));

      clip.tracks.forEach((track) => {
        const parts = track.name.split('.');
        const nodeName = parts[0];
        const prop = parts[1] || '';
        const k = normalizeKey(nodeName);
        const matched = boneMap.get(k) ?? boneMap.get(nodeName.toLowerCase());
        if (matched) {
          parts[0] = matched;
          track.name = parts.join('.');
        }

        // ── IN-PLACE ROOT MOTION LOCK & STUNT CLAMPING ──
        // Mixamo mocap animations (especially Front Flip, Backflip, Run To Flip, Walk)
        // contain root translation tracks on the Hips bone that fling the avatar 2-3m forward
        // directly out of the screen / into the camera lens!
        // We lock X and Z so the avatar flips & moves 100% in-place on the glowing pedestal!
        const isRootBone = k === 'hips' || k === 'root' || /hips|root|pelvis|armature/i.test(nodeName);
        const isPosTrack = prop === 'position' || track.name.endsWith('.position');

        if (isRootBone && isPosTrack && track.values && track.values.length >= 3) {
          const startX = track.values[0];
          const startY = track.values[1];
          const startZ = track.values[2];
          const len = track.values.length;

          for (let i = 0; i < len; i += 3) {
            // 1. Zero out horizontal displacement: stays centered on pedestal, never flies out of screen
            track.values[i] = startX;
            track.values[i + 2] = startZ;

            // 2. Vertical jump (Y) scaling
            const deltaY = track.values[i + 1] - startY;
            if (isStuntOrFlip) {
              if (deltaY > 0) {
                // Damp jump apex by ~58% so head doesn't clip above top of screen during flip
                track.values[i + 1] = startY + deltaY * 0.42;
              } else {
                // Natural crouch / landing
                track.values[i + 1] = startY + deltaY * 0.8;
              }
            } else if (isLocomotion) {
              // Smooth in-place treadmill walk on pedestal
              track.values[i + 1] = startY + deltaY * 0.5;
            }
          }
        }
      });
      return clip;
    };

    const handleLoaded = (model: THREE.Object3D, _animations: THREE.AnimationClip[]) => {
      if (disposed) return;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;
      const targetH = 2.1;
      const s = targetH / Math.max(size.y, 0.001);
      model.scale.setScalar(s);
      modelRoot.add(model);

      // ✅ Model successfully added to scene — hide loading placeholder
      setIsModelLoaded(true);

      model.traverse((o) => {
        const n = o.name.toLowerCase();
        if (!spine && n === 'spine2') spine = o;
        else if (!eyeL && n === 'lefteye') eyeL = o;
        else if (!eyeR && n === 'righteye') eyeR = o;
        else if (!jawBone && /jaw|chin|mouth/i.test(n)) jawBone = o;
        else if (!headBone && /head/i.test(n)) headBone = o;

        const mesh = o as THREE.Mesh;
        const dict = (mesh as THREE.Mesh & { morphTargetDictionary?: Record<string, number> })
          .morphTargetDictionary;
        if (dict && mesh.morphTargetInfluences) {
          Object.entries(dict).forEach(([name, idx]) => {
            const nm = name.toLowerCase();
            if (/jawopen|mouthopen|mouth_open|viseme_aa|viseme_o|open|aa|ah/i.test(nm)) {
              if (!mouthMorph) mouthMorph = { mesh, index: idx };
              mouthOpenMorphs.push({ mesh, index: idx });
            }
            if (/blink|eyelid|eye.*close/i.test(nm)) blinkMorphs.push({ mesh, index: idx });
            if (/mouthsmile|smile/i.test(nm) && !visemes.smile) visemes.smile = { mesh, index: idx };
            if (/mouthfunnel|funnel|oo|oh/i.test(nm) && !visemes.funnel)
              visemes.funnel = { mesh, index: idx };
            if (/mouthpucker|pucker/i.test(nm) && !visemes.pucker)
              visemes.pucker = { mesh, index: idx };
            if (/mouthstretch|stretch/i.test(nm) && !visemes.stretch)
              visemes.stretch = { mesh, index: idx };
            if (/mouthclose|mouthpress|press/i.test(nm) && !visemes.press)
              visemes.press = { mesh, index: idx };
            if (/mouthlower|lowerlip/i.test(nm) && !visemes.lowerLip)
              visemes.lowerLip = { mesh, index: idx };
            if (/mouthshrugup|shrug/i.test(nm) && !visemes.shrug)
              visemes.shrug = { mesh, index: idx };
            if (/jawforward|jawleft|jawright/i.test(nm) && !visemes.jawShift)
              visemes.jawShift = { mesh, index: idx };
            if (/cheekpuff|puff/i.test(nm) && !visemes.cheekPuff)
              visemes.cheekPuff = { mesh, index: idx };
          });
        }
      });

      if (!headBone) headBone = model;

      modelRoot.updateMatrixWorld(true);
      const frame = new THREE.Box3().setFromObject(modelRoot);
      const fullH = Math.max(frame.max.y - frame.min.y, 0.001);
      const centerY = frame.min.y + fullH * 0.5;
      const visH = fullH;
      const visW = Math.min(frame.max.x - frame.min.x, 1.2);
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const fitH = visH / 2 / Math.tan(halfFov);
      const fitW = visW / 2 / (Math.tan(halfFov) * Math.max(camera.aspect, 0.3));
      const fitDist = Math.max(fitH, fitW) * 1.12;
      const camOffsetY = fullH * 0.09;
      baseCamZ = fitDist / LOCKED_ZOOM;
      baseCamY = centerY + camOffsetY + 0.05;
      baseLookY = centerY + camOffsetY;
      camera.position.set(0, baseCamY, baseCamZ);
      camera.lookAt(0, baseLookY, 0);

      // ── MIXAMO MOCAP ENGINE ──
      mixer = new THREE.AnimationMixer(model);

      mixer.addEventListener('finished', (e: any) => {
        const finishedClipName = e.action?.getClip()?.name as string;
        // Choreo and UserSeq engines handle their own clips — don't double-handle them here
        if (choreoActive || userSeqActive) return;
        console.log(`[FridayModel3D] Mocap finished: ${finishedClipName}`);
        if (localRef.current === finishedClipName) {
          localRef.current = null;
          setLocalAction(null);
        }
        try {
          doneRef.current?.();
        } catch {
          /* noop */
        }
        const isSpk = stateRef.current.status === 'Speaking...';
        fadeToAction(isSpk ? 'talking' : 'idle', 0.35);
      });

      const animLoader = new FBXLoader();

      // Helper to load a single animation clip
      const loadAnim = (name: string, url: string, loop: boolean) => {
        animLoader.load(
          url,
          (animFbx) => {
            if (disposed || !mixer) return;
            if (animFbx.animations && animFbx.animations.length > 0) {
              const rawClip = animFbx.animations[0];
              const clip = sanitizeClip(rawClip, model, name);
              clip.name = name;
              const action = mixer.clipAction(clip);
              if (loop) {
                action.setLoop(THREE.LoopRepeat, Infinity);
              } else {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              }
              actions[name] = action;

              // Auto-play idle as soon as it's ready
              if (name === 'idle') {
                action.play();
                currentActionName = 'idle';
              }
              console.log(`[FridayModel3D] Loaded mocap clip: ${name}`);
            }
          },
          undefined,
          (err) => {
            console.warn(`[FridayModel3D] Could not load ${name} animation:`, err);
          }
        );
      };

      // ── Phase 1: CRITICAL — Load idle immediately (avatar needs this to start) ──
      loadAnim('idle', '/Breathing%20Idle%20(1).fbx', true);

      // ── Phase 2: IMPORTANT — Load talking shortly after (used frequently) ──
      setTimeout(() => {
        if (disposed) return;
        loadAnim('talking',     '/Talking.fbx',      true);
        loadAnim('talking_alt', '/Talking%20(1).fbx', true);
      }, 800);

      // ── Phase 3A: HIGH-PRIORITY lazy — popular actions (dance, rap, flip) ──
      setTimeout(() => {
        if (disposed) return;
        const highPri: { name: string; url: string; loop: boolean }[] = [
          { name: 'dance',         url: '/Hip%20Hop%20Dancing.fbx',          loop: true  },
          { name: 'dance_hiphop2', url: '/Hip%20Hop%20Dancing%20(1).fbx',    loop: true  },
          { name: 'dance_salsa',   url: '/Salsa%20Dancing.fbx',              loop: true  },
          { name: 'dance_swing',   url: '/Swing%20Dancing.fbx',              loop: true  },
          { name: 'dance_silly',   url: '/Silly%20Dancing.fbx',              loop: true  },
          { name: 'dance_silly2',  url: '/Silly%20Dancing%20(1).fbx',        loop: true  },
          { name: 'rap',           url: '/Rapping.fbx',                      loop: true  },
          { name: 'flip',          url: '/Backflip.fbx',                     loop: false },
          { name: 'flip_front',    url: '/Front%20Flip.fbx',                 loop: false },
          { name: 'namaste',       url: '/Praying.fbx',                      loop: false },
          { name: 'salute',        url: '/Salute.fbx',                       loop: false },
        ];
        highPri.forEach(({ name, url, loop }) => loadAnim(name, url, loop));
      }, 2500);

      // ── Phase 3B: ALL remaining animations ──
      setTimeout(() => {
        if (disposed) return;
        const lazyAnims: { name: string; url: string; loop: boolean }[] = [
          // Flips & Stunts
          { name: 'flip_uppercut',    url: '/Back%20Flip%20To%20Uppercut.fbx',   loop: false },
          { name: 'flip_twist',       url: '/Front%20Twist%20Flip.fbx',          loop: false },
          { name: 'flip_kick',        url: '/Flip%20Kick.fbx',                   loop: false },
          { name: 'flip_kick2',       url: '/Flip%20Kick%20(1).fbx',             loop: false },
          { name: 'run_flip',         url: '/Run%20To%20Flip.fbx',               loop: false },
          // Jumps
          { name: 'jump',             url: '/Jump.fbx',                          loop: false },
          { name: 'big_jump',         url: '/Big%20Jump.fbx',                    loop: false },
          { name: 'jumping_jacks',    url: '/Jumping%20Jacks.fbx',               loop: false },
          // Warm-up / Exercise
          { name: 'pushup',           url: '/Push%20Up.fbx',                     loop: false },
          { name: 'situps',           url: '/Situps.fbx',                        loop: false },
          { name: 'bicycle_crunch',   url: '/Bicycle%20Crunch.fbx',              loop: false },
          { name: 'arm_stretch',      url: '/Arm%20Stretching.fbx',              loop: false },
          { name: 'warming_up',       url: '/Warming%20Up.fbx',                  loop: false },
          { name: 'idle_situp',       url: '/Idle%20To%20Situp.fbx',             loop: false },
          // More Dance
          { name: 'dance_robot',      url: '/Robot%20Hip%20Hop%20Dance.fbx',     loop: true  },
          { name: 'dance_samba',      url: '/Samba%20Dancing.fbx',               loop: true  },
          { name: 'dance_breakfreeze',url: '/Breakdance%20Freeze%20Var%202.fbx', loop: true  },
          // Walk
          { name: 'walk',             url: '/Walking.fbx',                       loop: true  },
          // Expressions / Gestures
          { name: 'angry',            url: '/Angry.fbx',                         loop: false },
          { name: 'sad',              url: '/Sad%20Idle.fbx',                    loop: false },
          { name: 'sad2',             url: '/Sad%20Idle%20(1).fbx',              loop: false },
          { name: 'excited',          url: '/Excited.fbx',                       loop: false },
          { name: 'victory',          url: '/Victory.fbx',                       loop: false },
          { name: 'flair',            url: '/Flair.fbx',                         loop: false },
          { name: 'blow_kiss',        url: '/Blow%20A%20Kiss.fbx',               loop: false },
          { name: 'dying',            url: '/Dying.fbx',                         loop: false },
          // Fight / Combat
          { name: 'fighting_idle',    url: '/Fighting%20Idle.fbx',               loop: true  },
          { name: 'fight_to_idle',    url: '/Fight%20Idle%20To%20Standing%20Idle.fbx', loop: false },
          { name: 'fist_fight',       url: '/Fist%20Fight%20A.fbx',              loop: false },
          { name: 'kicking',          url: '/Kicking.fbx',                       loop: false },
          { name: 'punching',         url: '/Punching%20Bag.fbx',                loop: false },
        ];
        lazyAnims.forEach(({ name, url, loop }) => loadAnim(name, url, loop));
      }, 4000);
    };

    const tryLoad = (i: number) => {
      if (disposed) return;
      if (i >= MODEL_URLS.length) {
        setModelMissing(true);
        return;
      }
      const url = MODEL_URLS[i];
      const onError = () => tryLoad(i + 1);
      if (url.endsWith('.fbx')) {
        new FBXLoader().load(
          url,
          (model) =>
            handleLoaded(
              model,
              (model as THREE.Group & { animations: THREE.AnimationClip[] }).animations ?? []
            ),
          undefined,
          onError
        );
      } else {
        new GLTFLoader().load(
          url,
          (gltf) => handleLoaded(gltf.scene, gltf.animations),
          undefined,
          onError
        );
      }
    };
    tryLoad(0);

    const onMouse = (e: MouseEvent) => {
      const r = mount.getBoundingClientRect();
      if (r.width < 1) return;
      const cx = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
      const cy = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
      mouseRef.current.x = cx * 0.5;
      mouseRef.current.y = cy * 0.5;
    };
    window.addEventListener('mousemove', onMouse);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    let jawOpen = 0;

    // ── Beat Detector: Web Audio API se audio energy measure karke dance bounce ──
    // Direct music player analyser (window.__fridayMusicAnalyser) ya page audio elements se
    let beatAudioCtx: AudioContext | null = null;
    let beatAnalyser: AnalyserNode | null = null;
    let beatDataArray: Uint8Array | null = null;
    let beatEnergy = 0;       // smoothed energy 0-1
    let beatPeak = 0.1;       // peak tracker for beat detection
    let beatPulse = 0;        // short pulse on beat hit (decays fast)
    let lastBeatTime = 0;     // debounce rapid beats

    const initBeatDetector = () => {
      if ((window as any).__fridayMusicAnalyser) return;
      if (beatAudioCtx) return;
      try {
        beatAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        beatAnalyser = beatAudioCtx.createAnalyser();
        beatAnalyser.fftSize = 256;
        beatAnalyser.smoothingTimeConstant = 0.75;
        beatDataArray = new Uint8Array(beatAnalyser.frequencyBinCount);
        // Connect all audio elements on the page
        document.querySelectorAll<HTMLAudioElement>('audio').forEach((el) => {
          try {
            const src = beatAudioCtx!.createMediaElementSource(el);
            src.connect(beatAnalyser!);
            beatAnalyser!.connect(beatAudioCtx!.destination);
          } catch { /* element may already be connected */ }
        });
        console.log('[BeatDetector] Initialized page audio analyser');
      } catch (e) {
        console.warn('[BeatDetector] Web Audio API notice:', e);
      }
    };

    const getBeatEnergy = (): number => {
      // Priority 1: Direct music player analyser from LiveAIInterface
      const globalAnalyser = (window as any).__fridayMusicAnalyser as AnalyserNode | undefined;
      const analyser = globalAnalyser || beatAnalyser;
      if (!analyser) return 0;

      if (!beatDataArray || beatDataArray.length !== analyser.frequencyBinCount) {
        beatDataArray = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(beatDataArray);

      // Focus on kick/bass bins (bins 0-6 ≈ 40-500 Hz where the rhythm lives)
      let sum = 0;
      const bassBins = Math.min(6, beatDataArray.length);
      for (let i = 0; i < bassBins; i++) sum += beatDataArray[i];
      return sum / (bassBins * 255); // normalize 0-1
    };

    let speechDataArray: Uint8Array | null = null;
    const getSpeechEnergy = (): number => {
      const analyser = (window as any).__fridaySpeechAnalyser as AnalyserNode | undefined;
      if (!analyser) return 0;
      if (!speechDataArray || speechDataArray.length !== analyser.frequencyBinCount) {
        speechDataArray = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(speechDataArray);
      // Human speech formant frequency range (bins 2-28 ≈ 180Hz - 2800Hz)
      let sum = 0;
      const startBin = 2;
      const endBin = Math.min(28, speechDataArray.length);
      for (let i = startBin; i < endBin; i++) sum += speechDataArray[i];
      const count = Math.max(1, endBin - startBin);
      return sum / (count * 255);
    };

    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const { status, volume, reaction } = stateRef.current;
      const realSpeechEnergy = getSpeechEnergy();
      const isVoiceActive = realSpeechEnergy > 0.025;
      const isSpkStatus = status === 'Speaking...' || (typeof status === 'string' && status.toLowerCase().includes('speaking'));
      const speaking = isSpkStatus || isVoiceActive;
      const listening = status === 'Listening...';
      const thinking = status === 'Thinking...';
      const happy =
        reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';

      const rawActCheck = stateRef.current.action ?? localRef.current;
      const actCheck = normalizeAvatarAction(rawActCheck as string);
      const isDancing = actCheck === 'dance';

      // Check if action prop is a multi-action sequence
      if (!userSeqActive && rawActCheck && typeof rawActCheck === 'string') {
        const parsedSeq = parseActionSequence(rawActCheck);
        if (parsedSeq.length > 1) {
          startUserSequence(parsedSeq);
        }
      }

      if (userSeqActive) {
        // User custom sequence is currently active and managing actions
        if (actCheck === 'stop') {
          stopUserSequence();
        }
      } else if (isDancing) {
        // Choreography show: start if not already running
        if (!choreoActive && mixer) {
          startChoreo();
          // Initialize beat detector when dance starts
          initBeatDetector();
          if (beatAudioCtx?.state === 'suspended') beatAudioCtx.resume();
        }
      } else {
        // Stop choreo if it was running (user said stop / different action)
        if (choreoActive) stopChoreo();

        if (actCheck && actions[actCheck]) {
          fadeToAction(actCheck, 0.25);
        } else if (speaking && (actions['talking'] || actions['talking_alt'])) {
          fadeToAction(actions['talking'] ? 'talking' : 'talking_alt', 0.3);
        } else if (!actCheck && actions['idle']) {
          fadeToAction('idle', 0.4);
        }
      }

      mixer?.update(dt);

      // ── Beat-Sync Dance Bounce & Dynamic Tempo ──
      const isDancingNow = isDancing || choreoActive || (userSeqActive && currentActionName.startsWith('dance'));
      if (isDancingNow) {
        const rawE = getBeatEnergy();
        beatEnergy = lerp(beatEnergy, rawE, 0.25);

        // Beat detection: kick drum spike
        const now = clock.elapsedTime;
        if (rawE > Math.max(beatPeak * 1.35, 0.12) && (now - lastBeatTime) > 0.22) {
          beatPulse = 1; // trigger beat snap
          lastBeatTime = now;
        }
        beatPeak = lerp(beatPeak, Math.max(rawE, 0.08), 0.05);
        beatPulse *= Math.pow(0.0005, dt); // instant snap decay

        // Dynamic Tempo: speeds up animation on fast/heavy beats, keeps 1.0 on chill
        if (mixer) {
          const targetTimeScale = beatEnergy > 0.04 ? 0.95 + beatEnergy * 0.45 : 1.0;
          mixer.timeScale = lerp(mixer.timeScale, targetTimeScale, 0.1);
        }

        // Fallback BPM (~126 BPM = 2.1 Hz) if no external music audio is detected
        const fallbackBPM = 2.1;
        const fallbackBounce = beatEnergy < 0.03
          ? Math.abs(Math.sin(t * Math.PI * fallbackBPM)) * 0.028
          : 0;

        // Combine: direct bounce height (NO continuous accumulator so model never flies up!)
        const bounceMag = beatPulse * 0.05 + fallbackBounce;
        modelRoot.position.y = bounceMag;

        // Hip & Torso sway: moves in rhythm
        const swayFreq = beatEnergy > 0.04 ? 2.5 : fallbackBPM * 0.5;
        modelRoot.rotation.z = Math.sin(t * Math.PI * swayFreq) * 0.028;
      } else {
        // Smoothly restore base transforms when not dancing
        beatPulse = 0;
        modelRoot.position.y = lerp(modelRoot.position.y, 0, 0.15);
        modelRoot.rotation.z = lerp(modelRoot.rotation.z, 0, 0.08);
        if (mixer && mixer.timeScale !== 1.0) {
          mixer.timeScale = lerp(mixer.timeScale, 1.0, 0.15);
        }
      }

      // ── Lip-sync: Real open/close syllable pulsing (jaise insaan bolta hai) ──
      // Syllable oscillators — raw sin (positive AND near-zero phases), NOT abs()
      // This creates true band-khulna-band cycles instead of always-open
      const syllRate1 = 4.2;   // ~4 Hz = natural Hindi syllable speed
      const syllRate2 = 6.8;   // faster consonant burst
      const syllRate3 = 2.1;   // slow phrase envelope
      const raw1 = Math.sin(t * Math.PI * syllRate1);
      const raw2 = Math.sin(t * Math.PI * syllRate2);
      const raw3 = Math.sin(t * Math.PI * syllRate3);
      // Rectify: only let positive peaks through, negatives → mouth closes to 0
      const pulse1 = Math.max(0, raw1);              // main syllable pulse
      const pulse2 = Math.max(0, raw2) * 0.4;        // consonant burst overlay
      const envelope = 0.55 + 0.45 * Math.max(0, raw3); // slow phrase swell 0.55–1.0
      const syllablePulse = (pulse1 + pulse2) * envelope; // 0 to ~1.4, clamp below

      let openTarget = 0.0; // fully closed at rest
      if (speaking) {
        if (isVoiceActive) {
          // Real audio waveform drives mouth — scales with speech energy
          // syllablePulse ensures it closes between syllables even with audio
          const audioBoost = realSpeechEnergy * 1.1;
          openTarget = THREE.MathUtils.clamp(audioBoost * syllablePulse + syllablePulse * 0.15, 0, 0.48);
        } else {
          // Generative syllable rhythm: genuinely opens and closes
          openTarget = THREE.MathUtils.clamp(syllablePulse * 0.42, 0, 0.45);
        }
      } else if (happy) {
        openTarget = 0.08; // gentle smile, not wide open
      }

      // Quick snap open on vowel, smooth close on consonant (natural feel)
      const lerpSpeed = openTarget > jawOpen ? 0.55 : 0.22;
      jawOpen = lerp(jawOpen, openTarget, lerpSpeed);


      // 1. Physical Jaw Bone rotation (~10-12 degrees)
      if (jawBone && jawBone !== modelRoot) {
        jawBone.rotation.x = jawOpen * 0.22;
      }

      // 2. Morph targets on all face / teeth / mouth meshes
      if (mouthOpenMorphs.length > 0) {
        mouthOpenMorphs.forEach(({ mesh, index }) => {
          if (mesh.morphTargetInfluences) {
            mesh.morphTargetInfluences[index] = THREE.MathUtils.clamp(jawOpen * 0.62, 0, 1);
          }
        });
      } else if (mouthMorph && mouthMorph.mesh.morphTargetInfluences) {
        mouthMorph.mesh.morphTargetInfluences[mouthMorph.index] = THREE.MathUtils.clamp(jawOpen * 0.62, 0, 1);
      }

      // 3. Multi-viseme shaping (lips widening, funneling for 'oo/oh', vowel dynamics)
      if (speaking) {
        visemePhase += dt * 14;
        const vp = visemePhase;
        const setV = (key: string, val: number) => {
          const vObj = visemes[key];
          if (vObj && vObj.mesh.morphTargetInfluences) {
            vObj.mesh.morphTargetInfluences[vObj.index] = lerp(
              vObj.mesh.morphTargetInfluences[vObj.index] ?? 0,
              Math.max(0, Math.min(val, 1)),
              0.35
            );
          }
        };
        setV('funnel', Math.max(0, Math.sin(vp * 0.8 + 2.5)) * 0.55 * jawOpen);
        setV('smile', Math.max(0, Math.sin(vp * 1.2)) * 0.45 * jawOpen);
        setV('pucker', Math.max(0, Math.sin(vp * 1.0 + 4.0)) * 0.35 * jawOpen);
        setV('stretch', Math.max(0, Math.sin(vp * 0.6)) * 0.3 * jawOpen);
        setV('lowerLip', Math.max(0, Math.sin(vp * 1.4 + 1.0)) * 0.4 * jawOpen);
      } else {
        Object.values(visemes).forEach(({ mesh, index }) => {
          if (mesh.morphTargetInfluences) {
            mesh.morphTargetInfluences[index] = lerp(
              mesh.morphTargetInfluences[index] ?? 0,
              0,
              0.2
            );
          }
        });
      }

      // ── Blink ──
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt / 0.18;
        if (blinkT >= 1) {
          blinkT = -1;
          blinkTimer = 1.8 + Math.random() * 2.6;
        }
      }
      const blink = blinkT >= 0 ? Math.sin(Math.min(blinkT, 1) * Math.PI) : 0;
      blinkMorphs.forEach(({ mesh, index }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = blink;
      });

      // ── Gaze tracking & Head Orientation ──
      const m = mouseRef.current;
      if (headBone && headBone !== modelRoot) {
        if (speaking) {
          headBone.rotation.x = lerp(headBone.rotation.x, m.y * 0.04, 0.1);
          headBone.rotation.y = lerp(headBone.rotation.y, m.x * 0.08, 0.1);
          headBone.rotation.z = lerp(headBone.rotation.z, 0, 0.1);
        } else {
          headBone.rotation.y = lerp(
            headBone.rotation.y,
            m.x * 0.35 + (thinking ? Math.sin(t * 1.6) * 0.2 : 0),
            0.08
          );
          headBone.rotation.x = lerp(
            headBone.rotation.x,
            m.y * 0.18 + (listening ? -0.1 : 0),
            0.08
          );
          headBone.rotation.z = lerp(headBone.rotation.z, thinking ? 0.12 : 0, 0.06);
        }
        headBone.rotation.x = THREE.MathUtils.clamp(headBone.rotation.x, -0.35, 0.35);
        headBone.rotation.y = THREE.MathUtils.clamp(headBone.rotation.y, -0.45, 0.45);
        headBone.rotation.z = THREE.MathUtils.clamp(headBone.rotation.z, -0.3, 0.3);
      }

      // Procedural Head Nods if explicitly requested
      if (actCheck === 'nod-yes' && headBone && headBone !== modelRoot) {
        headBone.rotation.x += Math.sin(t * 10) * 0.14;
      } else if (actCheck === 'nod-no' && headBone && headBone !== modelRoot) {
        headBone.rotation.y += Math.sin(t * 9) * 0.25;
      }

      // ── Eye Saccades (Darting Look) ──
      sacT -= dt;
      if (sacT <= 0) {
        sacT = 1.8 + Math.random() * 2.5;
        sacTX = (Math.random() - 0.5) * 0.24;
        sacTY = (Math.random() - 0.5) * 0.14;
      }
      sacX = lerp(sacX, sacTX, 1 - Math.pow(0.0001, dt));
      sacY = lerp(sacY, sacTY, 1 - Math.pow(0.0001, dt));
      if (eyeL) {
        eyeL.rotation.y = sacX;
        eyeL.rotation.x = sacY;
      }
      if (eyeR) {
        eyeR.rotation.y = sacX;
        eyeR.rotation.x = sacY;
      }

      // Rim glow theme pulse
      rim.intensity = 18 + Math.min(volume * 60, 22) + Math.sin(t * 2) * 3;

      // ── Dynamic Stunt Framing: gently pulls camera back during flips/jumps so avatar stays 100% in-frame ──
      const isStuntActive = !!(actCheck && /flip|jump|kick/i.test(actCheck));
      const targetCamZ = isStuntActive ? baseCamZ * 1.14 : baseCamZ;
      const targetCamY = isStuntActive ? baseCamY + 0.08 : baseCamY;
      camera.position.z = lerp(camera.position.z, targetCamZ, 0.08);
      camera.position.y = lerp(camera.position.y, targetCamY, 0.08);
      camera.lookAt(0, baseLookY + (isStuntActive ? 0.04 : 0), 0);

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth || 300;
      const h = mount.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onActionSeqEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && Array.isArray(detail.sequence) && detail.sequence.length > 0) {
        startUserSequence(detail.sequence);
      }
    };
    window.addEventListener('friday-action-sequence', onActionSeqEvent);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearChoreoTimer(); // kill any pending choreo step timers
      choreoActive = false;
      clearUserSeqTimer();
      stopUserSequence();
      window.removeEventListener('friday-action-sequence', onActionSeqEvent);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  if (modelMissing) {
    return (
      <FridayAvatar
        status={status}
        volume={volume}
        reaction={reaction}
        height={height}
        onTap={onTap}
      />
    );
  }

  return (
    <div
      className={`relative flex flex-col items-center ${fluid ? 'w-full h-full' : ''}`}
      style={{ perspective: 900 }}
      onDoubleClick={onTap}
    >
      {/* ── Premium Animated Loading Placeholder (shown while 3D model downloads) ── */}
      {!isModelLoaded && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10"
          style={{ width: fluid ? '100%' : Math.round(height * 0.75), height }}
        >
          {/* Outer pulsing ring */}
          <div className="relative flex items-center justify-center" style={{ width: 90, height: 90 }}>
            <div
              className="absolute inset-0 rounded-full border-2 border-cyan-400/40 animate-ping"
              style={{ animationDuration: '1.6s' }}
            />
            <div
              className="absolute inset-0 rounded-full border border-cyan-500/20"
            />
            {/* Spinning arc */}
            <svg
              className="absolute inset-0 animate-spin"
              style={{ animationDuration: '1.2s' }}
              viewBox="0 0 90 90"
              fill="none"
            >
              <circle
                cx="45" cy="45" r="38"
                stroke="url(#avatarGrad)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="60 160"
              />
              <defs>
                <linearGradient id="avatarGrad" x1="0" y1="0" x2="90" y2="90" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#22d3ee" />
                  <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
            {/* Center avatar silhouette icon */}
            <svg viewBox="0 0 40 60" fill="none" style={{ width: 36, height: 36 }}>
              <ellipse cx="20" cy="14" rx="9" ry="10" fill="#22d3ee" opacity="0.25" />
              <path d="M5 54 Q5 34 20 34 Q35 34 35 54" fill="#3b82f6" opacity="0.18" />
            </svg>
          </div>
          {/* Loading text */}
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[11px] text-cyan-400/70 font-medium tracking-widest uppercase">Loading Avatar</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="block w-1 h-1 rounded-full bg-cyan-400/60 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
                />
              ))}
            </span>
          </div>
        </div>
      )}
      <div
        ref={mountRef}
        style={
          fluid
            ? { width: '100%', height: '100%' }
            : { width: Math.round(height * 0.75), height }
        }
      />
      {isSpeaking && (
        <div
          className={`absolute flex items-end gap-1 pointer-events-none ${
            fluid ? 'bottom-28' : '-bottom-1'
          }`}
        >
          {[0.5, 0.9, 0.65, 1, 0.75, 0.55, 0.85].map((b, i) => (
            <motion.span
              key={i}
              style={{
                width: 4,
                borderRadius: 3,
                background: '#38bdf8',
                boxShadow: '0 0 8px #38bdf8',
              }}
              animate={{ height: [4, 5 + Math.min(volume * 70, 22) * b, 4] }}
              transition={{
                duration: 0.3 + i * 0.03,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FridayModel3D;
