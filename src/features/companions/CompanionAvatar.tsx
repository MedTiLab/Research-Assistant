import { companionAvatar } from './types';

export default function CompanionAvatar({ avatar, size = 'md' }: { avatar: string; size?: 'sm' | 'md' | 'lg' }) {
  const item = companionAvatar(avatar);
  const sizes = size === 'lg' ? 'h-32 w-32 text-3xl' : size === 'sm' ? 'h-10 w-10 text-xs' : 'h-16 w-16 text-base';
  return (
    <div className={`grid ${sizes} shrink-0 place-items-center rounded-[30%] bg-gradient-to-br ${item.color} font-black tracking-tighter text-slate-700 shadow-inner ring-1 ring-black/5`}>
      {item.glyph}
    </div>
  );
}
