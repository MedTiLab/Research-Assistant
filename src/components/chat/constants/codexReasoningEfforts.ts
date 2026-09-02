import { Atom, Brain, Circle, Crown, Gauge, Sparkles, Zap } from 'lucide-react';

export const DEFAULT_CODEX_REASONING_EFFORT = 'high' as const;
export const CODEX_REASONING_DEFAULTS_VERSION = 'high-v3';

export const codexReasoningEfforts = [
  {
    id: 'default',
    name: 'Default',
    description: 'Use the model default',
    icon: Circle,
    color: 'text-gray-600',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Set model_reasoning_effort to minimal',
    icon: Gauge,
    color: 'text-slate-600',
  },
  {
    id: 'low',
    name: 'Low',
    description: 'Set model_reasoning_effort to low',
    icon: Brain,
    color: 'text-blue-600',
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Set model_reasoning_effort to medium',
    icon: Zap,
    color: 'text-violet-600',
  },
  {
    id: 'high',
    name: 'High',
    description: 'Set model_reasoning_effort to high',
    icon: Sparkles,
    color: 'text-indigo-600',
  },
  {
    id: 'xhigh',
    name: 'XHigh',
    description: 'Set model_reasoning_effort to xhigh',
    icon: Atom,
    color: 'text-red-600',
  },
  {
    id: 'max',
    name: 'Max',
    description: 'Set model_reasoning_effort to max',
    icon: Crown,
    color: 'text-amber-600',
  },
] as const;

export type CodexReasoningEffortId = (typeof codexReasoningEfforts)[number]['id'];
